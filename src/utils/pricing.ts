import type { Order, OrderLine, Product, ServiceType, Tax } from '../types';

/**
 * Calcul d'addition. La TVA dépend du service_type (sur place / à emporter) via
 * la TVA alternative du produit. Les montants figés (snapshots) sont posés à la
 * création de la ligne ; on recalcule ici les totaux de commande.
 */

/** Taux de TVA applicable à un produit selon le type de service. */
export function taxRateFor(product: Product, serviceType: ServiceType, taxes: Tax[]): number {
    const taxId = serviceType === 'takeaway' && product.tax_takeaway_id ? product.tax_takeaway_id : product.tax_id;
    return taxes.find((t) => t.id === taxId)?.rate ?? 0;
}

/** Total d'une ligne : (prix unitaire + suppléments d'options) * quantité. */
export function lineTotal(unitPrice: number, optionsDelta: number, qty: number): number {
    return round2((unitPrice + optionsDelta) * qty);
}

/** Recalcule subtotal (HT), tax_total et total (TTC) d'une commande. */
export function computeOrderTotals(lines: OrderLine[]): Pick<Order, 'subtotal' | 'tax_total' | 'total'> {
    let total = 0;
    let tax = 0;
    for (const l of lines) {
        if (l.voided) continue;
        total += l.line_total;
        const rate = l.tax_rate_snapshot / 100;
        const lineTax = l.price_includes_tax_snapshot
            ? l.line_total - l.line_total / (1 + rate)
            : l.line_total * rate;
        tax += lineTax;
    }
    const totalTtc = round2(lines.reduce((s, l) => (l.voided ? s : s + (l.price_includes_tax_snapshot ? l.line_total : l.line_total * (1 + l.tax_rate_snapshot / 100))), 0));
    return {
        subtotal: round2(total - tax),
        tax_total: round2(tax),
        total: round2(totalTtc),
    };
}

/** Somme des suppléments de prix d'une sélection d'options. */
export function optionsDelta(options: { price_delta: number }[]): number {
    return round2(options.reduce((s, o) => s + o.price_delta, 0));
}

export function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
