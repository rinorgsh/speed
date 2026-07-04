import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Store, PartyPopper, ChevronRight, RotateCcw } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { theme } from '../theme';
import { useAuth } from '../store/useAuth';
import { useConfig } from '../store/useConfig';
import { fetchProfiles } from '../api/client';
import type { Profile } from '../types';

/**
 * Choix du profil (« instance ») après l'enrôlement : Restaurant, Event…
 * Chaque profil a sa carte, son plan de salle et ses imprimantes. Le choix est
 * mémorisé ; cet écran ne réapparaît qu'au 1er lancement ou via « Changer de profil ».
 */
export function ProfileSelectScreen() {
    const setProfile = useAuth((s) => s.setProfile);
    const resetDevice = useAuth((s) => s.resetDevice);
    const refreshSession = useAuth((s) => s.refreshSession);
    const apiUrl = useAuth((s) => s.apiUrl);
    const sync = useConfig((s) => s.syncFromServer);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [selecting, setSelecting] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setProfiles(await fetchProfiles());
        } catch (e: any) {
            setError(e?.response?.data?.message ?? e?.message ?? 'Réseau indisponible');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const choose = async (p: Profile) => {
        setSelecting(p.id);
        await setProfile(p.id, p.name);
        await sync(); // charge la config du profil choisi
        await refreshSession(); // récupère l'état de caisse propre à ce profil
        setSelecting(null);
        // Le RootNavigator bascule automatiquement vers l'écran de déverrouillage.
    };

    const onReset = () => {
        Alert.alert(
            'Réinitialiser l\'appareil',
            `Effacer l'enrôlement ?\n\nServeur : ${apiUrl ?? '—'}`,
            [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Réinitialiser', style: 'destructive', onPress: () => void resetDevice() },
            ],
        );
    };

    return (
        <Screen>
            <View style={styles.header}>
                <Text style={styles.title}>Choix du profil</Text>
                <Text style={styles.subtitle}>Sélectionnez le mode d'utilisation</Text>
            </View>

            {loading ? (
                <View style={styles.center}><ActivityIndicator color={theme.colors.primary} size="large" /></View>
            ) : error ? (
                <View style={styles.center}>
                    <Text style={styles.error}>{error}</Text>
                    <Pressable onPress={load} style={styles.retry}><Text style={styles.retryText}>Réessayer</Text></Pressable>
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.list}>
                    {profiles.map((p) => {
                        const Icon = p.type === 'event' ? PartyPopper : Store;
                        const busy = selecting === p.id;
                        return (
                            <Pressable key={p.id} onPress={() => choose(p)} disabled={selecting != null} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
                                <View style={styles.cardIcon}><Icon color={theme.colors.primary} size={28} /></View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.cardName}>{p.name}</Text>
                                    <Text style={styles.cardType}>{p.type === 'event' ? 'Événement' : 'Restaurant'}</Text>
                                </View>
                                {busy ? <ActivityIndicator color={theme.colors.textMuted} /> : <ChevronRight color={theme.colors.textMuted} size={22} />}
                            </Pressable>
                        );
                    })}
                    {!profiles.length && <Text style={styles.empty}>Aucun profil disponible.</Text>}
                </ScrollView>
            )}

            <Pressable onPress={onReset} style={styles.resetBtn} hitSlop={8}>
                <RotateCcw color={theme.colors.textFaint} size={16} />
                <Text style={styles.resetText}>Réinitialiser le serveur (URL)</Text>
            </Pressable>
        </Screen>
    );
}

const styles = StyleSheet.create({
    header: { marginTop: theme.spacing(4), marginBottom: theme.spacing(6) },
    title: { color: theme.colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
    subtitle: { color: theme.colors.textMuted, fontSize: 15, marginTop: theme.spacing(1.5) },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing(4) },
    list: { gap: theme.spacing(3), paddingBottom: theme.spacing(4) },
    card: {
        flexDirection: 'row', alignItems: 'center', gap: theme.spacing(4),
        backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
        borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(4.5),
    },
    cardPressed: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.primary },
    cardIcon: {
        width: 56, height: 56, borderRadius: theme.radius.md, backgroundColor: theme.colors.primarySoft,
        alignItems: 'center', justifyContent: 'center',
    },
    cardName: { color: theme.colors.text, fontSize: 19, fontWeight: '800' },
    cardType: { color: theme.colors.textMuted, fontSize: 14, marginTop: 2 },
    empty: { color: theme.colors.textMuted, textAlign: 'center', marginTop: theme.spacing(8) },
    error: { color: theme.colors.danger, textAlign: 'center' },
    retry: { paddingHorizontal: theme.spacing(5), paddingVertical: theme.spacing(3), backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border },
    retryText: { color: theme.colors.text, fontWeight: '700' },
    resetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing(2), paddingVertical: theme.spacing(3) },
    resetText: { color: theme.colors.textFaint, fontSize: 13 },
});
