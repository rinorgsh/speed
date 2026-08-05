import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import type { Product } from '../types';

/**
 * Tuile d'un produit dans la grille de vente.
 *
 * Deux rendus, selon que le produit a un visuel :
 *  - AVEC image : elle occupe toute la tuile, le nom et le prix passent dans un
 *    bandeau sombre en bas. Les visuels sont normalisés en carré sur fond blanc
 *    côté serveur, donc un bandeau foncé reste lisible sur tous.
 *  - SANS image : la tuile colorée d'origine, inchangée. Aucune régression pour
 *    les produits qui n'auront jamais de photo (café, vin au verre…).
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
    onPress: () => void;
}

export function ProductTile({ product, size, qty, price, onPress }: Props) {
    const hasImage = !!product.image_url;

    return (
        <Pressable
            onPress={onPress}
            disabled={!product.available}
            style={[
                styles.tile,
                { width: size, height: size },
                // Fond blanc derrière un visuel : les images sont détourées sur
                // blanc, la couleur du produit transparaîtrait sur les bords.
                { backgroundColor: hasImage ? '#fff' : product.color ?? theme.colors.surface },
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
                    <View style={styles.caption}>
                        <Text style={styles.captionName} numberOfLines={1}>{product.name}</Text>
                        <Text style={styles.captionPrice}>{price}</Text>
                    </View>
                </>
            ) : (
                <View style={styles.plain}>
                    <Text style={styles.plainName} numberOfLines={2}>{product.name}</Text>
                    <Text style={styles.plainPrice}>{price}</Text>
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
    unavailable: { opacity: 0.4 },

    // Rendu avec visuel
    caption: {
        position: 'absolute', left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.62)',
        paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(1.5),
    },
    captionName: { color: '#fff', fontWeight: '700', fontSize: 13 },
    captionPrice: { color: '#fff', fontWeight: '800', fontSize: 14, marginTop: 1 },

    // Rendu sans visuel (tuile d'origine)
    plain: { flex: 1, padding: theme.spacing(2.5), justifyContent: 'space-between' },
    plainName: { color: '#fff', fontWeight: '700', fontSize: 14 },
    plainPrice: { color: '#fff', fontWeight: '800', fontSize: 15 },

    counter: {
        position: 'absolute', top: 6, right: 6, minWidth: 26, height: 26, borderRadius: 13,
        backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
        borderWidth: 1, borderColor: theme.colors.border,
    },
    counterText: { color: theme.colors.bg, fontWeight: '800', fontSize: 14 },
    badge86: {
        position: 'absolute', top: 6, left: 8, color: '#fff', fontWeight: '800',
        textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3,
    },
});
