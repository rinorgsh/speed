import { create } from 'zustand';
import * as db from '../db/database';
import type { Order, OrderLine, PaymentMethod, Product, SelectedOption, ServiceType } from '../types';
import { uuidv4 } from '../utils/uuid';
import { computeOrderTotals, discountAmountFor, lineTotal, optionsDelta, taxRateFor } from '../utils/pricing';
import { schedulePush } from '../services/sync';
import { useAuth } from './useAuth';
import { useConfig } from './useConfig';
import { useTables } from './useTables';

/**
 * Commande active. Mises à jour OPTIMISTES (mémoire d'abord, persist en fond).
 *
 * Modèle d'envoi en cuisine : chaque ligne suit `sent_qty` = quantité déjà
 * envoyée. Au clic « Order » :
 *  - qty > sent_qty  -> nouvelles unités à préparer (ticket normal).
 *  - qty < sent_qty  -> unités à annuler (ticket d'annulation).
 * Puis sent_qty = qty. Une ligne tombée à 0 (annulée) disparaît après envoi.
 */
export interface KitchenBatch {
    newLines: OrderLine[]; // unités à préparer (qty = delta)
    cancelLines: OrderLine[]; // unités à annuler (qty = delta)
}

interface CartState {
    order: Order | null;

    startNew: (params: { sessionId: number; serverId: number; roomId: number | null; tableId: number | null; serviceType?: ServiceType }) => void;
    resume: (order: Order) => void;
    applyRemoteOrder: (order: Order) => void;
    adoptServerFields: (remote: Order) => void;
    setServiceType: (t: ServiceType) => void;
    addLine: (product: Product, options: SelectedOption[], qty: number, note: string | null) => void;
    incrementLine: (lineId: string) => void;
    decrementLine: (lineId: string) => void;
    setLineQty: (lineId: string, qty: number) => void;
    setLinePrice: (lineId: string, price: number) => void;
    settleLines: (assignments: { lineId: string; qty: number }[]) => void;
    cancelOrder: () => void;
    sendToKitchen: () => KitchenBatch;
    addPayment: (method: PaymentMethod, amount: number) => void;
    removePayment: (index: number) => void;
    /** Remise sur l'addition (% ou montant). `value = 0` retire la remise. */
    setDiscount: (type: 'percent' | 'amount', value: number, reason: string, by: number) => void;
    clearDiscount: () => void;
    markPaid: () => void;
    clear: () => void;
    qtyOfProduct: (productId: number) => number;
    pendingNew: () => number;
    pendingCancel: () => number;
    amountPaid: () => number;
    remaining: () => number;
}

/**
 * Recalcule les totaux en tenant compte de la remise éventuelle. Un pourcentage
 * suit l'addition (10 % restent 10 % après ajout d'un café) ; un montant fixe
 * reste tel quel, plafonné au total.
 */
function recompute(order: Order): Order {
    const maxPercent = discountMaxPercent();
    const amount = order.discount_type
        ? discountAmountFor(order.lines, order.discount_type, order.discount_value ?? 0, maxPercent)
        : 0;

    return {
        ...order,
        discount_amount: amount,
        ...computeOrderTotals(order.lines, amount),
    };
}

/** Plafond de remise configuré dans l'admin (réglages de l'établissement). */
function discountMaxPercent(): number {
    const raw = useConfig.getState().settings.discount_max_percent;
    const n = raw != null ? Number(raw) : 100;
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 100;
}

function persist(order: Order): void {
    void db.saveOrder(order).catch(() => {});
}

function commit(set: (o: { order: Order }) => void, order: Order): void {
    set({ order });
    persist(order);
    schedulePush(); // remonte l'édition au serveur en continu (miroir temps réel)
}

