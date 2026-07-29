import * as PusherNS from 'pusher-js';
import { useAuth } from '../store/useAuth';
import { useConfig } from '../store/useConfig';
import { useRealtime } from '../store/useRealtime';
import { pullOpenOrders, receiveRemoteOrder } from './sync';
import type { Category, Order, Product, RealtimeConfig } from '../types';

/**
 * Temps réel via Reverb (protocole Pusher). On utilise **pusher-js directement**
 * (et non laravel-echo) car le build de laravel-echo n'expose pas son constructeur
 * de façon compatible avec Hermes/Metro ("Object cannot be used as a constructor").
 * Reverb parle le protocole Pusher, donc pusher-js suffit.
 *
 * IMPORTANT : tout est avalé en cas d'erreur — l'app reste fonctionnelle sans live.
 * Config (key/host/port/scheme) fournie par le serveur via /bootstrap (adapte local/prod).
 */

// Le build React Native de pusher-js exporte la classe sous le NOM `.Pusher`
// (module.exports.Pusher = ...), pas en default. On résout dans l'ordre :
// export nommé -> default -> module brut.
const Pusher: any = (PusherNS as any).Pusher ?? (PusherNS as any).default ?? PusherNS;

if (__DEV__ && Pusher) {
    Pusher.logToConsole = true;
}

let pusher: any = null;
let firstConnect = true;

/** Extrait le hostname d'une URL sans `new URL` (incomplet en RN). */
function hostnameOf(url: string): string | null {
    const m = url.match(/^[a-z]+:\/\/([^/:]+)/i);
    return m ? m[1] : null;
}

export function connectRealtime(config: RealtimeConfig | null, apiUrl: string, profileId?: number | null): void {
    disconnectRealtime();

    if (!config?.key) {
        console.log('[realtime] AUCUNE config (broadcasting != reverb ?) -> pas de connexion');
        return;
    }
    // localhost/127.0.0.1 renvoyé par un serveur de dev = inutilisable depuis le
    // téléphone -> on retombe sur l'hôte d'enrôlement (l'IP du Mac).
    let host = config.host;
    if (!host || host === 'localhost' || host === '127.0.0.1') {
        host = hostnameOf(apiUrl) ?? host;
    }
    if (!host) return;

    console.log('[realtime] connexion ->', { host, port: config.port, scheme: config.scheme, key: config.key });
    firstConnect = true;

    try {
        pusher = new Pusher(config.key, {
            wsHost: host,
            wsPort: config.port,
            wssPort: config.port,
            forceTLS: config.scheme === 'https',
            enabledTransports: ['ws', 'wss'],
            cluster: '',
            enableStats: false,
        });

        pusher.connection.bind('connected', () => {
            console.log('[realtime] ✅ CONNECTÉ');
            useRealtime.getState().setConnected(true);
            // Reconnexion (après une coupure/arrière-plan) : on resynchronise toute
            // la config pour rattraper les events manqués -> cohérence garantie.
            if (!firstConnect) {
                console.log('[realtime] reconnexion -> resync config + commandes');
                void useConfig.getState().syncFromServer();
                void pullOpenOrders(); // rattrape les commandes changées pendant la coupure
            }
            firstConnect = false;
        });
        pusher.connection.bind('disconnected', () => {
            console.log('[realtime] ❌ déconnecté');
            useRealtime.getState().setConnected(false);
        });
        pusher.connection.bind('error', (e: any) => console.log('[realtime] erreur connexion', e?.error ?? e));
        pusher.connection.bind('state_change', (s: any) => console.log('[realtime] état', s?.previous, '->', s?.current));

        const cfg = useConfig.getState();
        // Canal scopé par profil : les events (produits, tables, commandes) d'un
        // profil ne parviennent qu'aux appareils sur ce profil.
        const channelName = profileId ? `pos.${profileId}` : 'pos';
        console.log('[realtime] canal', channelName);
        const channel = pusher.subscribe(channelName);

        // Noms d'events = broadcastAs() côté Laravel (sans namespace ni point).
        channel.bind('ProductUpdated', (p: Product) => {
            console.log('[realtime] ⬇ ProductUpdated', p?.id);
            void cfg.applyProductUpdate(normalizeProduct(p));
        });
        channel.bind('ProductAvailabilityChanged', (e: { id: number; available: boolean }) => {
            console.log('[realtime] ⬇ ProductAvailabilityChanged', e);
            void cfg.applyAvailability(e.id, !!e.available);
        });
        channel.bind('CategoryUpdated', (c: Category) => void cfg.applyCategoryUpdate(c));
        // Plan de salle réenregistré dans l'admin : on resynchronise la config pour
        // adopter la nouvelle disposition sans redémarrer l'app.
        channel.bind('RoomPlanUpdated', () => {
            console.log('[realtime] ⬇ RoomPlanUpdated');
            void useConfig.getState().syncFromServer();
        });
        channel.bind('TableStatusChanged', () => useRealtime.getState().bumpTables());
        channel.bind('OrderUpdated', (o: Order) => {
            console.log('[realtime] ⬇ OrderUpdated', o?.id, o?.status);
            void receiveRemoteOrder(o);
        });
        // Caisse fermée ailleurs -> on coupe la session locale (l'écran redirige).
        channel.bind('SessionClosed', () => {
            console.log('[realtime] ⬇ SessionClosed');
            useAuth.getState().setSession(null);
            useRealtime.getState().bumpTables();
        });
    } catch (e) {
        console.log('[realtime] échec init', (e as any)?.message ?? e);
        pusher = null;
        useRealtime.getState().setConnected(false);
    }
}

export function disconnectRealtime(): void {
    if (pusher) {
        try {
            pusher.disconnect();
        } catch {
            /* noop */
        }
        pusher = null;
    }
    useRealtime.getState().setConnected(false);
}

/** Garantit les bons types depuis le payload broadcast. */
function normalizeProduct(p: any): Product {
    return {
        ...p,
        price: Number(p.price),
        price_includes_tax: !!p.price_includes_tax,
        available: !!p.available,
        is_open_price: !!p.is_open_price,
        option_group_ids: Array.isArray(p.option_group_ids) ? p.option_group_ids : [],
    };
}
