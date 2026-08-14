/**
 * Exécute une tâche de fond sans jamais laisser son échec remonter.
 *
 * En release, une promesse rejetée depuis un rappel natif (base locale, socket,
 * minuteur) est transformée par React Native en exception fatale : l'application
 * s'arrête net. C'est ce qui s'est produit le 14/08/2026 pendant la
 * synchronisation au démarrage — l'écran s'affichait, puis la caisse se fermait.
 *
 * Règle : tout `void maFonction()` lancé depuis un effet, un minuteur ou un
 * rappel d'événement passe par ici. L'échec est journalisé, jamais fatal.
 */
export function guard(nom: string, tache: () => Promise<unknown>): void {
    try {
        void Promise.resolve(tache()).catch((e: any) =>
            console.log(`[guard] ${nom} en échec :`, e?.message ?? e),
        );
    } catch (e: any) {
        console.log(`[guard] ${nom} a levé immédiatement :`, e?.message ?? e);
    }
}
