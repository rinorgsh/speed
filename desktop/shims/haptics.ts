/**
 * Substitut bureau d'expo-haptics.
 *
 * Un ordinateur n'a pas de moteur haptique : les tablettes Windows visées non
 * plus, pour l'usage qui nous intéresse. On expose la même surface d'API, sans
 * effet, pour que `src/` reste rigoureusement identique entre le mobile et le
 * bureau — c'est le principe qui tient tout le portage Electron.
 */
export const ImpactFeedbackStyle = {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
    Rigid: 'rigid',
    Soft: 'soft',
} as const;

export const NotificationFeedbackType = {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
} as const;

export async function impactAsync(): Promise<void> {
    /* sans objet sur un ordinateur */
}

export async function selectionAsync(): Promise<void> {
    /* sans objet sur un ordinateur */
}

export async function notificationAsync(): Promise<void> {
    /* sans objet sur un ordinateur */
}

export default { ImpactFeedbackStyle, NotificationFeedbackType, impactAsync, selectionAsync, notificationAsync };
