import axios, { AxiosInstance } from 'axios';
import { NETWORK } from '../config';
import type { BootstrapPayload, Order, Profile } from '../types';

/**
 * Client API. baseURL et token sont injectés dynamiquement (configureApi),
 * car ils ne sont connus qu'après l'enrôlement de l'appareil.
 */
let api: AxiosInstance = axios.create({ timeout: NETWORK.timeout });

export function configureApi(apiUrl: string, token: string | null): void {
    api = axios.create({
        baseURL: `${apiUrl.replace(/\/$/, '')}/api/v1`,
        timeout: NETWORK.timeout,
        headers: {
            Accept: 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
}

/** Enrôle l'appareil et renvoie le token Sanctum. */
export async function registerDevice(
    apiUrl: string,
    name: string,
    enrollmentSecret: string,
): Promise<{ token: string; deviceId: number }> {
    const res = await axios.post(
        `${apiUrl.replace(/\/$/, '')}/api/v1/devices/register`,
        { name, enrollment_secret: enrollmentSecret },
        { timeout: NETWORK.timeout, headers: { Accept: 'application/json' } },
    );
    return { token: res.data.token, deviceId: res.data.device.id };
}

/** Liste des profils (instances) disponibles pour l'écran de choix. */
export async function fetchProfiles(): Promise<Profile[]> {
    const res = await api.get<{ profiles: Profile[] }>('/profiles');
    return res.data.profiles ?? [];
}

/** Récupère toute la config à mettre en cache local, scopée sur un profil. */
export async function fetchBootstrap(profileId?: number | null): Promise<BootstrapPayload> {
    const res = await api.get<BootstrapPayload>('/bootstrap', {
        params: profileId ? { profile_id: profileId } : undefined,
    });
    return res.data;
}

/** Vérification du PIN en ligne (le hors-ligne reste prioritaire). */
export async function verifyPinOnline(userId: number, pin: string): Promise<boolean> {
    try {
        const res = await api.post('/auth/verify-pin', { user_id: userId, pin });
        return res.data?.valid === true;
    } catch {
        return false;
    }
}

/** Ouvre une session de caisse (admin identifié par PIN côté client), scopée profil. */
export async function openSession(openingCash: number, openedBy: number, profileId?: number | null): Promise<{ id: number }> {
    const res = await api.post('/sessions', {
        opening_cash: openingCash,
        opened_by: openedBy,
        ...(profileId ? { profile_id: profileId } : {}),
    });
    return res.data;
}

/** Aperçu avant fermeture : cash attendu + commandes non payées à annuler. */
export async function fetchSessionSummary(sessionId: number): Promise<any> {
    const res = await api.get(`/sessions/${sessionId}/summary`);
    return res.data;
}

/** Ferme la caisse : renvoie { report (Z détaillé), cancelled (commandes annulées) }. */
export async function closeSession(sessionId: number, closingCash: number, closedBy: number): Promise<{ report: any; cancelled: Order[] }> {
    const res = await api.post(`/sessions/${sessionId}/close`, { closing_cash: closingCash, closed_by: closedBy });
    return res.data;
}

/** Pousse l'outbox ; renvoie les {id, version} acceptés (version serveur à adopter). */
export async function pushOrders(orders: Order[]): Promise<{ accepted: { id: string; version: number }[] }> {
    const res = await api.post('/sync/orders', { orders });
    return res.data;
}

/** État partagé : commandes ouvertes/envoyées côté serveur (miroir), scopées profil. */
export async function fetchOpenOrders(profileId?: number | null): Promise<Order[]> {
    const res = await api.get<{ orders: Order[] }>('/orders/open', {
        params: profileId ? { profile_id: profileId } : undefined,
    });
    return res.data.orders ?? [];
}

/** Commande courante d'une table côté serveur (reprise sans doublon), ou null. */
export async function fetchTableOrder(tableId: number): Promise<Order | null> {
    const res = await api.get<{ order: Order | null }>(`/tables/${tableId}/order`);
    return res.data.order ?? null;
}
