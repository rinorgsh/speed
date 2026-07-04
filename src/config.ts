/**
 * Configuration de l'application mobile.
 *
 * L'URL du serveur et le secret d'enrôlement sont saisis au premier lancement
 * (écran d'enrôlement) puis stockés. Ces valeurs ne servent que de défauts dev.
 */
export const DEFAULTS = {
    // IP de la machine qui héberge l'API Laravel sur le wifi du resto (à adapter).
    apiUrl: 'http://192.168.1.10:8000',
    enrollmentSecret: 'dev-secret-pos-2026',
};

// La config temps réel (Reverb : key/host/port/scheme) est désormais fournie
// par le serveur via /bootstrap — le mobile s'adapte automatiquement local/prod.

// Délais réseau (ms).
export const NETWORK = {
    timeout: 8000,
};

// Impression.
export const PRINTING = {
    port: 9100,
    connectTimeout: 4000,
    maxRetries: 3,
};
