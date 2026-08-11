import { useAuth } from '../store/useAuth';
import { useConfig } from '../store/useConfig';
import type { User } from '../types';

/**
 * Ouverture de session d'un serveur sur la caisse.
 *
 * Deux chemins y mènent — la saisie du PIN, et l'appui direct sur un serveur
 * autorisé à travailler sans code — et ils doivent faire exactement la même
 * chose. Cette séquence est mise en commun pour qu'un correctif appliqué à
 * l'une profite à l'autre.
 *
 * Retourne l'état de caisse constaté, à charge de l'écran appelant de router :
 * la navigation diffère selon l'écran d'origine, pas la logique.
 */
export type SignInOutcome = 'rooms' | 'open-session' | 'no-session';

export async function signInAs(user: User): Promise<SignInOutcome> {
    useAuth.getState().setServer(user);

    // Synchro DÉFINITIVE avant d'entrer en salle : garantit que la config
    // (salles, carte…) ET l'état de caisse correspondent bien au profil courant,
    // même si un changement de profil vient d'avoir lieu (plus de données
    // périmées ni de fausse invite « ouvrir la caisse »).
    await useConfig.getState().syncFromServer();
    await useAuth.getState().refreshSession();

    if (useAuth.getState().session) {
        return 'rooms';
    }

    // Seul un administrateur peut ouvrir la caisse ; les autres doivent attendre.
    return user.role === 'admin' ? 'open-session' : 'no-session';
}

/**
 * Ce serveur ouvre-t-il sa session sans code ?
 *
 * `no_pin` est un réglage EXPLICITE de l'admin, volontairement distinct d'un
 * `pin_hash` absent : ce dernier signifie « ne peut pas ouvrir de session sur
 * la caisse » (cas d'un administrateur qui n'utilise que le back-office web).
 * Les confondre ouvrirait la caisse à tout porteur de la tablette.
 */
export function signsInWithoutPin(user: User): boolean {
    return user.no_pin === true;
}
