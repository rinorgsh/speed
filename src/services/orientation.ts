import { Dimensions } from 'react-native';

/**
 * Orientation de l'écran, décidée selon la TAILLE de l'appareil.
 *
 *  - téléphone  -> verrouillé en portrait : les écrans de prise de commande
 *                  sont composés en colonne, un iPhone couché n'affiche plus
 *                  que trois lignes de panier ;
 *  - tablette   -> libre, c'est là que le mode Comptoir prend son sens.
 *
 * Le seuil porte sur le PLUS PETIT côté de l'écran physique, jamais sur la
 * largeur courante : cette dernière change quand l'appareil tourne, et servirait
 * donc à décider… de ce qui vient de changer.
 */
const TABLETTE_MIN_DP = 600;

/**
 * PRÉSENCE DU MODULE NATIF — à ne pas simplifier.
 *
 * `expo-screen-orientation` a été ajouté après la publication des binaires en
 * service. Or `runtimeVersion` suit la version de l'application : EAS envoie
 * donc les mises à jour à des appareils dont le binaire ne contient pas ce
 * module.
 *
 * Le 14/08/2026, cela a fait planter la caisse en production. Un `import`
 * statique d'abord, puis un `require()` protégé par `try/catch` — insuffisant :
 * le require déclenche côté natif la recherche d'un module absent, et
 * l'exception levée là ne traverse PAS le JavaScript. Aucun garde-fou JS ne
 * peut la rattraper, l'application s'arrête net.
 *
 * On interroge donc le registre des modules natifs AVANT tout require. Tant que
 * le binaire ne l'expose pas, on ne touche jamais au module et l'orientation
 * reste celle du manifeste. Le jour où un build embarquant le module est
 * installé, la fonction s'active toute seule, sans nouvelle publication.
 */
function moduleNatifPresent(): boolean {
    const modules = (globalThis as any)?.expo?.modules;
    return !!modules?.ExpoScreenOrientation;
}

export function isTabletDevice(): boolean {
    const { width, height } = Dimensions.get('screen');
    return Math.min(width, height) >= TABLETTE_MIN_DP;
}

/** À appeler une fois au démarrage. Sans effet tant que le binaire n'a pas le module. */
export async function applyOrientationPolicy(): Promise<void> {
    if (!moduleNatifPresent()) {
        console.log('[orientation] module absent de ce binaire — réglage laissé tel quel');
        return;
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ScreenOrientation = require('expo-screen-orientation');
        if (isTabletDevice()) {
            await ScreenOrientation.unlockAsync();
        } else {
            await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        }
    } catch (e: any) {
        // Un appareil qui refuse le verrouillage reste parfaitement utilisable.
        console.log('[orientation] réglage impossible :', e?.message ?? e);
    }
}
