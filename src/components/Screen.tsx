import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';

/**
 * Conteneur d'écran avec fond sombre et marges de sécurité.
 *
 * Les côtés sont inclus par défaut : en paysage, l'encoche et les coins
 * arrondis mordent sur les bords gauche/droite, pas seulement en haut.
 */
export function Screen({
    children,
    style,
    edges = ['top', 'bottom', 'left', 'right'],
}: {
    children: React.ReactNode;
    style?: ViewStyle;
    edges?: readonly Edge[];
}) {
    return (
        <SafeAreaView style={styles.safe} edges={edges}>
            <View style={[styles.inner, style]}>{children}</View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.colors.bg },
    inner: { flex: 1, padding: theme.spacing(4) },
});
