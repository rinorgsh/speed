/**
 * Substitut d'`expo-secure-store` pour le bureau.
 *
 * Même surface que celle utilisée par `src/store/secure.ts` (get/set/delete).
 * Le chiffrement est délégué à `safeStorage` d'Electron, adossé au trousseau du
 * système : DPAPI sur Windows, Keychain sur macOS. Le jeton de l'appareil n'est
 * donc jamais écrit en clair sur le disque, comme sur mobile.
 */
const bridge = () => (window as any).speedDesktop.secure;

export function getItemAsync(key: string): Promise<string | null> {
    return bridge().get(key);
}

export function setItemAsync(key: string, value: string): Promise<void> {
    return bridge().set(key, value);
}

export function deleteItemAsync(key: string): Promise<void> {
    return bridge().remove(key);
}
