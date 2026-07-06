import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { useRealtime } from '../store/useRealtime';

/**
 * Pastille d'état réseau/synchro — rassure d'un coup d'œil :
 *  - vert « En ligne »  : connecté au temps réel, tout est synchronisé ;
 *  - orange « Synchro » : des commandes locales restent à remonter ;
 *  - gris « Hors ligne » : pas de connexion (l'app continue de marcher, ça remontera).
 */
export function SyncBadge() {
    const connected = useRealtime((s) => s.connected);
    const pending = useRealtime((s) => s.pending);

    const { color, label } = !connected
        ? { color: theme.colors.textFaint, label: 'Hors ligne' }
        : pending > 0
            ? { color: theme.colors.warning, label: 'Synchro' }
            : { color: theme.colors.success, label: 'En ligne' };

    return (
        <View style={styles.wrap}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <Text style={styles.label}>{label}{pending > 0 && connected ? ` ${pending}` : ''}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing(1.5),
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.pill,
        paddingHorizontal: theme.spacing(2.5),
        paddingVertical: theme.spacing(1.5),
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    label: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
});