export const useCart = create<CartState>((set, get) => ({
    order: null,

    startNew: ({ sessionId, serverId, roomId, tableId, serviceType = 'dine_in' }) => {
        const now = new Date().toISOString();
        set({
            order: {
                id: uuidv4(),
                profile_id: useAuth.getState().profileId,
                ticket_number: null, // attribué par le serveur à la 1re synchro
                version: 0,
                session_id: sessionId,
                room_id: roomId,
                table_id: tableId,
                server_id: serverId,
                status: 'open',
                service_type: serviceType,
                covers: null,
                subtotal: 0,
                tax_total: 0,
                total: 0,
                opened_at: now,
                paid_at: null,
                lines: [],
                payments: [],
            },
        });
    },

    resume: (order) => set({ order }),

    // Mise en miroir depuis le serveur : ne remplace QUE si c'est la commande ouverte
    // à l'écran (la garde anti-écrasement des éditions locales est faite en amont, DB).
    applyRemoteOrder: (order) => {
        const cur = get().order;
        if (!cur || cur.id !== order.id) return;
        set({ order });
    },

    // Adopte les champs attribués par le SERVEUR sur la commande ouverte (sans
    // écraser le reste) — notamment le n° de ticket, pour l'imprimer sur le reçu.
    adoptServerFields: (remote) => {
        const cur = get().order;
        if (!cur || cur.id !== remote.id) return;
        if (remote.ticket_number != null && cur.ticket_number == null) {
            commit(set, { ...cur, ticket_number: remote.ticket_number });
        }
    },

    setServiceType: (t) => {
        const order = get().order;
        if (!order) return;
        const { taxes, products } = useConfig.getState();
        const lines = order.lines.map((l) => {
            if (!l.product_id) return l;
            const product = products.find((p) => p.id === l.product_id);
            return product ? { ...l, tax_rate_snapshot: taxRateFor(product, t, taxes) } : l;
        });
        commit(set, recompute({ ...order, service_type: t, lines }));
    },

    addLine: (product, options, qty, note) => {
        const order = get().order;
        if (!order) return;
        const { taxes } = useConfig.getState();
        const rate = taxRateFor(product, order.service_type, taxes);
        const delta = optionsDelta(options);

        // Sans options ni note : on incrémente la ligne existante du produit (même
        // déjà envoyée -> les nouvelles unités seront à préparer).
        const existing = options.length === 0 && !note
            ? order.lines.find((l) => l.product_id === product.id && !l.voided && l.options_snapshot.length === 0 && !l.note)
            : undefined;

        let lines: OrderLine[];
        if (existing) {
            const newQty = existing.qty + qty;
            lines = order.lines.map((l) =>
                l.id === existing.id ? { ...l, qty: newQty, line_total: lineTotal(l.unit_price_snapshot, 0, newQty) } : l,
            );
        } else {
            lines = [...order.lines, {
                id: uuidv4(),
                order_id: order.id,
                product_id: product.id,
                name_snapshot: product.name,
                qty,
                unit_price_snapshot: product.price,
                tax_rate_snapshot: rate,
                price_includes_tax_snapshot: product.price_includes_tax,
                options_snapshot: options,
                note,
                line_total: lineTotal(product.price, delta, qty),
                sent_at: null,
                sent_qty: 0,
                voided: false,
                void_reason: null,
                voided_by: null,
            }];
        }

        commit(set, recompute({ ...order, lines }));
        if (order.table_id) useTables.getState().occupy(order.table_id);
    },

    incrementLine: (lineId) => {
        const order = get().order;
        if (!order) return;
        const lines = order.lines.map((l) => {
            if (l.id !== lineId) return l;
            const qty = l.qty + 1;
            return { ...l, qty, line_total: lineTotal(l.unit_price_snapshot, optionsDelta(l.options_snapshot), qty) };
        });
        commit(set, recompute({ ...order, lines }));
    },

    decrementLine: (lineId) => {
        const order = get().order;
        if (!order) return;
        const target = order.lines.find((l) => l.id === lineId);
        if (!target) return;
        // qty tombe à 0 (jamais supprimée physiquement) : masquée en UI (filtre qty>0)
        // mais conservée pour que la suppression se propage aux autres appareils.
        const q = Math.max(0, target.qty - 1);
        const lines = order.lines.map((l) =>
            l.id === lineId ? { ...l, qty: q, line_total: lineTotal(l.unit_price_snapshot, optionsDelta(l.options_snapshot), q) } : l,
        );
        commit(set, recompute({ ...order, lines }));
    },

    // Fixe la quantité (pavé Qty). qty<=0 -> ligne masquée (qty=0 conservée pour la synchro).
    setLineQty: (lineId, qty) => {
        const order = get().order;
        if (!order) return;
        const target = order.lines.find((l) => l.id === lineId);
        if (!target) return;
        const q = Math.max(0, qty);
        const lines = order.lines.map((l) =>
            l.id === lineId ? { ...l, qty: q, line_total: lineTotal(l.unit_price_snapshot, optionsDelta(l.options_snapshot), q) } : l,
        );
        commit(set, recompute({ ...order, lines }));
    },

    // Fixe le prix unitaire (pavé Price / prix libre).
    setLinePrice: (lineId, price) => {
        const order = get().order;
        if (!order) return;
        const p = Math.max(0, price);
        const lines = order.lines.map((l) =>
            l.id === lineId ? { ...l, unit_price_snapshot: p, line_total: lineTotal(p, optionsDelta(l.options_snapshot), l.qty) } : l,
        );
        commit(set, recompute({ ...order, lines }));
    },

    // Partage d'addition : retire de la commande mère les unités déjà réglées via un
    // sous-ticket. On aligne sent_qty sur la nouvelle qty (les articles payés sont
    // « soldés » — pas d'annulation cuisine, ils ont déjà été préparés).
    settleLines: (assignments) => {
        const order = get().order;
        if (!order) return;
        const lines = order.lines.map((l) => {
            const a = assignments.find((x) => x.lineId === l.id);
            if (!a) return l;
            const q = Math.max(0, l.qty - a.qty);
            return { ...l, qty: q, sent_qty: Math.min(l.sent_qty, q), line_total: lineTotal(l.unit_price_snapshot, optionsDelta(l.options_snapshot), q) };
        });
        commit(set, recompute({ ...order, lines }));
    },

    cancelOrder: () => {
        const order = get().order;
        if (!order) return;
        if (order.lines.length) commit(set, { ...order, status: 'cancelled' });
        if (order.table_id) useTables.getState().free(order.table_id);
        set({ order: null });
    },

    sendToKitchen: () => {
        const order = get().order;
        if (!order) return { newLines: [], cancelLines: [] };
        const now = new Date().toISOString();
        const newLines: OrderLine[] = [];
        const cancelLines: OrderLine[] = [];

        const updated = order.lines.map((l) => {
            const diff = l.qty - l.sent_qty;
            if (diff > 0) newLines.push({ ...l, qty: diff });
            else if (diff < 0) cancelLines.push({ ...l, qty: -diff });
            return { ...l, sent_qty: l.qty, sent_at: l.qty > 0 ? (l.sent_at ?? now) : l.sent_at };
        });

        // Les lignes à 0 restent en base (masquées par le filtre qty>0) pour que
        // l'annulation se propage aux autres appareils ; elles ne s'affichent plus.
        const anySent = updated.some((l) => l.sent_qty > 0);
        commit(set, recompute({ ...order, lines: updated, status: anySent ? 'sent' : order.status }));

        return { newLines, cancelLines };
    },

    addPayment: (method, amount) => {
        const order = get().order;
        if (!order) return;
        commit(set, { ...order, payments: [...order.payments, { method, amount }] });
    },

    removePayment: (index) => {
        const order = get().order;
        if (!order) return;
        commit(set, { ...order, payments: order.payments.filter((_, i) => i !== index) });
    },

    setDiscount: (type, value, reason, by) => {
        const order = get().order;
        if (!order) return;
        if (value <= 0) {
            get().clearDiscount();
            return;
        }
        // recompute() calcule le montant réellement déduit (plafond compris)
        // et les totaux nets de remise.
        commit(set, recompute({
            ...order,
            discount_type: type,
            discount_value: value,
            discount_reason: reason.trim() || null,
            discount_by: by,
        }));
    },

    clearDiscount: () => {
        const order = get().order;
        if (!order) return;
        commit(set, recompute({
            ...order,
            discount_type: null,
            discount_value: null,
            discount_amount: 0,
            discount_reason: null,
            discount_by: null,
        }));
    },

    markPaid: () => {
        const order = get().order;
        if (!order) return;
        commit(set, { ...order, status: 'paid', paid_at: new Date().toISOString() });
        if (order.table_id) useTables.getState().free(order.table_id);
    },

    clear: () => set({ order: null }),

    qtyOfProduct: (productId) =>
        (get().order?.lines ?? [])
            .filter((l) => l.product_id === productId && !l.voided)
            .reduce((s, l) => s + l.qty, 0),

    // Unités à préparer (nouvelles) / à annuler, pour les deux champs du bouton Order.
    pendingNew: () =>
        (get().order?.lines ?? []).reduce((s, l) => s + Math.max(0, l.qty - l.sent_qty), 0),
    pendingCancel: () =>
        (get().order?.lines ?? []).reduce((s, l) => s + Math.max(0, l.sent_qty - l.qty), 0),

    amountPaid: () => (get().order?.payments ?? []).reduce((s, p) => s + p.amount, 0),
    remaining: () => {
        const order = get().order;
        if (!order) return 0;
        const paid = order.payments.reduce((s, p) => s + p.amount, 0);
        return Math.round((order.total - paid) * 100) / 100;
    },
}));
