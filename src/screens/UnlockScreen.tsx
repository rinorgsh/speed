import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Star, Store, ChevronDown, RefreshCw, CloudOff, RotateCcw } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { theme } from '../theme';
import { useConfig } from '../store/useConfig';
import { useAuth } from '../store/useAuth';
import { useFavorites } from '../store/useFavorites';
import type { RootStackParamList } from '../navigation/types';

/**
 * Écran d'accueil / verrouillage : choix direct du serveur (grille de cartes).
 * Fusionne l'ancien « Déverrouiller » + « Choix du serveur » : la config se
 * synchronise en fond, le profil actif est visible (chip) et modifiable en 1 tap.
 */
export function UnlockScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Unlock'>) {
    const users = useConfig((s) => s.users);
    const settings = useConfig((s) => s.settings);
    const sync = useConfig((s) => s.syncFromServer);
    const lastSyncError = useConfig((s) => s.lastSyncError);
    const refreshSession = useAuth((s) => s.refreshSession);
    const profileName = useAuth((s) => s.profileName);
    const clearActiveProfile = useAuth((s) => s.clearActiveProfile);
    const apiUrl = useAuth((s) => s.apiUrl);
    const resetDevice = useAuth((s) => s.resetDevice);
    const favoriteIds = useFavorites((s) => s.ids);
    const loadFavorites = useFavorites((s) => s.load);
    const toggleFavorite = useFavorites((s) => s.toggle);
    const [syncing, setSyncing] = useState(false);

    const runSync = useCallback(async () => {
        setSyncing(true);
        await sync();
        await refreshSession();
        setSyncing(false);
    }, [sync, refreshSession]);

    // Sync silencieuse en fond à chaque affichage (la grille reste dispo via le cache).
    useFocusEffect(useCallback(() => {
        void loadFavorites();
        void runSync();
    }, [runSync, loadFavorites]));

    const ordered = useMemo(() => {
        const favs = users.filter((u) => favoriteIds.includes(u.id));
        const rest = users.filter((u) => !favoriteIds.includes(u.id));
        return [...favs, ...rest];
    }, [users, favoriteIds]);

    // Appui long sur le nom : réinitialiser l'appareil (changer de serveur/URL).
    const onResetPress = () => {
        Alert.alert(
            'Réinitialiser l\'appareil',
            `Effacer l'enrôlement actuel ?\n\nServeur : ${apiUrl ?? '—'}`,
            [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Réinitialiser', style: 'destructive', onPress: () => void resetDevice() },
            ],
        );
    };

    return (
        <Screen>
            <View style={styles.topbar}>
                <Pressable onLongPress={onResetPress} delayLongPress={800}>
                    <Text style={styles.brand}>{settings.restaurant_name ?? 'POS Horeca'}</Text>
                    <Text style={styles.brandSub}>{syncing ? 'Synchronisation…' : 'Point de vente'}</Text>
                </Pressable>
                <Pressable style={styles.profileChip} onPress={() => void clearActiveProfile()}>
                    <Store color={theme.colors.primary} size={16} />
                    <Text style={styles.profileChipText} numberOfLines={1}>{profileName ?? 'Profil'}</Text>
                    <ChevronDown color={theme.colors.textMuted} size={15} />
                </Pressable>
            </View>

            <Text style={styles.title}>Choisir un serveur</Text>
            <ScrollView contentContainerStyle={styles.grid}>
                {ordered.map((u) => {
                    const fav = favoriteIds.includes(u.id);
                    return (
                        <Pressable
                            key={u.id}
                            style={({ pressed }) => [styles.card, fav && styles.cardFav, pressed && styles.cardPressed]}
                            onPress={() => navigation.navigate('Pin', { userId: u.id })}
                            onLongPress={() => toggleFavorite(u.id)}
                            delayLongPress={400}
                        >
                            {fav && (
                                <View style={styles.starBadge}>
                                    <Star color="#fff" size={16} fill="#f59e0b" strokeWidth={1.5} />
                                </View>
                            )}
                            <View style={[styles.avatar, { backgroundColor: u.color ?? theme.colors.surfaceAlt }]}>
                                <Text style={styles.initial}>{u.name.charAt(0).toUpperCase()}</Text>
                            </View>
                            <Text style={styles.name} numberOfLines={1}>{u.name}</Text>
                        </Pressable>
                    );
                })}
                {/*
                  * Aucune donnée en cache : on n'affiche JAMAIS un cul-de-sac. On
                  * explique, on propose de réessayer et, en dernier recours, de
                  * changer de serveur. (Motif du rejet App Store 2.1(a).)
                  */}
                {!ordered.length && (
                    <View style={styles.emptyBox}>
                        {syncing ? (
                            <>
                                <ActivityIndicator color={theme.colors.primary} size="large" />
                                <Text style={styles.emptyText}>Chargement de la configuration…</Text>
                            </>
                        ) : (
                            <>
                                <CloudOff color={theme.colors.textFaint} size={40} />
                                <Text style={styles.emptyTitle}>Configuration non chargée</Text>
                                <Text style={styles.emptyText}>
                                    {lastSyncError ?? 'Aucun utilisateur reçu du serveur.'}
                                </Text>
                                <Pressable style={styles.primaryBtn} onPress={() => void runSync()}>
                                    <RefreshCw color={theme.colors.onPrimary} size={18} />
                                    <Text style={styles.primaryBtnText}>Réessayer</Text>
                                </Pressable>
                                <Pressable style={styles.ghostBtn} onPress={onResetPress} hitSlop={8}>
                                    <RotateCcw color={theme.colors.textFaint} size={15} />
                                    <Text style={styles.ghostBtnText}>Changer de serveur</Text>
                                </Pressable>
                            </>
                        )}
                    </View>
                )}
            </ScrollView>
        </Screen>
    );
}

