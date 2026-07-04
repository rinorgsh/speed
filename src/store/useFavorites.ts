import { create } from 'zustand';
import * as db from '../db/database';

/**
 * Favoris serveurs, LOCAUX à l'appareil (chaque terminal a ses favoris).
 * Persistés dans device_prefs (jamais effacés par la synchro de config).
 */
interface FavoritesState {
    ids: number[];
    loaded: boolean;
    load: () => Promise<void>;
    toggle: (userId: number) => Promise<void>;
    isFavorite: (userId: number) => boolean;
}

export const useFavorites = create<FavoritesState>((set, get) => ({
    ids: [],
    loaded: false,

    load: async () => {
        const ids = await db.getFavoriteUserIds();
        set({ ids, loaded: true });
    },

    toggle: async (userId) => {
        const ids = get().ids.includes(userId)
            ? get().ids.filter((id) => id !== userId)
            : [...get().ids, userId];
        set({ ids });
        await db.setFavoriteUserIds(ids);
    },

    isFavorite: (userId) => get().ids.includes(userId),
}));
