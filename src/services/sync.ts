import * as db from '../db/database';
import { fetchOpenOrders, fetchTableOrder, pushOrders } from '../api/client';
import { useAuth } from '../store/useAuth';
import { useCart } from '../store/useCart';
import { useRealtime } from '../store/useRealtime';
import { guard } from '../utils/guard';
import type { Order } from '../types';

/**
 * Synchro montante (outbox) : pousse les commandes locales non synchronisées
 * vers l'API. Idempotent grâce aux UUID — un renvoi ne crée pas de doublon.
 * Silencieux en cas d'absence de réseau (sera rejoué plus tard).
 */
let inFlightPush: Promise<{ pushed: number; failed: boolean }> | null = null;

/**
 * Taille d'un lot d'envoi.
 *
 * Le serveur traite un lot en UNE transaction : plus le lot est gros, plus une
 * seule commande fautive emporte de commandes saines avec elle. Dix est un
 * compromis entre le nombre d'allers-retours après une coupure et le coût d'un
 * refus.
 */
const PUSH_BATCH = 10;

/** Refus répétés au-delà de ce seuil : la commande est écartée de la file. */
const MAX_PUSH_ATTEMPTS = 5;

export async function flushOutbox(): Promise<{ pushed: number; failed: boolean }> {
    // Single-flight OBLIGATOIRE : cette fonction est appelée depuis une dizaine
    // d'endroits, plus la boucle de synchro, plus le push débouncé du panier.
    // Deux envois simultanés de la MÊME commande lisent le même état serveur et
    // produisent chacun leur ticket cuisine -> l'écran affiche l'envoi en double.
    if (inFlightPush) return inFlightPush;

    inFlightPush = doFlushOutbox().finally(() => { inFlightPush = null; });

    return inFlightPush;
}

/**
 * Un refus du serveur (4xx) est DÉFINITIF : la commande ne passera jamais en
 * l'état, il faut compter les tentatives et finir par l'écarter. Une panne
 * réseau ou une erreur serveur (5xx) est passagère : on rejoue indéfiniment,
 * sans jamais rien écarter — sinon une coupure de cinq minutes ferait perdre
 * les commandes prises pendant ce temps.
 */
function isRejection(e: any): boolean {
    const status = e?.response?.status;
    return typeof status === 'number' && status >= 400 && status < 500;
}

function errorMessage(e: any): string {
    return e?.response?.data?.message ?? e?.message ?? 'Envoi impossible';
}

/** Découpe en lots de taille fixe. */
function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/**
 * Envoie un lot et enregistre le résultat commande par commande.
 * Renvoie le nombre de commandes acceptées.
 */
async function pushBatch(batch: Order[]): Promise<{ accepted: number; networkDown: boolean }> {
    try {
        const res = await pushOrders(batch);
        const accepted = res.accepted ?? [];
        for (const a of accepted) {
            const pushed = batch.find((o) => o.id === a.id) as any;
            // `rev` : compteur monotone. Si la commande a été rééditée pendant
            // l'envoi, elle reste à repousser au lieu d'être perdue.
            await db.markOrderSynced(a.id, a.version, Number(pushed?.rev ?? 0));
        }
        return { accepted: accepted.length, networkDown: false };
    } catch (e: any) {
        const rejected = isRejection(e);

        // Un lot refusé peut ne contenir QU'UNE commande fautive. On isole en
        // renvoyant chaque commande seule : les saines passent, la fautive est
        // identifiée nommément au lieu de bloquer tout le service.
        if (rejected && batch.length > 1) {
            let accepted = 0;
            for (const order of batch) {
                const r = await pushBatch([order]);
                accepted += r.accepted;
                if (r.networkDown) return { accepted, networkDown: true };
            }
            return { accepted, networkDown: false };
        }

        for (const order of batch) {
            const attempts = await db.markOrderPushFailed(order.id, errorMessage(e), rejected);
            if (rejected && attempts >= MAX_PUSH_ATTEMPTS) {
                await db.quarantineOrder(order.id);
                console.log('[sync] commande écartée après', attempts, 'refus :', order.id, errorMessage(e));
            }
        }
        return { accepted: 0, networkDown: !rejected };
    }
}

async function doFlushOutbox(): Promise<{ pushed: number; failed: boolean }> {
    const outbox = await db.getOutbox();
    await refreshSyncIndicators();
    if (!outbox.length) return { pushed: 0, failed: false };

    let pushed = 0;
    let failed = false;

    for (const batch of chunk(outbox, PUSH_BATCH)) {
        const res = await pushBatch(batch);
        pushed += res.accepted;
        if (res.accepted < batch.length) failed = true;
        // Réseau coupé : inutile d'insister sur les lots suivants, la boucle
        // rejouera dans quelques secondes.
        if (res.networkDown) { failed = true; break; }
    }

    await refreshSyncIndicators();
    return { pushed, failed };
}

