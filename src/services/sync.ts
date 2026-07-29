import * as db from '../db/database';
import { fetchOpenOrders, fetchTableOrder, pushOrders } from '../api/client';
import { useAuth } from '../store/useAuth';
import { useCart } from '../store/useCart';
import { useRealtime } from '../store/useRealtime';
import type { Order } from '../types';

/**
 * Synchro montante (outbox) : pousse les commandes locales non synchronisées
 * vers l'API. Idempotent grâce aux UUID — un renvoi ne crée pas de doublon.
 * Silencieux en cas d'absence de réseau (sera rejoué plus tard).
 */
let inFlightPush: Promise<{ pushed: number; failed: boolean }> | null = null;

export async function flushOutbox(): Promise<{ pushed: number; failed: boolean }> {
    // Single-flight OBLIGATOIRE : cette fonction est appelée depuis une dizaine
    // d'endroits, plus la boucle de synchro, plus le push débouncé du panier.
    // Deux envois simultanés de la MÊME commande lisent le même état serveur et
    // produisent chacun leur ticket cuisine -> l'écran affiche l'envoi en double.
    if (inFlightPush) return inFlightPush;

    inFlightPush = doFlushOutbox().finally(() => { inFlightPush = null; });

    return inFlightPush;
}

async function doFlushOutbox(): Promise<{ pushed: number; failed: boolean }> {
    const outbox = await db.getOutbox();
    useRealtime.getState().setPending(outbox.length); // alimente l'indicateur de synchro
    if (!outbox.length) return { pushed: 0, failed: false };

    try {
        const res = await pushOrders(outbox);
        const accepted = res.accepted ?? [];
        // On adopte la version serveur par commande (synced=1 seulement si non ré-éditée
        // entre-temps) -> les échos plus anciens seront ignorés.
        for (const a of accepted) {
            const pushed = outbox.find((o) => o.id === a.id) as any;
            await db.markOrderSynced(a.id, a.version, pushed?.updated_at ?? null);
        }
        useRealtime.getState().setPending((await db.getOutbox()).length);
        return { pushed: accepted.length, failed: false };
    } catch {
        return { pushed: 0, failed: true };
    }
}

/**
 * Push LIVE débouncé : appelé après chaque modification du panier. Regroupe les
 * frappes rapides en un seul envoi (~0,4 s) puis pousse l'outbox. C'est ce qui
 * fait remonter les commandes ouvertes au serveur en continu (miroir temps réel),
 * et non plus seulement au paiement.
 */
let pushTimer: ReturnType<typeof setTimeout> | null = null;
export function schedulePush(delayMs = 400): void {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
        pushTimer = null;
        void flushOutbox();
    }, delayMs);
}

/**
 * Boucle de synchro (modèle Lightspeed/Toast) : filet de sécurité qui garantit la
 * convergence quoi qu'il arrive.
 *  - toutes les ~4 s : REJOUE l'outbox (retry) -> aucune action ne se perd, même
 *    après une coupure réseau (le paiement/annulation finit toujours par remonter) ;
 *  - toutes les ~12 s : HEARTBEAT (pull de l'état serveur) -> tous les appareils
 *    convergent même si un événement temps réel a été manqué.
 */
let loopTimer: ReturnType<typeof setInterval> | null = null;
let loopTick = 0;
export function startSyncLoop(): void {
    stopSyncLoop();
    loopTick = 0;
    loopTimer = setInterval(async () => {
        loopTick += 1;
        await flushOutbox();
        if (loopTick % 3 === 0) await pullOpenOrders();
    }, 4000);
}
export function stopSyncLoop(): void {
    if (loopTimer) clearInterval(loopTimer);
    loopTimer = null;
}

/**
 * Synchro descendante : récupère l'état partagé des commandes ouvertes et l'écrit
 * en cache local (sans écraser d'éventuelles éditions locales en attente). Appelé
 * à l'ouverture de l'écran salles et à la reconnexion -> chaque appareil se met en
 * miroir et voit toutes les tables, où qu'elles aient été saisies.
 */
export async function pullOpenOrders(): Promise<{ pulled: number; failed: boolean }> {
    try {
        const profileId = useAuth.getState().profileId;
        const orders = await fetchOpenOrders(profileId);
        // Anti-course : profil changé pendant la requête -> réponse périmée, on ignore.
        if (useAuth.getState().profileId !== profileId) {
            return { pulled: 0, failed: false };
        }
        for (const o of orders) {
            await db.saveRemoteOrder(normalizeOrder(o));
        }
        // Libère les tables (du profil actif) dont la commande n'est plus ouverte serveur.
        await db.reconcileClosedOrders(orders.map((o) => o.id), profileId);
        useRealtime.getState().bumpTables();
        return { pulled: orders.length, failed: false };
    } catch {
        return { pulled: 0, failed: true };
    }
}

