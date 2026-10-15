/**
 * Calcul des grilles de vente, PARTAGÉ par les deux écrans de prise de commande.
 *
 * Il y en a deux — `PosScreen` sur téléphone, `ComptoirScreen` sur tablette — et
 * chacun avait sa propre arithmétique. Corriger l'un laissait l'autre intact :
 * une tablette affichait encore des cases de 165 pt et des onglets qui filaient
 * horizontalement, alors que le téléphone était déjà passé à la grille. Le calcul
 * vit désormais à un seul endroit.
 */

/** Marge latérale des grilles. */
export const H_PAD = 12;

/** Espace entre deux cellules. */
export const GAP = 10;

/**
 * Taille de tuile produit VISÉE, en points.
 *
 * On ne fige pas le nombre de colonnes : avec 5 colonnes imposées, une tuile
 * d'iPad faisait 192 pt contre 115 sur iPhone — presque le double, alors qu'un
 * doigt a la même taille sur les deux. On vise donc une taille physique
 * constante et on en DÉDUIT les colonnes.
 */
export const TUILE_VISEE = 124;

/**
 * Largeur visée d'un onglet de catégorie.
 *
 * Plus étroite qu'une tuile : un onglet porte du texte, pas une photo, et on
 * veut en voir le plus possible d'un coup d'œil.
 */
export const ONGLET_VISE = 108;

/** Hauteur des deux étages d'onglets. */
export const H_CAT = 54;
export const H_SOUS = 48;

export const COLS_MIN = 3;   // un téléphone étroit ne descend pas en dessous
export const COLS_MAX = 8;   // au-delà, un nom ne tient plus sur deux lignes

/**
 * Colonnes et largeur de cellule pour une largeur disponible donnée.
 *
 * Toutes les cellules font la MÊME taille et remplissent la ligne : c'est ce qui
 * distingue une grille d'un simple retour à la ligne. Des boutons taillés sur
 * leur texte laissaient un vide en fin de rangée et donnaient des cibles
 * inégales — la plus courte étant la plus dure à viser.
 *
 * @param largeur   place disponible, marges latérales COMPRISES
 * @param vise      largeur souhaitée d'une cellule
 * @param min / max bornes du nombre de colonnes
 */
export function grille(
    largeur: number,
    vise: number = TUILE_VISEE,
    min: number = COLS_MIN,
    max: number = COLS_MAX,
): { cols: number; taille: number } {
    /*
     * ARRONDI au plus proche, et non troncature.
     *
     * `Math.floor` prend le nombre de colonnes tel que chacune fasse AU MOINS la
     * taille visée — donc la dépasse dès qu'on est juste sous un seuil. Sur la
     * grille comptoir de 516 pt, une cible de 124 donnait 3 colonnes de 157, soit
     * un quart de trop. L'arrondi accepte de descendre un peu sous la cible pour
     * en rester beaucoup plus près : 4 colonnes de 115.
     */
    const utile = largeur - H_PAD * 2 + GAP;
    const cols = Math.min(max, Math.max(min, Math.round(utile / (vise + GAP))));

    return { cols, taille: Math.floor((largeur - H_PAD * 2 - GAP * (cols - 1)) / cols) };
}

/** Rangées réellement nécessaires, plafonnées : un bandeau ne réserve que ce qu'il utilise. */
export function rangees(nombre: number, cols: number, max: number): number {
    return Math.min(max, Math.max(1, Math.ceil(nombre / Math.max(1, cols))));
}
