import { Dimensions } from 'react-native';

/**
 * Orientation de l'écran, décidée selon la TAILLE de l'appareil.
 *
 * Le manifeste autorise toutes les orientations — indispensable pour qu'une
 * tablette puisse tourner, et c'est un réglage natif qu'aucune mise à jour à
 * distance ne peut modifier. Mais autoriser partout dégraderait les téléphones :
 * les écrans de prise de commande sont composés en colonne, et un iPhone couché
 * n'affiche plus que trois lignes de panier.
 *
 * D'où un arbitrage au démarrage :
 *  - téléphone  -> verrouillé en portrait, comme avant ;
 *  - tablette   -> libre, l'exploitant tourne l'écran comme il veut. C'est là
 *                  que le mode Comptoir prend tout son sens.
 *
 * Le seuil porte sur le PLUS PETIT côté de l'écran physique, jamais sur la
 * largeur courante : cette dernière change quand l'appareil tourne, et servirait
 * donc à décider… de ce qui vient de changer.
 */
const TABLETTE_MIN_DP = 600;

/**
 * Chargement TOLÉRANT du module natif.
 *
 * `expo-screen-orientation` a été ajouté après la publication des binaires en
 * service. Or `runtimeVersion` suit la version de l'application : EAS juge donc
 * la mise à jour compatible et l'envoie à des appareils dont le binaire ne
 * contient pas ce module. Un `import` statique fait alors échouer tout le
 * paquet au lancement, et l'appareil revient au paquet embarqué — il paraît
 * ignorer TOUTES les mises à jour suivantes, y compris celles qui n'ont rien à
 * voir. C'est arrivé.
 *
 * Un chargement paresseux protégé rend le paquet exécutable partout : sur un
 * ancien binaire l'orientation reste simplement telle qu'elle était, et le
 * reste des correctifs arrive normalement.
 */
function loadModule(): any | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('expo-screen-orientation');
    } catch {
        return null;
    }
}

export function isTabletDevice(): boolean {
    const { width, height } = Dimensions.get('screen');
    return Math.min(width, height) >= TABLETTE_MIN_DP;
}

/** À appeler une fois au démarrage. Silencieux en cas d'échec : jamais bloquant. */
export async function applyOrientationPolicy(): Promise<void> {
    const ScreenOrientation = loadModule();
    if (!ScreenOrientation?.lockAsync) {
        console.log('[orientation] module absent de ce binaire — réglage laissé tel quel');
        return;
    }

    try {
        if (isTabletDevice()) {
            await ScreenOrientation.unlockAsync();
        } else {
            await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        }
    } catch {
        // Un appareil qui refuse le verrouillage reste parfaitement utilisable.
    }
}
