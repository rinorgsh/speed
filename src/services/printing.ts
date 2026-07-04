import { useConfig } from '../store/useConfig';
import * as db from '../db/database';
import {
    buildKitchenTicket,
    buildReceipt,
    enqueuePrint,
    groupLinesByPrinter,
} from '../printer/printer';
import { EscPosBuilder } from '../printer/escpos';
import type { Order, OrderLine } from '../types';

/**
 * Orchestration de l'impression : résout les données de config (produits,
 * catégories, imprimantes, réglages) et délègue au module printer.
 */

async function orderMeta(order: Order): Promise<{ tableLabel: string | null; roomName: string | null; serverName: string }> {
    const { rooms, users } = useConfig.getState();
    const room = rooms.find((r) => r.id === order.room_id) ?? null;
    let tableLabel: string | null = null;
    if (order.table_id != null && order.room_id != null) {
        const tables = await db.getTables(order.room_id);
        tableLabel = tables.find((t) => t.id === order.table_id)?.label ?? null;
    }
    const serverName = users.find((u) => u.id === order.server_id)?.name ?? '—';
    return { tableLabel, roomName: room?.name ?? null, serverName };
}

/**
 * Imprime les tickets cuisine/bar pour un ensemble de lignes (regroupées par
 * imprimante). Renvoie true si TOUT est imprimé (aucune imprimante injoignable,
 * aucune ligne sans imprimante de routage).
 */
export async function printKitchenTickets(order: Order, lines: OrderLine[], isCancellation = false): Promise<boolean> {
    if (!lines.length) return true;
    const { products, categories, printers, fallbackOrderPrinter } = useConfig.getState();
    const groups = groupLinesByPrinter(lines, products, categories, printers, fallbackOrderPrinter());
    const meta = await orderMeta(order);
    let ok = groups.length > 0; // des lignes sans imprimante = échec
    for (const g of groups) {
        const data = buildKitchenTicket(order, g.lines, meta, isCancellation);
        if (!(await enqueuePrint(g.printer, data))) ok = false;
    }
    return ok;
}

/** Envoie en cuisine : ticket de préparation (nouveautés) + ticket d'annulation. */
export async function printKitchen(order: Order, newLines: OrderLine[], cancelLines: OrderLine[]): Promise<boolean> {
    const a = await printKitchenTickets(order, newLines, false);
    const b = await printKitchenTickets(order, cancelLines, true);
    return a && b;
}

/**
 * Ticket d'annulation cuisine pour une commande annulée (à la fermeture de caisse) :
 * on annule tout ce qui avait été ENVOYÉ (sent_qty > 0). Renvoie true si rien à
 * annuler ou tout imprimé.
 */
export async function printOrderCancellation(order: Order): Promise<boolean> {
    const cancelLines = order.lines
        .filter((l) => l.sent_qty > 0 && !l.voided)
        .map((l) => ({ ...l, qty: l.sent_qty }));
    if (!cancelLines.length) return true;
    return printKitchenTickets(order, cancelLines, true);
}

/** Imprime la facture/ticket client sur l'imprimante receipt + ouvre le tiroir si cash. */
export async function printCustomerReceipt(order: Order, detailed: boolean): Promise<boolean> {
    const { settings, receiptPrinter } = useConfig.getState();
    const printer = receiptPrinter();
    if (!printer) return false;

    const activeLines = order.lines.filter((l) => !l.voided);
    const data = buildReceipt(order, activeLines, settings, detailed);
    const ok = await enqueuePrint(printer, data);

    // Ouverture du tiroir-caisse si un paiement cash a eu lieu.
    if (order.payments.some((p) => p.method === 'cash')) {
        const kick = new EscPosBuilder().init().kickDrawer().build();
        await enqueuePrint(printer, kick);
    }
    return ok;
}
