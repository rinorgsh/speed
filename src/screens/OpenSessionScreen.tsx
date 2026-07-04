import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Keypad } from '../components/Keypad';
import { Button } from '../components/Button';
import { theme } from '../theme';
import { openSession } from '../api/client';
import { useAuth } from '../store/useAuth';
import { useConfig } from '../store/useConfig';
import type { RootStackParamList } from '../navigation/types';

/** Ouverture de session de caisse par un admin : déclaration du fond de caisse. */
export function OpenSessionScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'OpenSession'>) {
    const setSession = useAuth((s) => s.setSession);
    const server = useAuth((s) => s.server);
    const profileId = useAuth((s) => s.profileId);
    const sync = useConfig((s) => s.syncFromServer);
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);

    const open = async () => {
        if (!server) return;
        const value = parseFloat(amount || '0');
        setLoading(true);
        try {
            const res = await openSession(value, server.id, profileId);
            // On resynchronise pour récupérer la session ouverte côté serveur.
            await sync();
            setSession({
                id: res.id,
                status: 'open',
                opened_by: 0,
                opened_at: new Date().toISOString(),
                opening_cash: value,
                closed_by: null,
                closed_at: null,
                closing_cash: null,
            });
            navigation.reset({ index: 0, routes: [{ name: 'Rooms' }] });
        } catch (e: any) {
            Alert.alert('Ouverture impossible', e?.response?.data?.message ?? 'Connexion au serveur requise pour ouvrir la caisse.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Screen>
            <Text style={styles.title}>Ouverture de caisse</Text>
            <Text style={styles.subtitle}>Fond de caisse déclaré</Text>
            <View style={styles.amountBox}>
                <Text style={styles.amount}>{amount || '0'} €</Text>
            </View>
            <Keypad
                onKey={(d) => setAmount((a) => (d === '.' && a.includes('.') ? a : a + d))}
                onDelete={() => setAmount((a) => a.slice(0, -1))}
            />
            <Button label="Ouvrir la caisse" variant="success" onPress={open} loading={loading} />
        </Screen>
    );
}

const styles = StyleSheet.create({
    title: { color: theme.colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
    subtitle: { color: theme.colors.textMuted, marginTop: theme.spacing(1), marginBottom: theme.spacing(5), fontSize: 15 },
    amountBox: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        paddingVertical: theme.spacing(7),
        alignItems: 'center',
        marginBottom: theme.spacing(5),
    },
    amount: { color: theme.colors.text, fontSize: 44, fontWeight: '800', letterSpacing: -1 },
});
