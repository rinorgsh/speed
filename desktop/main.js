/**
 * Processus principal Electron — la moitié « Node » de Speed.
 *
 * C'est ici que se règle le problème qui a motivé l'application mobile : une
 * page web servie en HTTPS ne peut pas ouvrir de connexion vers une imprimante
 * du réseau local (contenu mixte, certificat absent). Un processus Electron est
 * un programme Windows/macOS ordinaire : il ouvre une socket TCP vers le port
 * 9100 sans rien demander à personne.
 *
 * Ce fichier ne contient AUCUNE logique métier. Il expose quatre services à
 * l'interface — imprimer, base locale, secrets, mises à jour — qui remplacent
 * les quatre modules natifs du mobile. Tout le reste vient de `src/`, partagé.
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { sendRaw } = require('./lib/tcp');
const db = require('./lib/db');
const secure = require('./lib/secure');

/**
 * Enregistre un service pour l'interface. L'échec est renvoyé comme VALEUR :
 * une exception qui traverse le pont serait journalisée par Electron comme une
 * erreur non gérée, alors que le code partagé la rattrape très bien lui-même
 * (les migrations `ALTER TABLE` échouent normalement à chaque démarrage).
 * Le pont la retransforme en exception côté interface — cf. preload.js.
 */
function service(channel, run) {
    ipcMain.handle(channel, async (_event, payload) => {
        try {
            return await run(payload);
        } catch (e) {
            return { __error: e?.message ?? String(e) };
        }
    });
}

// --- Impression ---------------------------------------------------------

// L'interface transmet les octets en base64 : le pont ne sait passer que des
// données simples, un Buffer ne traverse pas tel quel.
service('printer:send', async ({ host, port, base64 }) => {
    try {
        await sendRaw(host, port, Buffer.from(base64, 'base64'));
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e?.message ?? String(e) };
    }
});

// --- Base locale --------------------------------------------------------

service('db:open', (name) => db.open(app.getPath('userData'), name));
service('db:exec', ({ txId, sql }) => db.exec(txId, sql));
service('db:run', ({ txId, sql, params }) => db.run(txId, sql, params));
service('db:all', ({ txId, sql, params }) => db.all(txId, sql, params));
service('db:first', ({ txId, sql, params }) => db.first(txId, sql, params));
service('db:begin', () => db.begin());
service('db:end', ({ txId, commit }) => db.end(txId, commit));

// --- Secrets ------------------------------------------------------------

service('secure:get', (key) => secure.get(key));
service('secure:set', ({ key, value }) => secure.set(key, value));
service('secure:remove', (key) => secure.remove(key));

// --- Mises à jour -------------------------------------------------------

/**
 * electron-updater est chargé À LA DEMANDE : en développement il n'y a pas de
 * fichier de version à interroger, et son import échouerait bruyamment pour
 * rien.
 */
let updater = null;
function getUpdater() {
    if (updater) return updater;
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false; // le téléchargement est décidé par l'app
    autoUpdater.autoInstallOnAppQuit = true;
    updater = autoUpdater;
    return updater;
}

service('updates:check', async () => {
    if (!app.isPackaged) return false; // rien à vérifier en développement
    const result = await getUpdater().checkForUpdates();
    return !!result?.updateInfo && result.updateInfo.version !== app.getVersion();
});

service('updates:download', async () => {
    if (!app.isPackaged) return false;
    await getUpdater().downloadUpdate();
    return true;
});

service('updates:install', () => {
    if (!app.isPackaged) return;
    // `quitAndInstall` redémarre l'application. L'appelant (useOTAUpdate) ne
    // l'invoque QUE si aucune commande n'est en cours.
    getUpdater().quitAndInstall();
});

// --- Fenêtre ------------------------------------------------------------

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#0d0d0f',
        // La caisse tourne en plein écran sur une tablette ; sur un poste de
        // bureau, une fenêtre ordinaire reste plus pratique pour travailler.
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    win.once('ready-to-show', () => win.show());
    win.loadFile(path.join(__dirname, 'renderer/index.html'));

    // En développement, les messages de l'interface remontent dans le terminal :
    // sans ça, une erreur de rendu resterait invisible dans la console de la
    // fenêtre, que personne n'ouvre.
    if (!app.isPackaged) {
        const levels = ['debug', 'info', 'warn', 'error'];
        win.webContents.on('console-message', (_e, level, message, line, source) => {
            const where = source ? ` (${path.basename(source)}:${line})` : '';
            console.log(`[interface:${levels[level] ?? level}] ${message}${where}`);
        });
    }

    // Un lien externe s'ouvre dans le navigateur du système, jamais dans la
    // fenêtre de la caisse (dont on ne pourrait plus sortir).
    win.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: 'deny' };
    });

    // `--probe "<expression>"` : évalue une expression dans la page et
    // l'affiche. Sert à mesurer une mise en page plutôt qu'à la deviner.
    const probeIndex = process.argv.indexOf('--probe');
    if (probeIndex !== -1) {
        const expression = process.argv[probeIndex + 1];
        setTimeout(async () => {
            try {
                const value = await win.webContents.executeJavaScript(expression);
                console.log(JSON.stringify(value, null, 2));
            } catch (e) {
                console.log('probe error: ' + e.message);
            }
            app.quit();
        }, 5000);
    }

    // `--screenshot <fichier>` : capture la fenêtre puis quitte. Permet de
    // vérifier le rendu réel sans intervention, à chaque modification.
    const shotIndex = process.argv.indexOf('--screenshot');
    if (shotIndex !== -1) {
        const target = process.argv[shotIndex + 1];
        setTimeout(async () => {
            const image = await win.webContents.capturePage();
            require('node:fs').writeFileSync(target, image.toPNG());
            app.quit();
        }, 6000);
    }
}

app.whenReady().then(() => {
    secure.init(app.getPath('userData'));
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
