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

/** Montant TTC d'une ligne (les prix peuvent être saisis TVA comprise ou non). */
export function lineTtc(line: OrderLine): number {
    const rate = line.tax_rate_snapshot / 100;
    return line.price_includes_tax_snapshot ? line.line_total : line.line_total * (1 + rate);
}

/** Total TTC des lignes actives, avant remise. */
export function grossTotal(lines: OrderLine[]): number {
    return round2(lines.reduce((s, l) => (l.voided ? s : s + lineTtc(l)), 0));
}

/**
 * Recalcule subtotal (HT), tax_total et total (TTC) d'une commande.
 *
 * Une remise sur l'addition est répartie AU PRORATA sur toutes les lignes : sans
 * ça, la ventilation TVA du rapport Z serait fausse dès qu'une addition mélange
 * plusieurs taux (6 % sur les plats, 21 % sur l'alcool — le cas normal en HORECA).
 */
export function computeOrderTotals(
    lines: OrderLine[],
    discountAmount = 0,
): Pick<Order, 'subtotal' | 'tax_total' | 'total'> {
    const gross = grossTotal(lines);
    const discount = Math.min(Math.max(discountAmount, 0), gross);
    const ratio = gross > 0 ? (gross - discount) / gross : 1;

    let ttc = 0;
    let tax = 0;
    for (const l of lines) {
        if (l.voided) continue;
        const after = lineTtc(l) * ratio;
        const rate = l.tax_rate_snapshot / 100;
        tax += after - after / (1 + rate);
        ttc += after;
    }

    return {
        subtotal: round2(ttc - tax),
        tax_total: round2(tax),
        total: round2(ttc),
    };
}

/**
 * Montant réellement déduit pour une remise donnée.
 *
 * Un pourcentage est recalculé à chaque modification de l'addition (« 10 % »
 * doit rester 10 % si un café s'ajoute), alors qu'un montant fixe reste tel
 * quel — simplement plafonné au total. Le plafond `maxPercent` vient des
 * réglages de l'établissement et s'applique aux deux formes.
 */
export function discountAmountFor(
    lines: OrderLine[],
    type: 'percent' | 'amount',
    value: number,
    maxPercent = 100,
): number {
    const gross = grossTotal(lines);
    if (gross <= 0 || value <= 0) return 0;
    const raw = type === 'percent' ? (gross * value) / 100 : value;
    const ceiling = (gross * Math.min(Math.max(maxPercent, 0), 100)) / 100;
    return round2(Math.min(raw, ceiling, gross));
}

/** Somme des suppléments de prix d'une sélection d'options. */
export function optionsDelta(options: { price_delta: number }[]): number {
    return round2(options.reduce((s, o) => s + o.price_delta, 0));
}

export function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
