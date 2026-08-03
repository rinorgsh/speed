/**
 * Substitut d'`expo-updates` pour le bureau.
 *
 * Même contrat que sur mobile — vérifier, télécharger, appliquer — mais servi
 * par electron-updater. La règle importante est conservée telle quelle par
 * `src/hooks/useOTAUpdate.ts` : on ne redémarre JAMAIS pendant une commande en
 * cours, sinon un serveur perdrait sa saisie.
 *
 * Différence à connaître : sur mobile, EAS ne remplace que le JavaScript. Ici
 * c'est l'application entière qui est remplacée, et le redémarrage est réel.
 */
const bridge = () => (window as any).speedDesktop.updates;

export async function checkForUpdateAsync(): Promise<{ isAvailable: boolean }> {
    try {
        return { isAvailable: await bridge().check() };
    } catch {
        return { isAvailable: false };
    }
}

export async function fetchUpdateAsync(): Promise<{ isNew: boolean }> {
    return { isNew: await bridge().download() };
}

export async function reloadAsync(): Promise<void> {
    await bridge().install();
}
