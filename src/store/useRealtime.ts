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
    /** Commandes ÉCARTÉES après refus répétés : elles ne repartiront pas seules. */
    blocked: number;
    /** Tickets d'impression en échec, conservés et relançables. */
    failedPrints: number;
    setConnected: (v: boolean) => void;
    bumpTables: () => void;
    setPending: (n: number) => void;
    setBlocked: (n: number) => void;
    setFailedPrints: (n: number) => void;
}

let bumpTimer: ReturnType<typeof setTimeout> | null = null;

export const useRealtime = create<RealtimeState>((set) => ({
    connected: false,
    tableTick: 0,
    pending: 0,
    blocked: 0,
    failedPrints: 0,
    setConnected: (v) => set({ connected: v }),
    // Regroupé : quand trois appareils synchronisent en même temps, les échos
    // arrivent par paquets et faisaient repartir la grille à chaque message.
    bumpTables: () => {
        if (bumpTimer) return;
        bumpTimer = setTimeout(() => {
            bumpTimer = null;
            set((s) => ({ tableTick: s.tableTick + 1 }));
        }, 120);
    },
    setPending: (n) => set({ pending: n }),
    setBlocked: (n) => set({ blocked: n }),
    setFailedPrints: (n) => set({ failedPrints: n }),
}));
