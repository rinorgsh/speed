import * as db from '../db/database';
import { computeOrderTotals, lineTotal, optionsDelta } from '../utils/pricing';
import { uuidv4 } from '../utils/uuid';
import { flushOutbox } from './sync';
import { printCustomerReceipt } from './printing';
import type { Order, OrderLine, PaymentMethod } from '../types';

/**
 * Partage d'addition « par article » : chaque sous-ticket devient une commande
 * PAYÉE indépendante (sans table), qui réutilise tout l'existant (paiement,
 * impression du reçu, remontée serveur, rapport Z). La commande mère est réduite
 * au fur et à mesure (useCart.settleLines) ; la table se libère au dernier paiement.
 */
export interface SplitAssignment {
    lineId: string;
    qty: number;
}

/** Construit une commande payée à partir d'un sous-ensemble de lignes de la mère. */
export function buildSubticket(parent: Order, assignments: SplitAssignment[], method: PaymentMethod): Order {
    const id = uuidv4();
    const now = new Date().toISOString();

    const lines: OrderLine[] = assignments
        .map((a) => {
            const src = parent.lines.find((l) => l.id === a.lineId);
            if (!src || a.qty <= 0) return null;
            return {
                ...src,
                id: uuidv4(),
                order_id: id,
                qty: a.qty,
                sent_qty: a.qty, // déjà préparé via la mère -> aucun ticket cuisine
                line_total: lineTotal(src.unit_price_snapshot, optionsDelta(src.options_snapshot), a.qty),
            } as OrderLine;
        })
        .filter((l): l is OrderLine => l !== null);

    const totals = computeOrderTotals(lines);

    return {
        id,
        profile_id: parent.profile_id,
        ticket_number: null, // attribué par le serveur -> reçu séparé numéroté
        version: 0,
        session_id: parent.session_id,
        room_id: null,
        table_id: null,
        server_id: parent.server_id,
        status: 'paid',
        service_type: parent.service_type,
        covers: null,
        subtotal: totals.subtotal,
        tax_total: totals.tax_total,
        total: totals.total,
        opened_at: now,
        paid_at: now,
        lines,
        payments: [{ method, amount: totals.total }],
    };
}

/** Persiste le sous-ticket (outbox), imprime son reçu, pousse au serveur. */
export async function settleSubticket(order: Order): Promise<boolean> {
    await db.saveOrder(order); // synced=0 -> part dans l'outbox
    const printed = await printCustomerReceipt(order, false).catch(() => false);
    await flushOutbox();
    return printed;
}
