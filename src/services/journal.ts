import * as db from '../db/database';
import { useAuth } from '../store/useAuth';
import type { Order, OrderEvent, OrderEventType, OrderLine } from '../types';
import { uuidv4 } from '../utils/uuid';

/**
 * Journal des gestes de caisse : CHAQUE modification d'une commande, avec la
 * personne connectée et l'heure de l'appareil.
 *
 * La commande ne garde que son état final. Un article envoyé au bar puis
 * annulé y reste à 0 sans qui ni combien ; une quantité ramenée de 3 à 2 n'y
 * laisse aucune trace. Le journal, lui, est écrit au moment du geste — c'est
 * le seul endroit qui sait qui l'a fait, y compris hors ligne.
 *
 * Les événements partent par leur propre file (cf. `flushEvents`) : ils ne
 * retardent jamais la commande et ne peuvent pas la bloquer.
 */

/** Contexte d'une écriture : un partage d'addition n'est pas une annulation. */
export type JournalKind = 'edit' | 'split';

const EMPTY_PAYMENTS: Order['payments'] = [];

function event(order: Order, type: OrderEventType, fields: Partial<OrderEvent>): OrderEvent {
    return {
        id: uuidv4(),
        order_id: order.id,
        order_line_id: null,
        session_id: order.session_id ?? null,
        type,
        name_snapshot: null,
        qty_before: null,
        qty_after: null,
        sent_qty_before: null,
        unit_price: null,
        price_before: null,
        amount: null,
        method: null,
        user_id: useAuth.getState().server?.id ?? null,
        occurred_at: new Date().toISOString(),
        meta: null,
        ...fields,
    };
}

function lineEvents(order: Order, before: OrderLine | undefined, after: OrderLine | undefined, kind: JournalKind): OrderEvent[] {
    const line = (after ?? before)!;
    const base = { order_line_id: line.id, name_snapshot: line.name_snapshot, unit_price: line.unit_price_snapshot };
    const out: OrderEvent[] = [];

    const qtyBefore = before?.qty ?? 0;
    const qtyAfter = after?.qty ?? 0;
    const sentBefore = before?.sent_qty ?? 0;
    const sentAfter = after?.sent_qty ?? sentBefore;

    if (!before && qtyAfter > 0) {
        out.push(event(order, 'line_added', { ...base, qty_before: 0, qty_after: qtyAfter, sent_qty_before: 0 }));
    } else if (qtyAfter > qtyBefore) {
        out.push(event(order, 'qty_increased', { ...base, qty_before: qtyBefore, qty_after: qtyAfter, sent_qty_before: sentBefore }));
    } else if (qtyAfter < qtyBefore) {
        out.push(event(order, kind === 'split' ? 'split' : 'qty_decreased', {
            ...base, qty_before: qtyBefore, qty_after: qtyAfter, sent_qty_before: sentBefore,
        }));
    }

    // Envoi en cuisine / au bar. Un partage aligne aussi sent_qty, mais rien
    // ne part en préparation : on ne l'écrit pas comme un envoi.
    if (kind !== 'split' && sentAfter !== sentBefore) {
        out.push(event(order, sentAfter > sentBefore ? 'sent' : 'cancel_sent', {
            ...base, qty_before: sentBefore, qty_after: sentAfter,
        }));
    }

    if (before && after && before.unit_price_snapshot !== after.unit_price_snapshot) {
        out.push(event(order, 'price_changed', { ...base, price_before: before.unit_price_snapshot, unit_price: after.unit_price_snapshot }));
    }

    if (before && after && (before.note ?? null) !== (after.note ?? null)) {
        out.push(event(order, 'note_changed', { ...base, meta: { note: after.note ?? '' } }));
    }

    return out;
}

/** Paiements présents d'un côté et pas de l'autre (comparés comme un multiensemble). */
function paymentDiff(from: Order['payments'], to: Order['payments']): Order['payments'] {
    const restants = [...to];
    return from.filter((p) => {
        const i = restants.findIndex((q) => q.method === p.method && q.amount === p.amount);
        if (i === -1) return true;
        restants.splice(i, 1);
        return false;
    });
}

/**
 * Déduit les gestes entre deux états d'une même commande.
 *
 * Fonction pure (hors identifiant et horodatage) : c'est elle que l'on teste,
 * et elle ne dépend pas de l'écran d'où vient la modification.
 */
export function diffOrder(prev: Order | null, next: Order, kind: JournalKind = 'edit'): OrderEvent[] {
    // Sans l'état précédent de CETTE commande, on ne sait pas ce qui a changé :
    // mieux vaut ne rien écrire qu'inventer un historique (tout « ajouté »).
    // Une commande neuve passe toujours par `startNew`, donc a un état vide.
    if (!prev || prev.id !== next.id) return [];
    const before = prev;
    const out: OrderEvent[] = [];

    const avant = new Map(before.lines.map((l) => [l.id, l]));
    const apres = new Map(next.lines.map((l) => [l.id, l]));
    for (const id of new Set([...avant.keys(), ...apres.keys()])) {
        out.push(...lineEvents(next, avant.get(id), apres.get(id), kind));
    }

    const paiementsAvant = before.payments ?? EMPTY_PAYMENTS;
    for (const p of paymentDiff(next.payments, paiementsAvant)) {
        out.push(event(next, 'payment_added', { amount: p.amount, method: p.method }));
    }
    for (const p of paymentDiff(paiementsAvant, next.payments)) {
        out.push(event(next, 'payment_removed', { amount: p.amount, method: p.method }));
    }

    const remiseAvant = before.discount_amount ?? 0;
    const remiseApres = next.discount_amount ?? 0;
    if (remiseApres !== remiseAvant) {
        out.push(remiseApres > 0
            ? event(next, 'discount_set', { amount: remiseApres, meta: { reason: next.discount_reason ?? null } })
            : event(next, 'discount_cleared', { amount: remiseAvant }));
    }

    if (before.status !== next.status) {
        if (next.status === 'paid') out.push(event(next, 'order_paid', { amount: next.total }));
        if (next.status === 'cancelled') out.push(event(next, 'order_cancelled', { amount: before.total }));
    }

    return out;
}

/** Écrit les gestes dans la file locale. Ne lève jamais : le service passe avant le journal. */
export function record(events: OrderEvent[]): void {
    if (!events.length) return;
    void db.insertOrderEvents(events).catch((e) => console.log('[journal] écriture impossible', e?.message ?? e));
}

/** Raccourci : journalise le passage de `prev` à `next`. */
export function recordChange(prev: Order | null, next: Order, kind: JournalKind = 'edit'): void {
    record(diffOrder(prev, next, kind));
}

/**
 * Table libérée : la commande est annulée hors du panier, directement en base.
 * On note ce qui était dessus, y compris ce qui était déjà parti en cuisine.
 */
export function recordReleasedOrder(order: Order): void {
    record([event(order, 'order_cancelled', {
        amount: order.total,
        meta: {
            via: 'release_table',
            lines: order.lines
                .filter((l) => l.qty > 0)
                .map((l) => ({ name: l.name_snapshot, qty: l.qty, sent_qty: l.sent_qty })),
        },
    })]);
}
