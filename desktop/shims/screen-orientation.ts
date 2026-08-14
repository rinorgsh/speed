/**
 * Substitut bureau d'expo-screen-orientation.
 *
 * Une fenêtre Electron se redimensionne librement : la notion d'orientation
 * verrouillée n'a aucun sens ici. On expose la même surface d'API, sans effet,
 * pour que `src/` reste identique entre le mobile et le bureau.
 */
export const OrientationLock = {
    DEFAULT: 0,
    ALL: 1,
    PORTRAIT: 2,
    PORTRAIT_UP: 3,
    LANDSCAPE: 4,
} as const;

export async function lockAsync(): Promise<void> {
    /* sans objet sur un ordinateur */
}

export async function unlockAsync(): Promise<void> {
    /* sans objet sur un ordinateur */
}

export default { OrientationLock, lockAsync, unlockAsync };
