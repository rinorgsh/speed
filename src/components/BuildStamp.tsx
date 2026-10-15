import React from 'react';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import * as Updates from 'expo-updates';
import { theme } from '../theme';

/**
 * Version réellement exécutée par CET appareil.
 *
 * Sans repère visible, impossible de savoir si une tablette tourne sur le code
 * du jour ou sur celui d'avant-hier — et une même consigne appliquée à deux
 * appareils donne alors deux comportements, sans qu'on puisse le diagnostiquer
 * autrement qu'à tâtons. C'est arrivé assez souvent pour mériter cette ligne.
 *
 * `updateId` est nul tant qu'aucune mise à jour à distance n'a été appliquée :
 * l'appareil exécute le paquet embarqué dans l'installation. On l'affiche donc
 * explicitement comme « embarqué » plutôt que de laisser un vide ambigu.
 *
 * La LARGEUR LOGIQUE est affichée aussi, et ce n'est pas un détail : c'est elle
 * qui décide du nombre de colonnes. Une tablette Samsung dont le réglage « taille
 * d'écran » est poussé se déclare bien plus étroite qu'elle ne l'est, et affiche
 * alors une grille de téléphone sur douze pouces. Sans ce chiffre, on cherche le
 * défaut dans le code pendant que la cause est dans les réglages de l'appareil.
 */
export function BuildStamp() {
    const { width } = useWindowDimensions();

    /*
     * Entièrement protégé. Ce n'est qu'un repère de diagnostic : il ne doit
     * JAMAIS pouvoir empêcher l'écran d'accueil de s'afficher. Une constante
     * absente sur une plateforme ou un binaire donné ferait tomber tout l'écran
     * — et donc la caisse — pour une ligne de texte grise.
     */
    let libelle = '';
    try {
        const version = Updates.runtimeVersion ?? '—';
        const maj = Updates.updateId ? String(Updates.updateId).slice(0, 8) : 'embarqué';
        const brut = Updates.createdAt ? new Date(Updates.createdAt) : null;
        const date = brut && !Number.isNaN(brut.getTime())
            ? brut.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' })
            : null;

        libelle = `v${version} · ${maj}${date ? ` · ${date}` : ''} · ${Math.round(width)}pt`;
    } catch {
        return null;
    }

    return (
        <Text style={styles.stamp} numberOfLines={1}>
            {libelle}
        </Text>
    );
}

const styles = StyleSheet.create({
    stamp: {
        color: theme.colors.textFaint,
        fontSize: 11,
        textAlign: 'center',
        paddingBottom: theme.spacing(2),
    },
});
