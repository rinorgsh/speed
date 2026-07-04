import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Mises à jour OTA (EAS Update). Vérifie au retour au premier plan et applique
 * UNIQUEMENT à un moment sûr (canReloadNow) — jamais pendant une commande en
 * cours, pour ne pas perdre l'état local d'un serveur.
 *
 * EAS Update ne met à jour que le JS/assets : un changement de code natif exige
 * un nouveau build (le runtimeVersion garantit la compatibilité).
 */
export function useOTAUpdate(canReloadNow: () => boolean): void {
    useEffect(() => {
        if (__DEV__) return;

        const sub = AppState.addEventListener('change', async (state) => {
            if (state !== 'active') return;
            try {
                const update = await Updates.checkForUpdateAsync();
                if (!update.isAvailable) return;
                await Updates.fetchUpdateAsync(); // téléchargement silencieux
                if (canReloadNow()) {
                    await Updates.reloadAsync(); // appliqué seulement si c'est sûr
                }
                // Sinon : laissé pour le prochain lancement naturel de l'app.
            } catch {
                /* hors-ligne ou pas d'update : on ignore */
            }
        });

        return () => sub.remove();
    }, [canReloadNow]);
}
