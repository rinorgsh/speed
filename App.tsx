import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useAuth } from './src/store/useAuth';
import { useConfig } from './src/store/useConfig';
import { useRealtime } from './src/store/useRealtime';
import { connectRealtime, disconnectRealtime } from './src/services/realtime';
import { startSyncLoop, stopSyncLoop } from './src/services/sync';
import { useOTAUpdate } from './src/hooks/useOTAUpdate';
import { useCart } from './src/store/useCart';
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
            } catch (e: any) {
                setBootError(e?.message ?? 'Erreur de démarrage');
            }
        })();
    }, [init]);

    // Charge la config en cache une fois l'appareil enrôlé.
    useEffect(() => {
        if (enrolled) void loadFromCache();
    }, [enrolled, loadFromCache]);

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

    // Retour au premier plan : on resynchronise TOUJOURS la config (filet de
    // sécurité absolu contre tout décalage) et on relance le temps réel s'il a
    // été coupé en arrière-plan. Garantit qu'on n'est jamais en retard.
    useEffect(() => {
        if (!enrolled) return;
        const sub = AppState.addEventListener('change', (state) => {
            if (state !== 'active') return;
            void useConfig.getState().syncFromServer();
            if (!useRealtime.getState().connected && apiUrl && realtimeConfig && profileId) {
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
            <NavigationContainer theme={navTheme}>
                <RootNavigator />
            </NavigationContainer>
        </SafeAreaProvider>
    );
}
