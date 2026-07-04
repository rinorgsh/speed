import { create } from 'zustand';
import * as db from '../db/database';
import { fetchBootstrap } from '../api/client';
import { useAuth } from './useAuth';
import type { Category, OptionGroup, Printer, Product, RealtimeConfig, Room, Table, Tax, User } from '../types';

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
    categories: Category[];
    products: Product[];
    optionGroups: OptionGroup[];
    realtimeConfig: RealtimeConfig | null;
    lastSyncError: string | null;

    loadFromCache: () => Promise<void>;
    syncFromServer: () => Promise<boolean>;
    applyProductUpdate: (p: Product) => Promise<void>;
    applyAvailability: (id: number, available: boolean) => Promise<void>;
    applyCategoryUpdate: (c: Category) => Promise<void>;
    productsByCategory: (categoryId: number) => Product[];
    optionGroup: (id: number) => OptionGroup | undefined;
    receiptPrinter: () => Printer | undefined;
    fallbackOrderPrinter: () => Printer | null;
}

export const useConfig = create<ConfigState>((set, get) => ({
    ready: false,
    settings: {},
    users: [],
    rooms: [],
    tables: [],
    taxes: [],
    printers: [],
    categories: [],
    products: [],
    optionGroups: [],
    realtimeConfig: null,
    lastSyncError: null,

    loadFromCache: async () => {
        const [settings, users, rooms, tables, taxes, printers, categories, products, optionGroups, realtimeConfig] = await Promise.all([
            db.getSettings(),
            db.getUsers(),
            db.getRooms(),
            db.getAllTables(),
            db.getTaxes(),
            db.getPrinters(),
            db.getCategories(),
            db.getProducts(),
            db.getOptionGroups(),
            db.getRealtimeConfig(),
        ]);
        set({ settings, users, rooms, tables, taxes, printers, categories, products, optionGroups, realtimeConfig, ready: true });
    },

    syncFromServer: async () => {
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
            set({ lastSyncError: e?.message ?? 'Sync échouée' });
            return false;
        }
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
