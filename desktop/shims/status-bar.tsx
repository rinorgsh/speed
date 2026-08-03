/**
 * Substitut d'`expo-status-bar` : une fenêtre de bureau n'a pas de barre d'état
 * système à styler. Le composant existe pour que `App.tsx` reste inchangé.
 */
export function StatusBar(_props: Record<string, unknown>): null {
    return null;
}

export default StatusBar;
