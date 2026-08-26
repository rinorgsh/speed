/**
 * Retour tactile.
 *
 * C'est ce qui sépare une caisse d'une page web : le serveur doit sentir sous
 * son doigt que l'article est passé, sans quitter la salle des yeux. Un écran
 * qui ne répond que visuellement oblige à vérifier après chaque appui.
 *
 * ── Prudence, après l'incident du 14/08/2026 ──────────────────────────────
 * `expo-haptics` est un module NATIF. Il n'est présent que dans les binaires
 * construits après son ajout ; une mise à jour OTA envoyée à un binaire plus
 * ancien ne le trouverait pas.
 *
 * Deux protections, l'une derrière l'autre :
 *  1. la version de l'application est passée à 1.1.0, ce qui donne une version
 *     de référence distincte : les anciens binaires ne recevront PLUS ces
 *     mises à jour, au lieu de les recevoir et de tomber ;
 *  2. on interroge le registre des modules natifs avant tout appel, et chaque
 *     appel est isolé — un retour tactile absent ne doit JAMAIS empêcher une
 *     commande de partir.
 *
 * `expo-haptics` s'appuie lui-même sur `requireOptionalNativeModule`, donc son
 * import ne lève rien : contrairement à `expo-screen-orientation`, il ne peut
 * pas faire planter le démarrage. Le contrôle reste par cohérence.
 */
import * as Haptics from 'expo-haptics';

let disponible: boolean | null = null;

function actif(): boolean {
    if (disponible === null) {
        const modules = (globalThis as any)?.expo?.modules;
        disponible = !!modules?.ExpoHaptics;
        if (!disponible) {
            console.log('[haptique] module absent de ce binaire — retours tactiles désactivés');
        }
    }
    return disponible;
}

/** Enveloppe tout appel : le tactile est un confort, jamais une dépendance. */
function sansRisque(fn: () => Promise<void>): void {
    if (!actif()) return;
    try {
        void fn().catch(() => {});
    } catch {
        /* Le Taptic Engine est indisponible (mode économie d'énergie, réglage
           utilisateur, appareil photo actif) : on continue sans. */
    }
}

/** Article ajouté au ticket. Le geste le plus fréquent du service. */
export function ajout(): void {
    sansRisque(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Changement d'onglet, sélection d'une ligne : une tape sèche et discrète. */
export function selection(): void {
    sansRisque(() => Haptics.selectionAsync());
}

/** Commande envoyée en cuisine, paiement accepté. */
export function reussite(): void {
    sansRisque(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Envoi refusé, imprimante injoignable, paiement incomplet. */
export function echec(): void {
    sansRisque(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
