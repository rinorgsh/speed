import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Delete } from 'lucide-react-native';
import { theme } from '../theme';

/** Pavé numérique réutilisable (PIN, montants cash). */
/**
 * Pavé numérique. `compact` plafonne la taille des touches : sur une tablette,
 * 31 % de la largeur donnerait des touches démesurées.
 */
export function Keypad({ onKey, onDelete, compact = false }: { onKey: (digit: string) => void; onDelete: () => void; compact?: boolean }) {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
    return (
        <View style={styles.grid}>
            {keys.map((k) => (
                <Pressable
                    key={k}
                    onPress={() => (k === 'del' ? onDelete() : onKey(k))}
                    style={({ pressed }) => [styles.key, compact && styles.keyCompact, pressed && styles.keyPressed]}
                >
                    {k === 'del' ? (
                        <Delete color={theme.colors.text} size={26} />
                    ) : (
                        <Text style={styles.keyText}>{k}</Text>
                    )}
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', maxWidth: 480, alignSelf: 'center', width: '100%' },
    key: {
        width: '31%',
        aspectRatio: 1.5,
        marginBottom: theme.spacing(3),
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
    },
    keyCompact: { maxWidth: 150, aspectRatio: 1.7 },
    keyPressed: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong },
    keyText: { color: theme.colors.text, fontSize: 42, fontWeight: '700' },
});
