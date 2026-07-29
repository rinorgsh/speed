import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Keypad } from '../components/Keypad';
import { theme } from '../theme';
import { useConfig } from '../store/useConfig';
import { useAuth } from '../store/useAuth';
import { verifyPinOffline } from '../utils/pin';
import type { RootStackParamList } from '../navigation/types';
import { useT } from '../i18n';

const PIN_LENGTH = 4;

/** Saisie du PIN, vérifié HORS-LIGNE contre le pin_hash en cache. */
export function PinScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Pin'>) {
    const { userId } = route.params;
    const user = useConfig((s) => s.users.find((u) => u.id === userId));
    const sync = useConfig((s) => s.syncFromServer);
    const setServer = useAuth((s) => s.setServer);
    const refreshSession = useAuth((s) => s.refreshSession);
    const [pin, setPin] = useState('');
    const [checking, setChecking] = useState(false);
    const t = useT();

    // Le serveur choisi n'est plus en cache (config resynchronisée entre-temps) :
    // on informe au lieu d'afficher un écran vide.
    if (!user) {
        return (
            <Screen>
                <View style={styles.header}>
                    <Text style={styles.name}>{t('Utilisateur introuvable')}</Text>
                    <Text style={styles.hint}>{t('La configuration a changé. Revenez et choisissez à nouveau.')}</Text>
                </View>
            </Screen>
        );
    }

    const submit = async (value: string) => {
        if (checking) return;
        setChecking(true);
        const ok = await verifyPinOffline(user, value);
        if (!ok) {
            setChecking(false);
            setPin('');
            Alert.alert(t('PIN incorrect'), t('Réessayez.'));
            return;
        }
        setServer(user);

        // Synchro DÉFINITIVE avant d'entrer en salle : garantit que la config
        // (salles, carte…) ET l'état de caisse correspondent bien au profil courant,
        // même si un changement de profil vient d'avoir lieu (plus de données
        // périmées ni de fausse invite « ouvrir la caisse »).
        await sync();
        await refreshSession();
        const session = useAuth.getState().session;
        setChecking(false);

        // Routage selon l'état de la caisse.
        if (session) {
            navigation.reset({ index: 0, routes: [{ name: 'Rooms' }] });
        } else if (user.role === 'admin') {
            navigation.replace('OpenSession');
        } else {
            Alert.alert(t('Caisse fermée'), t('Aucune session ouverte. Demandez à un administrateur d\'ouvrir la caisse.'));
            navigation.goBack();
        }
    };

    const onKey = (d: string) => {
        if (d === '.' || checking || pin.length >= PIN_LENGTH) return; // pas de point dans un PIN
        const next = (pin + d).slice(0, PIN_LENGTH);
        setPin(next);
        // Validation automatique dès le 4e chiffre — pas de bouton à cliquer.
        if (next.length === PIN_LENGTH) void submit(next);
    };

    return (
        <Screen>
            <View style={styles.header}>
                <Text style={styles.name}>{user.name}</Text>
                <Text style={styles.hint}>{checking ? t('Vérification…') : t('Saisissez votre code PIN')}</Text>
                <View style={styles.dots}>
                    {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                        <View key={i} style={[styles.pinDot, i < pin.length && styles.pinDotFilled]} />
                    ))}
                </View>
            </View>
            <Keypad onKey={onKey} onDelete={() => setPin((p) => p.slice(0, -1))} />
        </Screen>
    );
}

const styles = StyleSheet.create({
    header: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    name: { color: theme.colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
    hint: { color: theme.colors.textMuted, marginTop: theme.spacing(2), marginBottom: theme.spacing(7), fontSize: 15 },
    dots: { flexDirection: 'row', gap: theme.spacing(4) },
    pinDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: theme.colors.borderStrong },
    pinDotFilled: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
});
