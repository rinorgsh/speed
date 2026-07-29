import * as db from '../db/database';
import { computeOrderTotals } from '../utils/pricing';
import { flushOutbox } from './sync';
import { printTableMove } from './printing';
import { useCart } from '../store/useCart';
import { useTables } from '../store/useTables';
import type { Order, Table } from '../types';

/**
 * Transfert et fusion de tables.
 *
 * Tout passe par l'outbox existante : les lignes portent des UUID stables, donc
 * réaffecter une ligne à une autre commande est un simple upsert idempotent côté
 * serveur. Conséquence directe : ces deux opérations fonctionnent HORS-LIGNE et
 * se rejouent toutes seules à la reconnexion, comme une saisie ordinaire.
 */

export type MoveOutcome = { ok: true; kind: 'transfer' | 'merge' } | { ok: false; reason: string };

/** Une commande a-t-elle des articles déjà partis en cuisine ? */
function hasSentLines(order: Order): boolean {
    return order.lines.some((l) => !l.voided && (l.sent_qty ?? 0) > 0);
}

/**
 * Déplace la commande d'une table vers une table LIBRE.
 * La cuisine est prévenue si des articles ont déjà été envoyés (le ticket déjà
 * imprimé porte l'ancien numéro de table).
 */
export async function transferTable(source: Table, target: Table): Promise<MoveOutcome> {
    const order = await db.getOpenOrderForTable(source.id);
    if (!order) return { ok: false, reason: 'Aucune commande ouverte sur cette table.' };

    const existing = await db.getOpenOrderForTable(target.id);
    if (existing) return { ok: false, reason: 'La table de destination est occupée.' };

    const moved: Order = {
        ...order,
        table_id: target.id,
        room_id: target.room_id,
    };

    await db.saveOrder(moved); // synced = 0 -> part dans l'outbox

    // Le panier ouvert à l'écran suit le déplacement.
    if (useCart.getState().order?.id === order.id) {
        useCart.getState().resume(moved);
    }

    if (hasSentLines(order)) {
        await printTableMove('transfer', source.label, target.label, moved);
    }

    useTables.getState().free(source.id);
    useTables.getState().occupy(target.id);
    await useTables.getState().refresh();
    await flushOutbox();

    return { ok: true, kind: 'transfer' };
}

/**
 * Fusionne la commande de `source` dans celle de `target` : les lignes changent
 * de commande (UUID conservés -> aucun doublon côté serveur), la commande source
 * est annulée et sa table libérée.
 */
export async function mergeTables(source: Table, target: Table): Promise<MoveOutcome> {
    if (source.id === target.id) return { ok: false, reason: 'Même table.' };

    const from = await db.getOpenOrderForTable(source.id);
    const into = await db.getOpenOrderForTable(target.id);
    if (!from) return { ok: false, reason: 'Aucune commande ouverte sur la table à fusionner.' };
    if (!into) return { ok: false, reason: 'Aucune commande ouverte sur la table de destination.' };

    // Les lignes gardent leur id ET leur sent_qty : ce qui est déjà parti en
    // cuisine ne sera jamais réimprimé après la fusion.
    const movedLines = from.lines.map((l) => ({ ...l, order_id: into.id }));
    const mergedLines = [...into.lines, ...movedLines];
    const totals = computeOrderTotals(mergedLines);

    const merged: Order = {
        ...into,
        lines: mergedLines,
        covers: (into.covers ?? 0) + (from.covers ?? 0) || null,
        ...totals,
    };

    // La commande source part vide et annulée : le serveur ne la comptera plus,
    // et ses lignes ont déjà été réaffectées par le payload de la cible.
    const emptied: Order = {
        ...from,
        status: 'cancelled',
        lines: [],
        subtotal: 0,
        tax_total: 0,
        total: 0,
        merged_into: into.id,
    };

    await db.saveOrder(merged);
    await db.saveOrder(emptied);
    await db.deleteOrderLines(from.id);

    // Panier à l'écran : on bascule sur la commande fusionnée.
    if (useCart.getState().order?.id === from.id) {
        useCart.getState().resume(merged);
    } else if (useCart.getState().order?.id === into.id) {
        useCart.getState().resume(merged);
    }

    if (hasSentLines(from)) {
        await printTableMove('merge', source.label, target.label, merged);
    }

    useTables.getState().free(source.id);
    await useTables.getState().refresh();
    await flushOutbox();

    return { ok: true, kind: 'merge' };
}
