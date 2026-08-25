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
            infoPlist: {
                ...config.ios.infoPlist,
                /*
                 * Le bac à sable tourne en http:// sur une adresse IP du réseau
                 * local. iOS refuse le trafic en clair par défaut, et ses
                 * exceptions par domaine ne fonctionnent pas sur une IP nue :
                 * il n'y a pas de réglage plus fin ici.
                 *
                 * Ce bloc n'existe QUE dans la variante de test. La production
                 * parle en https à on-forge.com et n'est pas concernée — elle
                 * ne doit jamais recevoir cette permission.
                 */
                NSAppTransportSecurity: {
                    NSAllowsArbitraryLoads: true,
                    NSAllowsLocalNetworking: true,
                },
            },
        },
        android: {
            ...config.android,
            package: `${config.android.package}.dev`,
        },
    };
};
