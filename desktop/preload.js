/**
 * Pont entre l'interface et le processus Node.
 *
 * L'interface n'a AUCUN accès direct à Node : elle ne voit que les quelques
 * fonctions exposées ici. C'est exactement la surface dont dispose l'app mobile
 * — imprimer, lire/écrire sa base, garder un secret, se mettre à jour — et rien
 * de plus.
 */
const { contextBridge, ipcRenderer } = require('electron');

/**
 * Appel du processus Node.
 *
 * L'échec revient sous forme de valeur, pas d'exception traversant le pont :
 * `src/db/database.ts` s'appuie sur des `ALTER TABLE` qui échouent normalement
 * quand la colonne existe déjà, et Electron journaliserait chacun d'eux comme
 * une erreur non gérée. On rétablit ici l'exception côté interface, là où le
 * `.catch()` du code partagé l'attend.
 */
async function invoke(channel, payload) {
    const result = await ipcRenderer.invoke(channel, payload);
    if (result && typeof result === 'object' && result.__error) throw new Error(result.__error);
    return result;
}

contextBridge.exposeInMainWorld('speedDesktop', {
    /** Impression ESC/POS : octets déjà construits par escpos.ts. */
    printerSend: (host, port, base64) => invoke('printer:send', { host, port, base64 }),

    /** Base locale (remplace expo-sqlite). */
    db: {
        open: (name) => invoke('db:open', name),
        exec: (txId, sql) => invoke('db:exec', { txId, sql }),
        run: (txId, sql, params) => invoke('db:run', { txId, sql, params }),
        all: (txId, sql, params) => invoke('db:all', { txId, sql, params }),
        first: (txId, sql, params) => invoke('db:first', { txId, sql, params }),
        begin: () => invoke('db:begin'),
        end: (txId, commit) => invoke('db:end', { txId, commit }),
    },

    /** Secrets de l'appareil (remplace expo-secure-store). */
    secure: {
        get: (key) => invoke('secure:get', key),
        set: (key, value) => invoke('secure:set', { key, value }),
        remove: (key) => invoke('secure:remove', key),
    },

    /** Mises à jour de l'application (remplace expo-updates). */
    updates: {
        check: () => invoke('updates:check'),
        download: () => invoke('updates:download'),
        install: () => invoke('updates:install'),
    },
});
