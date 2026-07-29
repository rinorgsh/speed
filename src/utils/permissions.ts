import type { User } from '../types';

/**
 * Droits pilotés depuis l'admin web (table `settings`). Le mobile lit ces
 * réglages via le bootstrap : ils sont donc appliqués même hors-ligne.
 */

export type DiscountPolicy = 'admin' | 'manager' | 'all';

/** Politique configurée, avec repli sur la valeur la plus prudente. */
export function discountPolicy(settings: Record<string, string | null>): DiscountPolicy {
    const raw = settings.discount_policy;
    return raw === 'admin' || raw === 'manager' || raw === 'all' ? raw : 'manager';
}

/** Cet utilisateur peut-il accorder une remise sur l'addition ? */
export function canDiscount(user: User | null, settings: Record<string, string | null>): boolean {
    if (!user) return false;
    switch (discountPolicy(settings)) {
        case 'all':
            return true;
        case 'admin':
            return user.role === 'admin';
        case 'manager':
        default:
            return user.role === 'admin' || user.role === 'manager';
    }
}

/** Plafond de remise en pourcentage (100 par défaut). */
export function discountMaxPercent(settings: Record<string, string | null>): number {
    const n = settings.discount_max_percent != null ? Number(settings.discount_max_percent) : 100;
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 100;
}
