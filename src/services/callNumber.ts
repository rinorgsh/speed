import { requestCallNumber } from '../api/client';
import * as db from '../db/database';
import { useCart } from '../store/useCart';
import { callNumberEnabled, useConfig } from '../store/useConfig';
import { flushOutbox } from './sync';
import type { Order } from '../types';

/**
 * Numéro d'appel client (réglage « Numéro d'appel client » de l'admin).
 *
 * Chaque envoi d'une commande reçoit un NOUVEAU numéro, tiré du compteur du jour
 * du serveur — le même que les n° de ticket, donc jamais deux fois le même :
 *   - 1er envoi : le n° de ticket de la commande, attribué à sa 1re synchro ;
 *   - envois suivants : un numéro neuf demandé au serveur.
 * Sans réseau, un numéro local préfixé « H » (hors-ligne) : l'impression n'est
 * jamais bloquée et il ne peut pas se confondre avec un numéro du serveur.
 */

/** Attente maximale du serveur avant de basculer sur le numéro local. */
const SERVER_WAIT_MS = 3000;

/** Aucun article de la commande n'est encore parti : c'est son 1er envoi. */
export function isFirstSend(order: Order | null): boolean {
    return !order?.lines.some((l) => l.sent_at != null);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return Promise.race([
        promise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
}

async function localNumber(): Promise<string> {
    const key = `call_number_local:${new Date().toISOString().slice(0, 10)}`;
    const next = (Number(await db.getPref(key)) || 0) + 1;
    await db.setPref(key, String(next));
    return `H${next}`;
}

/**
 * À appeler juste APRÈS `sendToKitchen()`. Renvoie null si le réglage est
 * désactivé (aucun changement de comportement) ou s'il n'y a rien à préparer.
 */
export async function resolveCallNumber(firstSend: boolean, hasNewLines: boolean): Promise<string | null> {
    if (!hasNewLines || !callNumberEnabled(useConfig.getState())) return null;

    try {
        if (firstSend) {
            // La synchro attribue le n° de ticket ; elle a lieu de toute façon,
            // on la fait simplement passer avant l'impression.
            await withTimeout(flushOutbox(), SERVER_WAIT_MS);
            const n = useCart.getState().order?.ticket_number;
            if (n != null) return String(n);
        } else {
            const profileId = useCart.getState().order?.profile_id ?? null;
            const n = await requestCallNumber(profileId, SERVER_WAIT_MS);
            if (Number.isFinite(n) && n > 0) return String(n);
        }
    } catch {
        // Réseau indisponible : numéro local ci-dessous.
    }
    return localNumber();
}