const styles = StyleSheet.create({
    topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing(5) },
    brand: { color: theme.colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
    brandSub: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
    profileChip: {
        flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2),
        backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.pill,
        paddingHorizontal: theme.spacing(3.5), paddingVertical: theme.spacing(2.5),
        maxWidth: 170,
    },
    profileChipText: { color: theme.colors.text, fontWeight: '700', fontSize: 14, flexShrink: 1 },
    title: { color: theme.colors.text, fontSize: 20, fontWeight: '800', marginBottom: theme.spacing(4) },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(4), paddingBottom: theme.spacing(6) },
    card: {
        width: '47%',
        aspectRatio: 1,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing(3.5),
        borderWidth: 1,
        borderColor: theme.colors.border,
        ...theme.shadow.card,
    },
    cardFav: { borderColor: theme.colors.warning, borderWidth: 2 },
    cardPressed: { borderColor: theme.colors.borderStrong, transform: [{ scale: 0.97 }] },
    starBadge: { position: 'absolute', top: theme.spacing(3), right: theme.spacing(3) },
    avatar: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
    initial: { color: '#fff', fontSize: 38, fontWeight: '800' },
    name: { color: theme.colors.text, fontSize: 22, fontWeight: '700', paddingHorizontal: theme.spacing(2) },
    emptyBox: { width: '100%', alignItems: 'center', gap: theme.spacing(3), marginTop: theme.spacing(10) },
    emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '800', marginTop: theme.spacing(1) },
    emptyText: { color: theme.colors.textMuted, textAlign: 'center', paddingHorizontal: theme.spacing(4), lineHeight: 20 },
    primaryBtn: {
        flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2.5),
        backgroundColor: theme.colors.primary, borderRadius: theme.radius.pill,
        paddingHorizontal: theme.spacing(6), paddingVertical: theme.spacing(3.5), marginTop: theme.spacing(3),
    },
    primaryBtnText: { color: theme.colors.onPrimary, fontWeight: '800', fontSize: 16 },
    ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2), paddingVertical: theme.spacing(3) },
    ghostBtnText: { color: theme.colors.textFaint, fontSize: 13 },
});
