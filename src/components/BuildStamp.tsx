import React from 'react';
import { StyleSheet, Text } from 'react-native';
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
 */
export function BuildStamp() {
    const version = Updates.runtimeVersion ?? '—';
    const maj = Updates.updateId ? Updates.updateId.slice(0, 8) : 'embarqué';
    const date = Updates.createdAt
        ? new Date(Updates.createdAt).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' })
        : null;

    return (
        <Text style={styles.stamp} numberOfLines={1}>
            v{version} · {maj}{date ? ` · ${date}` : ''}
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
