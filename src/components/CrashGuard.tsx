import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { theme } from '../theme';
export { guard } from '../utils/guard';

/**
 * Filet de sécurité contre une erreur d'affichage.
 *
 * Une caisse ne doit jamais se fermer d'elle-même. Sans ce garde-fou, la moindre
 * erreur JavaScript dans un écran fait tomber toute l'application : le serveur
 * se retrouve devant un téléphone qui se ferme en boucle, sans aucune
 * indication, au milieu d'un service.
 *
 * On affiche donc l'erreur — c'est elle qu'on demandera au support — et deux
 * issues : réessayer sans redémarrer, ou revenir à la version installée si une
 * mise à jour à distance est en cause.
 *
 * Attention à ce que cela NE couvre PAS : une erreur survenue hors du rendu,
 * dans un rappel natif ou une promesse non rattrapée, échappe à ce mécanisme.
 * C'est le rôle de `guard()` ci-dessous.
 */
interface Props {
    children: React.ReactNode;
}

interface State {
    error: Error | null;
}

export class CrashGuard extends React.Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        // Trace complète dans la console : c'est ce qu'on relit après coup.
        console.log('[crash] écran en erreur', error?.message, info?.componentStack);
    }

    private reessayer = () => this.setState({ error: null });

    private revenirVersionInstallee = async () => {
        try {
            await Updates.reloadAsync();
        } catch {
            this.reessayer();
        }
    };

    render() {
        const { error } = this.state;
        if (!error) {
            return this.props.children;
        }

        return (
            <View style={styles.page}>
                <Text style={styles.titre}>L'application a rencontré une erreur</Text>
                <Text style={styles.sous}>
                    Rien n'est perdu : les commandes en cours sont enregistrées sur l'appareil et
                    remonteront au serveur.
                </Text>

                <ScrollView style={styles.boite}>
                    <Text style={styles.detail}>{error?.message ?? String(error)}</Text>
                </ScrollView>

                <Pressable style={styles.principal} onPress={this.reessayer}>
                    <Text style={styles.principalTexte}>Réessayer</Text>
                </Pressable>
                <Pressable style={styles.secondaire} onPress={() => void this.revenirVersionInstallee()}>
                    <Text style={styles.secondaireTexte}>Redémarrer l'application</Text>
                </Pressable>
            </View>
        );
    }
}

const styles = StyleSheet.create({
    page: {
        flex: 1,
        backgroundColor: theme.colors.bg,
        padding: theme.spacing(5),
        justifyContent: 'center',
    },
    titre: { color: theme.colors.text, fontSize: 22, fontWeight: '800', marginBottom: theme.spacing(2) },
    sous: { color: theme.colors.textMuted, fontSize: 14, marginBottom: theme.spacing(4) },
    boite: {
        maxHeight: 180,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.spacing(3),
        marginBottom: theme.spacing(4),
    },
    detail: { color: theme.colors.textMuted, fontSize: 12 },
    principal: {
        backgroundColor: theme.colors.primary,
        borderRadius: theme.radius.md,
        paddingVertical: theme.spacing(4),
        alignItems: 'center',
        marginBottom: theme.spacing(3),
    },
    principalTexte: { color: theme.colors.onPrimary, fontWeight: '800', fontSize: 16 },
    secondaire: { paddingVertical: theme.spacing(3), alignItems: 'center' },
    secondaireTexte: { color: theme.colors.textMuted, fontWeight: '700' },
});
