/**
 * Variantes de l'application.
 *
 * Expo lit d'abord `app.json`, puis passe le résultat ici : sans variable
 * d'environnement, la configuration de PRODUCTION ressort inchangée. Rien ne
 * bouge donc pour les builds existants.
 *
 * Avec APP_VARIANT=dev, on change l'identifiant de l'application (et lui seul,
 * ou presque). C'est ce qui permet d'installer la version de test À CÔTÉ de la
 * production sur le même téléphone, au lieu de l'écraser — indispensable quand
 * l'appareil sert aussi en salle.
 *
 * Le canal de mise à jour, lui, est fixé par le profil de build dans `eas.json`
 * (`staging`), pas ici : une build de test ne reçoit donc jamais une OTA
 * destinée à la production, et inversement.
 */
module.exports = ({ config }) => {
    if (process.env.APP_VARIANT !== 'dev') {
        return config;
    }

    return {
        ...config,
        name: 'Speed dev',
        ios: {
            ...config.ios,
            bundleIdentifier: `${config.ios.bundleIdentifier}.dev`,
        },
        android: {
            ...config.android,
            package: `${config.android.package}.dev`,
        },
    };
};
