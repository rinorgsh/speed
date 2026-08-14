import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useAuth } from './src/store/useAuth';
import { useConfig } from './src/store/useConfig';
import { connectRealtime, disconnectRealtime, realtimeState } from './src/services/realtime';
import { startSyncLoop, stopSyncLoop } from './src/services/sync';
import { onFailedPrintsChange, resumePendingPrints } from './src/printer/printer';
import { CrashGuard } from './src/components/CrashGuard';
import { guard } from './src/utils/guard';
import { applyOrientationPolicy } from './src/services/orientation';
import { useRealtime } from './src/store/useRealtime';
import { useOTAUpdate } from './src/hooks/useOTAUpdate';
import { useCart } from './src/store/useCart';
import { useLocale } from './src/i18n';
import { theme } from './src/theme';

export default function App() {
    const init = useAuth((s) => s.init);
    const initialized = useAuth((s) => s.initialized);
    const enrolled = useAuth((s) => s.enrolled);
    const apiUrl = useAuth((s) => s.apiUrl);
    const profileId = useAuth((s) => s.profileId);
    const loadFromCache = useConfig((s) => s.loadFromCache);
    const realtimeConfig = useConfig((s) => s.realtimeConfig);
    const [, setBootError] = useState<string | null>(null);

    // OTA : applique une mise à jour seulement si aucune commande n'est en cours.
    useOTAUpdate(() => useCart.getState().order === null);

    useEffect(() => {
        (async () => {
            try {
                await init();
                // Langue choisie sur CET appareil (prime sur celle de l'établissement).
                await useLocale.getState().load();
            } catch (e: any) {
                setBootError(e?.message ?? 'Erreur de démarrage');
            }
        })();
    }, [init]);

    // Orientation : téléphone verrouillé en portrait, tablette libre. Appliqué
    // une seule fois, avant même l'enrôlement — l'écran de saisie de l'URL doit
    // déjà se présenter correctement.
    useEffect(() => {
        guard('orientation', applyOrientationPolicy);
    }, []);

    // Charge la config en cache une fois l'appareil enrôlé.
    useEffect(() => {
        if (enrolled) guard('cache', loadFromCache);
    }, [enrolled, loadFromCache]);

    /*
     * Impressions : on reprend les travaux laissés en plan par un arrêt brutal,
     * et on tient à jour le compteur de tickets en échec affiché sur la pastille.
     * Un ticket non sorti est un plat qui ne sera pas préparé : il ne doit ni
     * disparaître au redémarrage, ni rester invisible.
     */
    useEffect(() => {
        if (!enrolled) return;
        const off = onFailedPrintsChange((n) => useRealtime.getState().setFailedPrints(n));
        guard('impressions en attente', resumePendingPrints);
        return off;
    }, [enrolled]);

    // Temps réel (Reverb) : canal scopé sur le profil actif (s'adapte local/prod).
    useEffect(() => {
        if (enrolled && apiUrl && realtimeConfig && profileId) {
            connectRealtime(realtimeConfig, apiUrl, profileId);
            return () => disconnectRealtime();
        }
    }, [enrolled, apiUrl, realtimeConfig, profileId]);

    // Boucle de synchro fiable (retry outbox + heartbeat) : garantit que toute action
    // remonte au serveur et que tous les appareils convergent (filet de sécurité).
    useEffect(() => {
        if (enrolled && profileId) {
            startSyncLoop();
            return () => stopSyncLoop();
        }
    }, [enrolled, profileId]);

    /*
     * Retour au premier plan : on remet TOUT en marche, sans condition.
     *
     * Le système suspend le fil JavaScript en arrière-plan. Au réveil, ni le
     * `setInterval` de la boucle de synchro ni la socket temps réel ne sont
     * garantis vivants — et rien ne les ressuscitait : la boucle n'était
     * relancée qu'au montage du composant, donc au démarrage de l'application.
     * D'où l'incident constaté en service : plus rien ne remontait ni ne
     * descendait, et seul un redémarrage complet réparait.
     *
     * `startSyncLoop` commence par arrêter la boucle existante : l'appeler à
     * chaque réveil est sans risque et ne peut pas en faire tourner deux.
     */
    useEffect(() => {
        if (!enrolled) return;
        const sub = AppState.addEventListener('change', (state) => {
            if (state !== 'active') return;

            if (profileId) startSyncLoop();
            guard('synchro au réveil', () => useConfig.getState().syncFromServer());

            // On interroge la socket elle-même, pas notre drapeau : c'est lui
            // qui pouvait mentir et bloquer toute reconnexion.
            if (realtimeState() !== 'connected' && apiUrl && realtimeConfig && profileId) {
                console.log('[realtime] réveil : socket', realtimeState(), '-> reconnexion');
                connectRealtime(realtimeConfig, apiUrl, profileId);
            }
        });
        return () => sub.remove();
    }, [enrolled, apiUrl, realtimeConfig, profileId]);

    if (!initialized) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.bg, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={theme.colors.primary} size="large" />
            </View>
        );
    }

    const navTheme = {
        ...DarkTheme,
        colors: {
            ...DarkTheme.colors,
            background: theme.colors.bg,
            card: theme.colors.surface,
            text: theme.colors.text,
            primary: theme.colors.primary,
        },
    };

    return (
        <SafeAreaProvider>
            <StatusBar style="light" />
            <CrashGuard>
                <NavigationContainer theme={navTheme}>
                    <RootNavigator />
                </NavigationContainer>
            </CrashGuard>
        </SafeAreaProvider>
    );
}