/** Alimente la pastille : reste à envoyer + commandes écartées. */
async function refreshSyncIndicators(): Promise<void> {
    const [pending, blocked] = await Promise.all([
        db.countOutbox().catch(() => 0),
        db.countQuarantined().catch(() => 0),
    ]);
    useRealtime.getState().setPending(pending);
    useRealtime.getState().setBlocked(blocked);
}

/**
 * Relance manuelle des commandes écartées. Déclenchée depuis l'écran des
 * salles, une fois la cause corrigée (serveur remis à jour, par exemple).
 */
export async function retryBlockedOrders(): Promise<{ pushed: number; failed: boolean }> {
    await db.releaseQuarantine();
    return flushOutbox();
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
        guard('push débouncé', flushOutbox);
    }, delayMs);
}

/**
 * Boucle de synchro : filet de sécurité qui garantit la convergence.
 *
 *  - toutes les 4 s : REJOUE l'outbox -> aucune action ne se perd, même après
 *    une coupure (le paiement, l'annulation finissent toujours par remonter) ;
 *  - toutes les 8 s : RELIT l'état serveur -> tous les appareils convergent même
 *    si un événement temps réel a été manqué.
 *
 * Chaîne de `setTimeout` REPROGRAMMÉE APRÈS chaque cycle, et non `setInterval` :
 * ce dernier n'attend pas la fin du cycle précédent. Sur réseau lent — le délai
 * d'attente réseau va jusqu'à 25 s — les cycles se chevauchaient et plusieurs
 * lectures complètes écrivaient en base en même temps.
 */
const LOOP_MS = 4000;
const PULL_EVERY = 2; // un pull tous les 2 cycles, soit ~8 s

let loopTimer: ReturnType<typeof setTimeout> | null = null;
let loopTick = 0;
let loopRunning = false;

export function startSyncLoop(): void {
    stopSyncLoop();
    loopRunning = true;
    loopTick = 0;
    schedule(0);
}

function schedule(delay: number): void {
    if (!loopRunning) return;
    loopTimer = setTimeout(async () => {
        loopTimer = null;
        try {
            loopTick += 1;
            await flushOutbox();
            if (loopTick % PULL_EVERY === 0) await pullOpenOrders();
        } catch (e) {
            // Un cycle ne doit JAMAIS tuer la boucle : c'est le filet de sécurité.
            console.log('[sync] cycle en erreur', (e as any)?.message ?? e);
        } finally {
            schedule(LOOP_MS);
        }
    }, delay);
}

export function stopSyncLoop(): void {
    loopRunning = false;
    if (loopTimer) clearTimeout(loopTimer);
    loopTimer = null;
}

/** La boucle tourne-t-elle ? Sert au chien de garde du retour au premier plan. */
export function isSyncLoopRunning(): boolean {
    return loopRunning;
}

/**
 * Synchro descendante : récupère l'état partagé des commandes ouvertes et l'écrit
 * en cache local (sans écraser d'éventuelles éditions locales en attente). Appelé
 * à l'ouverture de l'écran salles et à la reconnexion -> chaque appareil se met en
 * miroir et voit toutes les tables, où qu'elles aient été saisies.
 */
let inFlightPull: Promise<{ pulled: number; failed: boolean }> | null = null;

export function pullOpenOrders(): Promise<{ pulled: number; failed: boolean }> {
    // Single-flight, au même titre que la poussée : appelée par la boucle, par
    // le focus de l'écran des salles et par la reconnexion temps réel, elle
    // pouvait s'exécuter trois fois de front et réécrire la base en parallèle.
    if (inFlightPull) return inFlightPull;
    inFlightPull = doPullOpenOrders().finally(() => { inFlightPull = null; });
    return inFlightPull;
}

async function doPullOpenOrders(): Promise<{ pulled: number; failed: boolean }> {
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
                if (order.status !== 'open' && order.status !== 'sent') {
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
            ? o.lines.map((l: any, i: number) => ({
                ...l,
                // Repli sur le rang reçu : un serveur pas encore migré n'envoie
                // pas encore ce champ.
                position: Number(l.position ?? i + 1),
                qty: Number(l.qty),
                sent_qty: Number(l.sent_qty ?? 0),
                unit_price_snapshot: Number(l.unit_price_snapshot),
                tax_rate_snapshot: Number(l.tax_rate_snapshot),
                line_total: Number(l.line_total),
                price_includes_tax_snapshot: !!l.price_includes_tax_snapshot,
                voided: !!l.voided,
                options_snapshot: Array.isArray(l.options_snapshot) ? l.options_snapshot : [],
            })).sort((a: any, b: any) => a.position - b.position)
            : [],
    };
}
