import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { useRealtime } from '../store/useRealtime';

/**
 * Pastille d'état réseau/synchro — rassure d'un coup d'œil :
 *  - vert « En ligne »   : connecté au temps réel, tout est synchronisé ;
 *  - orange « Synchro »  : des commandes locales restent à remonter (se résout seul) ;
 *  - gris « Hors ligne » : pas de connexion (l'app continue, ça remontera) ;
 *  - rouge « À vérifier »: commande écartée ou ticket non imprimé — il faut agir.
 */
export function SyncBadge() {
    const connected = useRealtime((s) => s.connected);
    const pending = useRealtime((s) => s.pending);
    const blocked = useRealtime((s) => s.blocked);
    const failedPrints = useRealtime((s) => s.failedPrints);

    /*
     * Ce qui BLOQUE prime sur ce qui est simplement en cours : une commande
     * écartée ou un ticket non imprimé demande une action humaine, alors qu'un
     * envoi en attente se résout tout seul. Afficher « En ligne » par-dessus un
     * ticket perdu, c'est rassurer à tort.
     */
    const problem = blocked + failedPrints;

    const { color, label, suffix } = problem > 0
        ? { color: theme.colors.danger, label: 'À vérifier', suffix: ` ${problem}` }
        : !connected
            ? { color: theme.colors.textFaint, label: 'Hors ligne', suffix: pending > 0 ? ` ${pending}` : '' }
            : pending > 0
                ? { color: theme.colors.warning, label: 'Synchro', suffix: ` ${pending}` }
                : { color: theme.colors.success, label: 'En ligne', suffix: '' };

    return (
        <View style={styles.wrap}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <Text style={styles.label}>{label}{suffix}</Text>
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
