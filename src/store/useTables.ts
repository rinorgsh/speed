import { create } from 'zustand';
import * as db from '../db/database';
import type { TableSummary } from '../types';

/**
 * État d'occupation des tables, tenu EN MÉMOIRE pour un rendu instantané
 * (zéro lecture DB au moment d'afficher la grille). Mis à jour de façon
 * optimiste (occupy/free) et resynchronisé depuis la base / le temps réel.
 */
interface TablesState {
    occupied: number[];
    // table_id -> nb d'articles pas encore envoyés en cuisine (badge rouge).
    pending: Record<number, number>;
    // table_id -> montant / couverts / serveur / heure d'ouverture (mode plan).
    summaries: Record<number, TableSummary>;
    setOccupied: (ids: number[]) => void;
    occupy: (id: number) => void;
    free: (id: number) => void;
    isOccupied: (id: number) => boolean;
    refresh: () => Promise<void>;
}

export const useTables = create<TablesState>((set, get) => ({
    occupied: [],
    pending: {},
    summaries: {},

    setOccupied: (ids) => set({ occupied: ids }),

    occupy: (id) =>
        set((s) => (s.occupied.includes(id) ? s : { occupied: [...s.occupied, id] })),

    free: (id) => set((s) => {
        const pending = { ...s.pending };
        const summaries = { ...s.summaries };
        delete pending[id];
        delete summaries[id];
        return { occupied: s.occupied.filter((x) => x !== id), pending, summaries };
    }),

    isOccupied: (id) => get().occupied.includes(id),

    // Source de vérité : tables ouvertes + compteur d'articles en attente d'envoi.
    refresh: async () => {
        const [ids, pending, summaries] = await Promise.all([
            db.getOpenTableIds(),
            db.getTablePendingCounts(),
            db.getTableSummaries(),
        ]);
        set({ occupied: ids, pending, summaries });
    },
}));
