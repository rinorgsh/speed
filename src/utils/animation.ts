import { AccessibilityInfo, LayoutAnimation, Platform, UIManager } from 'react-native';

/**
 * Transitions de mise en page.
 *
 * `LayoutAnimation` est intégré à React Native : aucun module natif, donc rien
 * qui empêche une mise à jour à distance — contrairement à `reanimated`.
 *
 * Ce qu'on anime ici est volontairement rare. Une caisse n'a pas besoin d'être
 * spectaculaire, elle a besoin d'être compréhensible : quand le pavé numérique
 * surgit d'un coup, on ne sait pas d'où il vient ni ce qui l'a fait apparaître.
 * Une transition de 180 ms suffit à relier la cause à l'effet.
 *
 * Respecte le réglage système « réduire les animations » : certains serveurs
 * l'activent, et une caisse ne doit jamais imposer du mouvement.
 */

// Ancienne architecture Android : les transitions de mise en page sont derrière
// un interrupteur. Sur la nouvelle (Fabric), l'appel n'existe plus et l'absence
// de garde ferait tomber le démarrage.
if (Platform.OS === 'android' && typeof UIManager.setLayoutAnimationEnabledExperimental === 'function') {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

let mouvementReduit = false;
void AccessibilityInfo.isReduceMotionEnabled()
    .then((v) => { mouvementReduit = v; })
    .catch(() => { /* réglage illisible : on garde les transitions */ });
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => { mouvementReduit = v; });

/**
 * À appeler JUSTE AVANT la modification d'état qui change la mise en page.
 * Sans effet si l'utilisateur a demandé moins de mouvement.
 */
export function transition(duree = 180): void {
    if (mouvementReduit) return;
    try {
        LayoutAnimation.configureNext({
            duration: duree,
            create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
            update: { type: LayoutAnimation.Types.easeInEaseOut },
            delete: { type: LayoutAnimation.Types.easeIn, property: LayoutAnimation.Properties.opacity },
        });
    } catch {
        /* Une transition ratée ne doit jamais empêcher l'état de changer. */
    }
}
