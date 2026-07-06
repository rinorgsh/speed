/**
 * Configuration de l'application mobile.
 *
 * L'URL du serveur et le secret d'enrôlement sont saisis au premier lancement
 * (écran d'enrôlement) puis stockés. Ces valeurs ne servent que de défauts dev.
 */
export const DEFAULTS = {
    // URL du serveur pré-remplie sur l'écran d'enrôlement.
    // ⚠️ Pour le build envoyé aux STORES : mettre ici l'URL d'un serveur de DÉMO
    // PUBLIC (accessible par le reviewer Apple/Google, pas une IP de LAN), avec des
    // données d'exemple -> le reviewer n'a qu'à appuyer sur « Enrôler ».
    apiUrl: 'https://pos-horeca.on-forge.com',
    enrollmentSecret: 'change-me-in-env',
    // Nom d'appareil pré-rempli (les vrais utilisateurs le remplacent).
    deviceName: 'Terminal démo',
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
