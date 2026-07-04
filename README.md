# POS Horeca — Mobile (Phase 3)

App **React Native / Expo (SDK 56, TypeScript)** pour les serveurs : prise de
commande **offline-first** et impression **Epson ESC/POS** (TM-m30II) en LAN direct.

> Consomme l'API `/api/v1` du projet `pos-horeca` (Laravel). Le mobile ne touche
> jamais la base : tout passe par l'API, et la config est mise en cache local (SQLite).

## Stack

- Expo + TypeScript, **React Navigation** (stack)
- **Zustand** (état), **expo-sqlite** (cache offline + outbox), **expo-secure-store** (token appareil)
- **react-native-tcp-socket** (impression ESC/POS port 9100) — *module natif → nécessite un dev build*
- **bcryptjs** (vérification PIN hors-ligne), **axios**

## Important : dev build requis (pas Expo Go)

L'impression repose sur `react-native-tcp-socket`, un **module natif**. L'app ne
tourne donc **pas dans Expo Go** : il faut un **dev build** (EAS Build ou build local).

```bash
npm install

# Dev client (une fois) :
npx expo install expo-dev-client
npx expo run:android   # ou run:ios   (build natif local)
# ou via EAS :  eas build --profile development --platform android
```

Sans imprimante/dev build, le reste de l'app (navigation, cache, commandes) peut
être inspecté, mais les appels d'impression échoueront silencieusement (retry).

## Configuration

Au **premier lancement**, l'écran d'enrôlement demande :
- l'**URL du serveur** (l'IP de la machine Laravel sur le wifi du resto, ex. `http://192.168.1.10:8000`) ;
- un **nom d'appareil** ;
- le **secret d'enrôlement** (`DEFAULTS.enrollmentSecret`, doit correspondre à `DEVICE_ENROLLMENT_SECRET` du `.env` Laravel).

Les défauts dev sont dans `src/config.ts`. Le token et l'URL sont ensuite stockés
de façon sécurisée ; l'écran d'enrôlement ne réapparaît plus.

## Parcours

Enrôlement → **Unlock** → choix serveur → **PIN** (vérif hors-ligne) →
ouverture de caisse (admin) → **salles/tables** (état dérivé, reprise de table
partagée) → **POS** (catégories imbriquées → produits, modale d'options) →
**panier** (qté, options, note, void, envoi cuisine partiel + impression) →
**paiement** (cash/carte multiples, facture vs ticket) → impression client +
tiroir-caisse → libération de la table.

## Architecture (src/)

| Dossier | Rôle |
|---|---|
| `api/` | Client axios (enrôlement, bootstrap, verify-pin, sessions, sync/orders) |
| `db/` | Cache SQLite : schéma, import bootstrap, repository, outbox de commandes |
| `store/` | Zustand : `useAuth` (enrôlement/serveur/session), `useConfig` (cache+sync), `useCart` (commande active) |
| `printer/` | `escpos.ts` (encodeur ESC/POS + CP1252) et `printer.ts` (TCP 9100, file+retry, tickets cuisine/facture, kick tiroir) |
| `services/` | `printing.ts` (orchestration tickets) et `sync.ts` (flush outbox) |
| `screens/` | Les 10 écrans du parcours |
| `utils/` | UUID client, calcul prix/TVA, vérif PIN bcrypt hors-ligne |

## Offline-first & synchro

- La config (menu, salles, TVA, options, imprimantes) est mise en cache via `GET /bootstrap`.
- Les commandes/lignes utilisent des **UUID générés côté client** (pas de collision hors-ligne).
- Chaque mutation du panier est persistée en SQLite ; les commandes non synchronisées
  forment l'**outbox**, poussée vers `POST /sync/orders` (idempotent) après paiement
  ou au déverrouillage.

## Impression Epson (ESC/POS)

- Connexion TCP **port 9100** directe téléphone → imprimante (jamais via le serveur).
- Page de code **WPC1252** pour les accents FR (`ESC t 16`).
- Routage : lignes regroupées par imprimante via `categories.printer_id` ;
  un **ticket cuisine** par imprimante (gros texte, **sans prix**).
- **Facture/ticket client** sur l'imprimante `receipt` (prix + ventilation TVA) +
  **kick tiroir-caisse** si paiement cash.

## Temps réel (Phase 4)

`src/services/realtime.ts` connecte **laravel-echo + pusher-js** à **Reverb**
(canal public `pos`). Les events mettent à jour le cache local en direct :
- `ProductUpdated` / `ProductAvailabilityChanged` → prix, dispo (« 86 ») en direct ;
- `CategoryUpdated` → catégorie ;
- `TableStatusChanged` / `OrderUpdated` → rafraîchit la grille des tables (autre appareil).

La clé `REALTIME.key` (`src/config.ts`) doit correspondre à `REVERB_APP_KEY` du
`.env` Laravel ; le host est dérivé de l'URL serveur (port 8080). Côté serveur,
il faut **`php artisan reverb:start`** + **`php artisan queue:work`**.

## OTA — EAS Build / EAS Update (Phase 5)

- `app.json` : `runtimeVersion: { policy: "appVersion" }` + `updates` (remplacer
  `REPLACE_WITH_EAS_PROJECT_ID` par l'ID après `eas init`).
- `eas.json` : profils `development` / `staging` / `production` → channels.
- `src/hooks/useOTAUpdate.ts` : vérifie au retour au premier plan et **n'applique
  un reload que si aucune commande n'est en cours** (`canReloadNow`), pour ne jamais
  perdre l'état local d'un serveur.

> **EAS Update ne met à jour que le JS/assets.** Tout changement de code natif
> (lib d'impression, SDK, plugins) **exige un nouveau build** ; le `runtimeVersion`
> empêche un binaire de charger un JS incompatible.

## Test en local

Voir **`pos-horeca/TESTING_LOCAL.md`** : guide de bout en bout (4 process backend,
dev build mobile, enrôlement, scénario de test, imprimantes Epson).
