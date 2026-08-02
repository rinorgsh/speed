import { create } from 'zustand';
import * as db from '../db/database';
import { fetchBootstrap } from '../api/client';
import { NETWORK } from '../config';
import { useAuth } from './useAuth';
import { useLocale } from '../i18n';
import type { Category, OptionGroup, PrepStation, Printer, Product, QuickNote, RealtimeConfig, Room, Table, Tax, User } from '../types';

/**
 * Config en cache (offline-first). loadFromCache lit le SQLite local ;
 * syncFromServer tente un bootstrap réseau puis ré-importe le cache.
 */
interface ConfigState {
    ready: boolean;
    settings: Record<string, string | null>;
    users: User[];
    rooms: Room[];
    tables: Table[];
    taxes: Tax[];
    printers: Printer[];
    prepStations: PrepStation[];
    /** Suggestions proposées à la saisie d'une note d'article. */
    quickNotes: QuickNote[];
    categories: Category[];
    products: Product[];
    optionGroups: OptionGroup[];
    realtimeConfig: RealtimeConfig | null;
    lastSyncError: string | null;

    loadFromCache: () => Promise<void>;
    /** Synchro de la config. Ne tourne jamais deux fois en parallèle (single-flight). */
    syncFromServer: () => Promise<boolean>;
    applyProductUpdate: (p: Product) => Promise<void>;
    applyAvailability: (id: number, available: boolean) => Promise<void>;
    applyCategoryUpdate: (c: Category) => Promise<void>;
    productsByCategory: (categoryId: number) => Product[];
    optionGroup: (id: number) => OptionGroup | undefined;
    receiptPrinter: () => Printer | undefined;
    fallbackOrderPrinter: () => Printer | null;
}

/** Promesse de synchro en cours (garde single-flight, cf. syncFromServer). */
let inFlightSync: Promise<boolean> | null = null;

/** Message lisible par un utilisateur non technique (affiché à l'écran). */
function syncErrorMessage(e: any): string {
    const status = e?.response?.status;
    if (status === 401 || status === 403) return 'Appareil non autorisé. Réinitialisez l\'appareil et enrôlez-le à nouveau.';
    if (status && status >= 500) return 'Le serveur est indisponible. Réessayez dans un instant.';
    if (e?.code === 'ECONNABORTED') return 'Le serveur met trop de temps à répondre. Vérifiez la connexion.';
    if (e?.message === 'Network Error') return 'Pas de connexion au serveur. Vérifiez le réseau.';
    return e?.message ?? 'Synchronisation impossible.';
}

export const useConfig = create<ConfigState>((set, get) => ({
    ready: false,
    settings: {},
    users: [],
    rooms: [],
    tables: [],
    taxes: [],
    printers: [],
    prepStations: [],
    quickNotes: [],
    categories: [],
    products: [],
    optionGroups: [],
    realtimeConfig: null,
    lastSyncError: null,

    loadFromCache: async () => {
        const [settings, users, rooms, tables, taxes, printers, prepStations, quickNotes, categories, products, optionGroups, realtimeConfig] = await Promise.all([
            db.getSettings(),
            db.getUsers(),
            db.getRooms(),
            db.getAllTables(),
            db.getTaxes(),
            db.getPrinters(),
            db.getPrepStations(),
            db.getQuickNotes(),
            db.getCategories(),
            db.getProducts(),
            db.getOptionGroups(),
            db.getRealtimeConfig(),
        ]);
        set({ settings, users, rooms, tables, taxes, printers, prepStations, quickNotes, categories, products, optionGroups, realtimeConfig, ready: true });
        // Langue de l'établissement : appliquée tant que l'appareil n'a pas
        // fait de choix explicite (cf. useLocale.overridden).
        useLocale.getState().applyEstablishment(settings.default_locale);
    },

    syncFromServer: async () => {
        // Single-flight : l'écran de choix de profil, le focus de l'écran d'accueil
        // et le retour au premier plan déclenchent la synchro quasi simultanément.
        // Deux imports concurrents (DELETE + INSERT de toute la config) pouvaient
        // se marcher dessus et laisser un cache vide -> « Aucun serveur ».
        if (inFlightSync) return inFlightSync;

        inFlightSync = (async () => {
            let lastError: any = null;
            try {
                // Une seconde tentative absorbe les aléas d'un premier appel sur
                // serveur froid (le 1er lancement après installation, typiquement).
                for (let attempt = 1; attempt <= NETWORK.syncAttempts; attempt++) {
                    try {
                        const profileId = useAuth.getState().profileId;
                        const payload = await fetchBootstrap(profileId);
                        // Anti-course : si le profil actif a changé pendant la requête (ou si le
                        // serveur a renvoyé un autre profil), on IGNORE cette réponse périmée
                        // pour ne jamais écraser la config du profil courant.
                        if (payload.profile_id !== useAuth.getState().profileId) {
                            return false;
                        }
                        await db.importBootstrap(payload);
                        await get().loadFromCache();
                        set({ lastSyncError: null });
                        return true;
                    } catch (e: any) {
                        lastError = e;
                        // Inutile de réessayer si le serveur nous refuse (token invalide).
                        const status = e?.response?.status;
                        if (status === 401 || status === 403) break;
                        if (attempt < NETWORK.syncAttempts) {
                            await new Promise((r) => setTimeout(r, 1500));
                        }
                    }
                }

                set({ lastSyncError: syncErrorMessage(lastError) });
                // Le cache précédent est intact : on le recharge pour rester utilisable.
                await get().loadFromCache().catch(() => {});
                return false;
            } finally {
                inFlightSync = null;
            }
        })();

        return inFlightSync;
    },

    // Application des events temps réel : cache SQLite + état en mémoire.
    applyProductUpdate: async (p) => {
        await db.upsertProduct(p);
        set((s) => {
            const exists = s.products.some((x) => x.id === p.id);
            const products = exists ? s.products.map((x) => (x.id === p.id ? p : x)) : [...s.products, p];
            return { products };
        });
    },

    applyAvailability: async (id, available) => {
        await db.setProductAvailability(id, available);
        set((s) => ({ products: s.products.map((p) => (p.id === id ? { ...p, available } : p)) }));
    },

    applyCategoryUpdate: async (c) => {
        await db.upsertCategory(c);
        set((s) => {
            const exists = s.categories.some((x) => x.id === c.id);
            const categories = exists ? s.categories.map((x) => (x.id === c.id ? c : x)) : [...s.categories, c];
            return { categories };
        });
    },

    productsByCategory: (categoryId) => get().products.filter((p) => p.category_id === categoryId),
    optionGroup: (id) => get().optionGroups.find((g) => g.id === id),
    receiptPrinter: () => get().printers.find((p) => p.role === 'receipt' && p.active),
    fallbackOrderPrinter: () => get().printers.find((p) => p.role === 'order' && p.active) ?? null,
}));