/**
 * Résout la commande à ouvrir pour une table EN INTERROGEANT LE SERVEUR (source de
 * vérité) -> on reprend toujours la commande partagée, jamais de doublon. En cas
 * de réseau indisponible, on retombe sur le cache local. Renvoie la commande ou null.
 */
export async function resolveTableOrder(tableId: number): Promise<Order | null> {
    try {
        const remote = await fetchTableOrder(tableId);
        if (remote) {
            const order = normalizeOrder(remote);
            await db.saveRemoteOrder(order); // ne touche pas une édition locale en attente
            // On relit depuis la base : version fusionnée cohérente (édition locale prioritaire).
            return await db.getOrder(order.id);
        }
        // Le serveur dit "aucune commande ouverte" : on nettoie un éventuel reliquat local.
        return await db.getOpenOrderForTable(tableId);
    } catch {
        // Hors-ligne : on se rabat sur le cache local.
        return await db.getOpenOrderForTable(tableId);
    }
}

/**
 * Réception d'un OrderUpdated (commande complète diffusée par le serveur).
 * 1) écrit en cache local (garde anti-écrasement) ;
 * 2) si c'est la commande ouverte à l'écran, met le panier en miroir ;
 * 3) rafraîchit l'état des tables.
 */
export async function receiveRemoteOrder(o: Order): Promise<void> {
    // Payload incomplet (ancien format sans `lines` -> worker serveur pas redémarré) :
    // on l'ignore pour ne JAMAIS vider les lignes locales. On rafraîchit juste les tables.
    if (!o || !Array.isArray((o as any).lines)) {
        console.log('[sync] écho incomplet ignoré (pas de lignes)', (o as any)?.id);
        useRealtime.getState().bumpTables();
        return;
    }

    const order = normalizeOrder(o);

    // Commande OUVERTE à l'écran : MIROIR réel avec protection de l'édition en cours.
    // - si on a des éditions locales NON poussées (dirty) : on ne les écrase pas,
    //   on adopte juste les champs serveur (n° de ticket) ; notre push fera foi.
    // - sinon (état propre) : on REFLÈTE l'état serveur en direct -> vrai miroir
    //   (l'autre serveur ajoute un article, on le voit ; il paie, ça se reflète).
    const openId = useCart.getState().order?.id;
    if (openId && openId === order.id) {
        if (await db.isOrderDirty(order.id)) {
            useCart.getState().adoptServerFields(order); // édition en cours protégée
        } else {
            // saveRemoteOrder n'applique QUE si la version est plus récente (anti-périmé).
            const res = await db.saveRemoteOrder(order);
            if (res === 'applied') {
                if (order.status === 'paid' || order.status === 'cancelled') {
                    useCart.getState().clear(); // fermée ailleurs -> on quitte l'édition
                } else {
                    useCart.getState().applyRemoteOrder(order); // miroir réel
                }
            }
        }
        useRealtime.getState().bumpTables();
        return;
    }

    await db.saveRemoteOrder(order);
    useRealtime.getState().bumpTables();
}

/** Garantit les bons types depuis le payload broadcast (floats/bools/arrays). */
function normalizeOrder(o: any): Order {
    return {
        ...o,
        ticket_number: o.ticket_number != null ? Number(o.ticket_number) : null,
        version: Number(o.version ?? 0),
        subtotal: Number(o.subtotal),
        tax_total: Number(o.tax_total),
        total: Number(o.total),
        payments: Array.isArray(o.payments)
            ? o.payments.map((p: any) => ({ method: p.method, amount: Number(p.amount) }))
            : [],
        lines: Array.isArray(o.lines)
            ? o.lines.map((l: any) => ({
                ...l,
                qty: Number(l.qty),
                sent_qty: Number(l.sent_qty ?? 0),
                unit_price_snapshot: Number(l.unit_price_snapshot),
                tax_rate_snapshot: Number(l.tax_rate_snapshot),
                line_total: Number(l.line_total),
                price_includes_tax_snapshot: !!l.price_includes_tax_snapshot,
                voided: !!l.voided,
                options_snapshot: Array.isArray(l.options_snapshot) ? l.options_snapshot : [],
            }))
            : [],
    };
}
