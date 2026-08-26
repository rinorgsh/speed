import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import type { Product } from '../types';

/**
 * Tuile d'un produit dans la grille de vente.
 *
 * Deux rendus, selon que le produit a un visuel :
 *  - AVEC image : elle occupe toute la tuile, le nom repose sur un voile sombre
 *    en bas. Les visuels sont normalisés en carré côté serveur.
 *  - SANS image : carte neutre au filet coloré. La couleur du produit distingue
 *    la famille sans transformer la grille en aplat — un écran entier de tuiles
 *    pleines n'offre aucun repère à l'œil, qui doit alors lire chaque case.
 *
 * Le nom tient sur DEUX lignes. Sur une tuile carrée d'iPhone, une seule ligne
 * coupait les libellés au point de rendre deux plats indiscernables : « Duo de
 * croquettes de… » pouvait désigner les crevettes comme le fromage.
 *
 * Performance : on utilise l'`Image` de React Native, pas un module natif —
 * l'application doit rester livrable par mise à jour OTA. Le cache disque du
 * système suffit, car l'URL des visuels porte une empreinte de contenu : elle
 * ne change jamais pour une même image, et change forcément pour une autre.
 */
interface Props {
    product: Product;
    size: number;
    /** Quantité déjà au ticket, affichée en pastille. */
    qty: number;
    /** Libellé du prix (« 4,50 € » ou « Prix libre »). */
    price: string;
    /**
     * Réglage d'établissement « Afficher le prix sur les produits ». Faux, la
     * légende se réduit au nom et lui laisse toute la place. Par défaut vrai :
     * une tuile sans prix ne doit jamais être un accident.
     */
    showPrice?: boolean;
    onPress: () => void;
}

/**
 * Voile de lisibilité sous le nom.
 *
 * Un PNG de 2×96 px — 320 octets — allant du transparent au noir, étiré par
 * l'`Image` de React Native. Une seule vue, un dégradé PARFAIT sur n'importe
 * quel fond, et aucun module natif : `expo-linear-gradient` imposerait une
 * nouvelle build sur chaque appareil et nous priverait des mises à jour OTA.
 *
 * La première tentative empilait deux calques d'opacité fixe. Sur une photo
 * sombre ça passait ; sur les visuels de cocktails, détourés sur blanc, les deux
 * calques ressortaient en BANDES GRISES franches en travers du verre.
 */
const VOILE_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAABgCAYAAAA3iqN1AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAzSURBVCjP7c4xCgAgDATBifH/X9bGVHaCYOFVCwvHshZI6GgFucGZuvf8U9/p+amlAgMmKfwDcpwwcfYAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDgtMjZUMDg6NDE6MTQrMDA6MDDNnDeIAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA4LTI2VDA4OjQxOjE0KzAwOjAwvMGPNAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wOC0yNlQwODo0MToxNCswMDowMOvUrusAAAAASUVORK5CYII=';

export function ProductTile({ product, size, qty, price, showPrice = true, onPress }: Props) {
    const hasImage = !!product.image_url;
    const couleur = product.color ?? theme.colors.borderStrong;

    return (
        <Pressable
            onPress={onPress}
            disabled={!product.available}
            style={[
                styles.tile,
                { width: size, height: size },
                hasImage
                    ? styles.tileImage
                    // Le filet coloré tient sur le bord gauche : il suffit à ranger
                    // le produit dans sa famille sans noyer la grille de couleur.
                    : [styles.tilePlain, { borderLeftColor: couleur }],
                !product.available && styles.unavailable,
            ]}
        >
            {hasImage ? (
                <>
                    <Image
                        source={{ uri: product.image_url! }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                        // Pas de fondu : dans une grille, l'apparition décalée des
                        // vignettes donne une impression de lenteur.
                        fadeDuration={0}
                    />
                    <Image source={{ uri: VOILE_URI }} style={styles.voile} resizeMode="stretch" />
                    <View style={styles.caption}>
                        <Text style={styles.captionName} numberOfLines={2}>{product.name}</Text>
                        {showPrice && <Text style={styles.captionPrice}>{price}</Text>}
                    </View>
                </>
            ) : (
                <View style={[styles.plain, !showPrice && styles.plainCentre]}>
                    <Text style={[styles.plainName, !showPrice && styles.plainNameBig]} numberOfLines={4}>
                        {product.name}
                    </Text>
                    {showPrice && <Text style={styles.plainPrice}>{price}</Text>}
                </View>
            )}

            {qty > 0 && (
                <View style={styles.counter}>
                    <Text style={styles.counterText}>{qty % 1 === 0 ? qty : qty.toFixed(2)}</Text>
                </View>
            )}
            {!product.available && <Text style={styles.badge86}>86</Text>}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    tile: { borderRadius: theme.radius.md, overflow: 'hidden' },
    tileImage: { backgroundColor: '#000' },
    tilePlain: {
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderLeftWidth: 3,
    },
    unavailable: { opacity: 0.4 },

    // Rendu avec visuel
    // 44 % : deux lignes de nom en demandent 35, et le visuel garde sa lumière.
    voile: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '44%' },
    caption: {
        position: 'absolute', left: 0, right: 0, bottom: 0,
        paddingHorizontal: theme.spacing(1.5), paddingBottom: theme.spacing(1.5),
    },
    captionName: {
        color: '#fff', fontWeight: '700', fontSize: 13, lineHeight: 15, letterSpacing: -0.1,
        // Filet de sécurité : le dégradé fait le travail, mais si l'image venait
        // à ne pas charger, le nom doit rester lisible sur un visuel détouré sur blanc.
        textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 },
    },
    captionPrice: {
        color: '#fff', fontWeight: '800', fontSize: 13, marginTop: 2,
        fontVariant: ['tabular-nums'],
    },

    // Rendu sans visuel
    plain: { flex: 1, padding: theme.spacing(2.5), justifyContent: 'space-between' },
    // Prix masqué : plus rien à caler en bas, le nom se centre au lieu de flotter
    // en haut d'une carte vide.
    plainCentre: { justifyContent: 'center' },
    plainName: { color: theme.colors.text, fontWeight: '600', fontSize: 14, lineHeight: 17 },
    plainNameBig: { fontSize: 16, lineHeight: 19, fontWeight: '700' },
    plainPrice: {
        color: theme.colors.textMuted, fontWeight: '800', fontSize: 13, textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },

    counter: {
        position: 'absolute', top: 6, right: 6, minWidth: 26, height: 26, borderRadius: 13,
        backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
        borderWidth: 1, borderColor: theme.colors.border,
    },
    counterText: { color: theme.colors.bg, fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },
    badge86: {
        position: 'absolute', top: 6, left: 8, color: '#fff', fontWeight: '800',
        textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3,
    },
});
