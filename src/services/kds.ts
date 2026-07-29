import { useConfig } from '../store/useConfig';
import { buildKitchenTicket, enqueuePrint } from '../printer/printer';
import type { Order, OrderLine, PrepStation } from '../types';

/**
 * Filet de sécurité des écrans cuisine.
 *
 * Un poste en mode « écran » n'imprime rien : la commande part au serveur, qui
 * la pousse sur la tablette de cuisine. Mais l'écran peut être éteint, planté
 * ou hors réseau — et une cuisine ne doit JAMAIS perdre une commande.
 *
 * On attend donc l'accusé de réception de l'écran ; sans lui au bout de quelques
 * secondes, on imprime le ticket sur l'imprimante de secours du poste.
 *
 * L'attente ne bloque pas l'interface : le serveur a validé son envoi dès que la
 * commande est dans l'outbox, le repli se joue en arrière-plan.
 */

const ACK_TIMEOUT_MS = 12000;

/** Envois en attente d'accusé : `${orderId}:${stationId}` -> minuteur de repli. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

const keyOf = (orderId: string, stationId: number) => `${orderId}:${stationId}`;

/**
 * Programme l'impression de secours si l'écran n'accuse pas réception à temps.
 * À appeler juste après un envoi vers un poste qui affiche.
 */
export function watchScreenDelivery(
    station: PrepStation,
    order: Order,
    lines: OrderLine[],
    meta: { tableLabel: string | null; roomName: string | null; serverName: string },
): void {
    const key = keyOf(order.id, station.id);
    if (pending.has(key)) clearTimeout(pending.get(key)!);

    const timer = setTimeout(() => {
        pending.delete(key);

        const printer = fallbackPrinterOf(station);
        if (!printer) {
            // Aucun secours configuré : on le signale plutôt que d'échouer en silence.
            console.log(`[kds] poste "${station.name}" sans accusé ni imprimante de secours — commande ${order.id}`);
            return;
        }

        console.log(`[kds] pas d'accusé de "${station.name}" -> impression de secours`);
        void enqueuePrint(printer, buildKitchenTicket(order, lines, meta, false));
    }, ACK_TIMEOUT_MS);

    pending.set(key, timer);
}

/** L'écran a confirmé : on annule le repli papier. */
export function markScreenAcknowledged(orderId: string, stationId: number): void {
    const key = keyOf(orderId, stationId);
    const timer = pending.get(key);
    if (!timer) return;
    clearTimeout(timer);
    pending.delete(key);
    console.log(`[kds] accusé reçu (${key}) — pas d'impression de secours`);
}

/** Imprimante de secours du poste, à défaut son imprimante principale. */
function fallbackPrinterOf(station: PrepStation) {
    const { printers } = useConfig.getState();
    const id = station.fallback_printer_id ?? station.printer_id;

    return id ? printers.find((p) => p.id === id) ?? null : null;
}

/** Utilisé par les tests / le nettoyage : annule tous les replis en attente. */
export function clearScreenWatches(): void {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
}
