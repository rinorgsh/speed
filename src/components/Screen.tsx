import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';

/** Conteneur d'écran avec fond sombre et safe-area. */
export function Screen({
    children,
    style,
    edges = ['top', 'bottom'],
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
