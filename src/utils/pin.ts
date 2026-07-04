import bcrypt from 'bcryptjs';
import type { User } from '../types';

/**
 * Vérification du PIN HORS-LIGNE contre le pin_hash bcrypt synchronisé.
 * Laravel hache en $2y$ ; bcryptjs attend $2a$/$2b$ — préfixes compatibles,
 * on normalise avant comparaison.
 *
 * Version ASYNCHRONE : bcryptjs découpe le calcul (setImmediate) au lieu de
 * bloquer le fil JS — l'UI reste fluide pendant la vérification.
 */
export function verifyPinOffline(user: User, pin: string): Promise<boolean> {
    if (!user.pin_hash) return Promise.resolve(false);
    const hash = user.pin_hash.replace(/^\$2y\$/, '$2a$');

    return new Promise((resolve) => {
        bcrypt.compare(pin, hash, (err, ok) => resolve(!err && ok === true));
    });
}
