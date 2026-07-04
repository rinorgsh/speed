import * as SecureStore from 'expo-secure-store';

/**
 * Stockage sécurisé des secrets de l'appareil : token Sanctum et URL du serveur.
 * (Le token identifie l'appareil ; il ne doit pas traîner en clair.)
 */
const KEYS = {
    token: 'pos_device_token',
    apiUrl: 'pos_api_url',
    deviceName: 'pos_device_name',
    profileId: 'pos_profile_id',
    profileName: 'pos_profile_name',
};

/** Profil choisi (persisté pour survivre au redémarrage). */
export async function saveProfile(id: number, name: string): Promise<void> {
    await SecureStore.setItemAsync(KEYS.profileId, String(id));
    await SecureStore.setItemAsync(KEYS.profileName, name);
}

export async function loadProfile(): Promise<{ id: number; name: string } | null> {
    const id = await SecureStore.getItemAsync(KEYS.profileId);
    const name = await SecureStore.getItemAsync(KEYS.profileName);
    if (!id) return null;
    return { id: Number(id), name: name ?? '' };
}

export async function clearProfile(): Promise<void> {
    await SecureStore.deleteItemAsync(KEYS.profileId);
    await SecureStore.deleteItemAsync(KEYS.profileName);
}

export async function saveCredentials(token: string, apiUrl: string, deviceName: string): Promise<void> {
    await SecureStore.setItemAsync(KEYS.token, token);
    await SecureStore.setItemAsync(KEYS.apiUrl, apiUrl);
    await SecureStore.setItemAsync(KEYS.deviceName, deviceName);
}

export async function loadCredentials(): Promise<{ token: string; apiUrl: string; deviceName: string } | null> {
    const token = await SecureStore.getItemAsync(KEYS.token);
    const apiUrl = await SecureStore.getItemAsync(KEYS.apiUrl);
    const deviceName = (await SecureStore.getItemAsync(KEYS.deviceName)) ?? '';

    if (!token || !apiUrl) {
        return null;
    }

    return { token, apiUrl, deviceName };
}

export async function clearCredentials(): Promise<void> {
    await SecureStore.deleteItemAsync(KEYS.token);
    await SecureStore.deleteItemAsync(KEYS.apiUrl);
    await SecureStore.deleteItemAsync(KEYS.deviceName);
    await clearProfile();
}
