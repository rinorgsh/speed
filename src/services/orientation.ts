import { Dimensions } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * Orientation de l'écran, décidée selon la TAILLE de l'appareil.
 *
 * Le manifeste autorise désormais toutes les orientations — c'est indispensable
 * pour qu'une tablette puisse tourner, et c'est un réglage natif qu'aucune mise
 * à jour à distance ne peut modifier. Mais autoriser partout dégraderait les
 * téléphones : les écrans de prise de commande sont composés en colonne, et un
 * iPhone couché n'affiche plus que trois lignes de panier.
 *
 * D'où un arbitrage au démarrage :
 *  - téléphone  -> verrouillé en portrait, comme avant ;
 *  - tablette   -> libre, l'exploitant tourne l'écran comme il veut. C'est là
 *                  que le mode Comptoir prend tout son sens (grille de produits
 *                  à gauche, ticket à droite).
 *
 * Le seuil porte sur le PLUS PETIT côté de l'écran physique, jamais sur la
 * largeur courante : cette dernière change quand l'appareil tourne, et servirait
 * donc à décider… de ce qui vient de changer.
 */
const TABLETTE_MIN_DP = 600;

export function isTabletDevice(): boolean {
    const { width, height } = Dimensions.get('screen');
    return Math.min(width, height) >= TABLETTE_MIN_DP;
}

/** À appeler une fois au démarrage. Silencieux en cas d'échec : ce n'est jamais bloquant. */
export async function applyOrientationPolicy(): Promise<void> {
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
