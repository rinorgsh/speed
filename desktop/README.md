# Speed — application de bureau (Windows / macOS)

L'application de caisse, en programme installable, pour les tablettes Windows.

Elle résout le problème qui a motivé l'application mobile : une page web servie
en HTTPS ne peut pas ouvrir de connexion vers une imprimante du réseau local
(contenu mixte, certificat absent). Un programme de bureau, si — la socket TCP
part vers le port 9100 exactement comme depuis l'iPad.

## Le principe : un seul code

`src/` **n'est pas modifié et n'est pas copié**. Le bundle du bureau charge les
mêmes fichiers que le mobile ; seuls les quatre modules natifs sont remplacés,
au moment du bundle (voir `build.mjs`) :

| Module mobile | Remplacé par | Où |
|---|---|---|
| `react-native-tcp-socket` | `node:net` | `shims/tcp-socket.ts` + `lib/tcp.js` |
| `expo-sqlite` | better-sqlite3 | `shims/sqlite.ts` + `lib/db.js` |
| `expo-secure-store` | `safeStorage` (DPAPI / Keychain) | `shims/secure-store.ts` + `lib/secure.js` |
| `expo-updates` | electron-updater | `shims/updates.ts` |
| `lucide-react-native` | `lucide-react` | `shims/icons.ts` |
| `react-native` | `react-native-web` | alias dans `build.mjs` |

Conséquence : une correction dans `src/` profite aux deux plateformes. Il reste
deux publications, mais un seul développement.

## Développer

```bash
npm install          # recompile aussi better-sqlite3 pour Electron
npm start            # construit le bundle et ouvre la fenêtre
npm run watch        # reconstruction continue (dans un autre terminal)
```

Outils de vérification, utilisables sans intervention :

```bash
npm run mock-printer                 # fausse imprimante ESC/POS sur le port 9100
npm run selftest                     # escpos.ts -> socket, sans fenêtre
npm run screenshot                   # capture le rendu dans capture.png
electron . --probe '<expression JS>' # mesure la page (mise en page, état…)
```

## Fabriquer les installateurs

```bash
npm run dist:mac     # dist/Speed-1.0.0.dmg
npm run dist:win     # dist/Speed Setup 1.0.0.exe
```

`dist:win` doit tourner **sur Windows** (produire un `.exe` depuis macOS exige
Wine). Le dépôt contient une CI prête à l'emploi :
`.github/workflows/desktop-windows.yml`, à lancer depuis l'onglet Actions ou en
poussant une étiquette `desktop-v1.0.0`.

## Mises à jour automatiques

Réglées sur un hébergement statique (`publish` dans `package.json`) :

```
https://pos-horeca.on-forge.com/desktop
```

Pour publier une version : incrémenter `version` dans ce `package.json`,
fabriquer l'installateur, puis déposer **le `.exe`, son `.blockmap` et
`latest.yml`** dans ce dossier sur le serveur. Les postes installés récupèrent
la mise à jour au démarrage suivant.

La règle du mobile est conservée telle quelle par `src/hooks/useOTAUpdate.ts` :
l'application ne redémarre **jamais** pendant une commande en cours.

Différence à connaître : sur mobile, EAS ne remplace que le JavaScript ; ici
c'est l'application entière, et le redémarrage est réel.

## Points à connaître

- **Poids** : ~240 Mo installée, ~100 Mo d'installateur. Le moteur d'affichage
  est embarqué. Sans importance sur une tablette de caisse.
- **SmartScreen** : non signée, Windows avertit à la première installation.
  Un certificat de signature de code (~200-400 €/an) le supprime.
- **Architecture** : l'installateur est construit pour **x64**. Une tablette ARM
  demanderait une cible supplémentaire.
- **Imprimantes** : le transport est TCP/IP (port 9100). Une imprimante branchée
  en USB demanderait un transport supplémentaire.

## Ce qui a été vérifié

- L'application entière compile et s'exécute sous react-native-web.
- L'écran d'enrôlement s'affiche à l'identique du mobile (capture d'écran).
- L'impression fonctionne depuis l'application **packagée** : `escpos.ts` →
  pont → socket TCP 9100, accents CP1252 compris.
- better-sqlite3 est recompilé pour Electron et la base s'ouvre.

Restent à valider sur le terrain : les autres écrans en usage réel, une
impression sur une vraie Epson, et un cycle complet de mise à jour.
