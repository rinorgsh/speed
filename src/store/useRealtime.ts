import { create } from 'zustand';

/**
 * Signal de rafraîchissement temps réel. Les events de table/commande
 * incrémentent `tableTick` ; les écrans concernés (grille des tables) le
 * surveillent pour re-interroger le cache local.
 */
interface RealtimeState {
    connected: boolean;
    tableTick: number;
    pending: number; // commandes locales pas encore synchronisées (outbox)
    setConnected: (v: boolean) => void;
    bumpTables: () => void;
    setPending: (n: number) => void;
}

export const useRealtime = create<RealtimeState>((set) => ({
    connected: false,
    tableTick: 0,
    pending: 0,
    setConnected: (v) => set({ connected: v }),
    bumpTables: () => set((s) => ({ tableTick: s.tableTick + 1 })),
    setPending: (n) => set({ pending: n }),
}));
