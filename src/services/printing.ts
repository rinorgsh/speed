import { useConfig } from '../store/useConfig';
import * as db from '../db/database';
import {
    buildCallNumberTicket,
    buildKitchenTicket,
    buildBill,
    buildReceipt,
    buildTableMoveNotice,
    enqueuePrint,
    groupLinesByPrinter,
    groupLinesByStation,
} from '../printer/printer';
import { watchScreenDelivery } from './kds';
import { EscPosBuilder } from '../printer/escpos';
import type { Order, OrderLine } from '../types';

/**
 * Orchestration de l'impression : résout les données de config (produits,
 * catégories, imprimantes, réglages) et délègue au module printer.
 */

/** Étiquette lisible d'un ticket, pour la liste des impressions en échec. */
function ticketLabel(
    order: Order,
    meta: { tableLabel: string | null; roomName: string | null },
    isCancellation: boolean,
): string {
    const où = meta.tableLabel ? `Table ${meta.tableLabel}` : 'Comptoir';
    const quoi = isCancellation ? 'Annulation' : 'Cuisine';
    return `${quoi} · ${où}${order.ticket_number ? ` · #${order.ticket_number}` : ''}`;
}

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
export async function printKitchenTickets(
    order: Order,
    lines: OrderLine[],
    isCancellation = false,
    callNumber: string | null = null,
): Promise<boolean> {
    if (!lines.length) return true;
    const { products, categories, printers, prepStations, fallbackOrderPrinter } = useConfig.getState();
    const groups = groupLinesByStation(lines, products, categories, prepStations, printers, fallbackOrderPrinter());
    const meta = await orderMeta(order);

    let ok = groups.length > 0; // des lignes sans destination = échec
    let callTicketPrinted = false;
    for (const g of groups) {
        const station = g.station;
        const showsOnScreen = station ? station.mode === 'screen' || station.mode === 'both' : false;
        const printsPaper = station ? station.mode === 'paper' || station.mode === 'both' : true;

        if (printsPaper) {
            if (!g.printer) { ok = false; continue; }

            /*
             * Le serveur affiché est celui du LOT, pas celui de la table.
             * Une table ouverte par Loti où Lido ajoute deux bières doit sortir
             * au nom de Lido — c'est lui qui rapportera les bières.
             */
            const { users: tous } = useConfig.getState();
            const nom = (id: number | null | undefined) => tous.find((u) => u.id === id)?.name ?? null;
            const auteurs = new Set(g.lines.map((l) => l.server_id ?? order.server_id));
            const metaLot = auteurs.size === 1
                ? { ...meta, serverName: nom([...auteurs][0]) ?? meta.serverName }
                : meta;

            const data = buildKitchenTicket(
                order, g.lines, metaLot, isCancellation,
                auteurs.size > 1 ? (l) => nom(l.server_id ?? order.server_id) : undefined,
                callNumber,
            );
            if (!(await enqueuePrint(g.printer, data, ticketLabel(order, meta, isCancellation)))) ok = false;

            // Numéro d'appel : le ticket client sort juste après le ticket de
            // commande, sur la MÊME imprimante, une seule fois par envoi.
            if (callNumber && !callTicketPrinted) {
                callTicketPrinted = true;
                const ticket = buildCallNumberTicket(callNumber, useConfig.getState().settings);
                if (!(await enqueuePrint(g.printer, ticket, `Numéro client ${callNumber}`))) ok = false;
            }
        }

        // Poste à l'écran : l'envoi est porté par la synchro. On arme le repli
        // papier au cas où l'écran n'accuserait jamais réception. Les annulations
        // ne sont pas concernées : elles doivent sortir tout de suite en cuisine.
        if (showsOnScreen && station && !isCancellation) {
            watchScreenDelivery(station, order, g.lines, meta);
        }
        if (showsOnScreen && station && isCancellation && !printsPaper) {
            const printer = station.fallback_printer_id
                ? printers.find((p) => p.id === station.fallback_printer_id) ?? null
                : null;
            if (printer) {
                const data = buildKitchenTicket(order, g.lines, meta, true);
                if (!(await enqueuePrint(printer, data, ticketLabel(order, meta, true)))) ok = false;
            }
        }
    }
    return ok;
}

/** Envoie en cuisine : ticket de préparation (nouveautés) + ticket d'annulation. */
export async function printKitchen(
    order: Order,
    newLines: OrderLine[],
    cancelLines: OrderLine[],
    callNumber: string | null = null,
): Promise<boolean> {
    const a = await printKitchenTickets(order, newLines, false, callNumber);
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

/**
 * Prévient la cuisine d'un transfert / d'une fusion de table. L'avis part sur
 * TOUTES les imprimantes de préparation concernées par les articles déjà
 * envoyés : chaque poste qui a reçu un ticket doit apprendre le changement.
 */
export async function printTableMove(
    kind: 'transfer' | 'merge',
    fromLabel: string,
    toLabel: string,
    order: Order,
): Promise<boolean> {
    const { products, categories, printers, users, fallbackOrderPrinter } = useConfig.getState();
    const sentLines = order.lines.filter((l) => !l.voided && (l.sent_qty ?? 0) > 0);
    const groups = groupLinesByPrinter(sentLines, products, categories, printers, fallbackOrderPrinter());
    if (!groups.length) return true;

    const serverName = users.find((u) => u.id === order.server_id)?.name ?? '—';
    let ok = true;
    for (const g of groups) {
        const data = buildTableMoveNotice(kind, fromLabel, toLabel, order, serverName);
        const quoi = kind === 'merge' ? 'Fusion' : 'Transfert';
        if (!(await enqueuePrint(g.printer, data, `${quoi} · ${fromLabel} → ${toLabel}`))) ok = false;
    }
    return ok;
}

/**
 * Imprime l'ADDITION (avant paiement). Aucun tiroir-caisse ouvert : rien n'a
 * encore été encaissé. Peut être réimprimée autant de fois que demandé.
 */
export async function printBill(order: Order): Promise<boolean> {
    const { settings, receiptPrinter } = useConfig.getState();
    const printer = receiptPrinter();
    if (!printer) return false;

    const meta = await orderMeta(order);
    const activeLines = order.lines.filter((l) => !l.voided && l.qty > 0);

    return enqueuePrint(
        printer,
        buildBill(order, activeLines, settings, { tableLabel: meta.tableLabel, serverName: meta.serverName }),
        `Addition · ${meta.tableLabel ? `Table ${meta.tableLabel}` : 'Comptoir'}`,
    );
}

/** Imprime le ticket de caisse sur l'imprimante receipt + ouvre le tiroir si cash. */
export async function printCustomerReceipt(order: Order): Promise<boolean> {
    const { settings, receiptPrinter } = useConfig.getState();
    const printer = receiptPrinter();
    if (!printer) return false;

    // Le ticket porte le numéro de TABLE : c'est le repère que le client et le
    // serveur cherchent des yeux, bien avant le numéro de ticket.
    const meta = await orderMeta(order);
    const activeLines = order.lines.filter((l) => !l.voided && l.qty > 0);
    const data = buildReceipt(order, activeLines, settings, { tableLabel: meta.tableLabel });
    const ok = await enqueuePrint(printer, data, `Ticket client${order.ticket_number ? ` #${order.ticket_number}` : ''}`);

    // Ouverture du tiroir-caisse si un paiement cash a eu lieu.
    if (order.payments.some((p) => p.method === 'cash')) {
        const kick = new EscPosBuilder().init().kickDrawer().build();
        await enqueuePrint(printer, kick, 'Tiroir-caisse');
    }
    return ok;
}
