import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { theme } from '../theme';
import { useAuth } from '../store/useAuth';
import { useConfig } from '../store/useConfig';
import { DEFAULTS } from '../config';

/**
 * Premier lancement : l'appareil s'enrôle (URL serveur + secret) et reçoit un
 * token, puis on télécharge la config en cache. Cet écran ne réapparaît plus.
 */
export function EnrollmentScreen() {
    const enroll = useAuth((s) => s.enroll);
    const sync = useConfig((s) => s.syncFromServer);
    const [apiUrl, setApiUrl] = useState(DEFAULTS.apiUrl);
    const [name, setName] = useState('');
    const [secret, setSecret] = useState(DEFAULTS.enrollmentSecret);
    const [loading, setLoading] = useState(false);

    const submit = async () => {
        if (!apiUrl || !name || !secret) {
            Alert.alert('Champs requis', 'Renseignez l\'URL, le nom de l\'appareil et le secret.');
            return;
        }
        setLoading(true);
        try {
            await enroll(apiUrl.trim(), name.trim(), secret.trim());
            const ok = await sync();
            if (!ok) Alert.alert('Enrôlé', 'Appareil enrôlé, mais la config n\'a pas pu être téléchargée. Réessayez sur le wifi du resto.');
        } catch (e: any) {
            Alert.alert('Échec de l\'enrôlement', e?.response?.data?.message ?? e?.message ?? 'Erreur réseau.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Screen>
            <View style={styles.body}>
                <Text style={styles.title}>Configuration de l'appareil</Text>
                <Text style={styles.subtitle}>Enrôlement initial du terminal POS</Text>

                <Field label="URL du serveur" value={apiUrl} onChangeText={setApiUrl} placeholder="http://192.168.1.10:8000" autoCapitalize="none" keyboardType="url" />
                <Field label="Nom de l'appareil" value={name} onChangeText={setName} placeholder="Tablette Salle 1" />
                <Field label="Secret d'enrôlement" value={secret} onChangeText={setSecret} placeholder="secret" secureTextEntry />

                <Button label="Enrôler l'appareil" onPress={submit} loading={loading} style={{ marginTop: theme.spacing(4) }} />
            </View>
        </Screen>
    );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
    const { label, ...input } = props;
    return (
        <View style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <TextInput {...input} placeholderTextColor={theme.colors.textMuted} style={styles.input} />
        </View>
    );
}

const styles = StyleSheet.create({
    body: { flex: 1, justifyContent: 'center' },
    title: { color: theme.colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
    subtitle: { color: theme.colors.textMuted, fontSize: 15, marginTop: theme.spacing(1.5), marginBottom: theme.spacing(7) },
    field: { marginBottom: theme.spacing(4) },
    label: { color: theme.colors.textMuted, marginBottom: theme.spacing(2), fontSize: 13, fontWeight: '600' },
    input: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        color: theme.colors.text,
        paddingHorizontal: theme.spacing(4),
        height: 54,
        fontSize: 16,
    },
});
