/**
 * Base SQLite du bureau — équivalent d'`expo-sqlite` côté mobile.
 *
 * better-sqlite3 est SYNCHRONE, ce qui simplifie tout : pas de file d'attente à
 * gérer, chaque requête est terminée quand elle rend la main. Le fichier vit
 * dans le dossier de données de l'application, comme sur mobile.
 *
 * Un point mérite attention : `withExclusiveTransactionAsync`. Côté mobile, il
 * garantit qu'aucune requête émise ailleurs ne vient s'intercaler pendant une
 * synchronisation (le commentaire de src/db/database.ts le rappelle : deux
 * synchros entremêlées laissaient le cache vide). L'interface étant à distance,
 * on reproduit cette garantie ici avec un verrou : tant qu'une transaction est
 * ouverte, les requêtes venues d'ailleurs attendent.
 */
const path = require('node:path');
const fs = require('node:fs');

let db = null;

/**
 * Transaction en cours : jeton + file d'attente des requêtes hors transaction.
 * Le jeton est un simple entier — il traverse le pont IPC, ce qu'un Symbol ne
 * saurait pas faire.
 */
let currentTx = null;
let txCounter = 0;
const waiting = [];

function open(userDataPath, name) {
    if (db) return;
    const Database = require('better-sqlite3');
    const dir = path.join(userDataPath, 'db');
    fs.mkdirSync(dir, { recursive: true });
    db = new Database(path.join(dir, name));
    // WAL : lectures et écritures ne se bloquent pas mutuellement.
    db.pragma('journal_mode = WAL');
}

/** Normalise les paramètres : l'API mobile accepte le variadique ET un tableau. */
function normalize(params) {
    if (!params || params.length === 0) return [];
    if (params.length === 1 && Array.isArray(params[0])) return params[0];
    return params;
}

/**
 * Requêtes hors transaction : mises en attente tant qu'une transaction est
 * ouverte, exactement comme le fait `withExclusiveTransactionAsync` sur mobile.
 */
function guard(txId, run) {
    if (currentTx && currentTx !== txId) {
        return new Promise((resolve, reject) => {
            waiting.push(() => { try { resolve(run()); } catch (e) { reject(e); } });
        });
    }
    return Promise.resolve(run());
}

function drain() {
    while (waiting.length) waiting.shift()();
}

const api = {
    open,

    exec: (txId, sql) => guard(txId, () => { db.exec(sql); }),

    run: (txId, sql, params) => guard(txId, () => {
        const info = db.prepare(sql).run(...normalize(params));
        return { changes: info.changes, lastInsertRowId: Number(info.lastInsertRowid) };
    }),

    all: (txId, sql, params) => guard(txId, () => db.prepare(sql).all(...normalize(params))),

    first: (txId, sql, params) => guard(txId, () => db.prepare(sql).get(...normalize(params)) ?? null),

    /** Ouvre une transaction exclusive et renvoie son jeton. */
    begin: async () => {
        // Une transaction attend la précédente : jamais d'imbrication.
        while (currentTx) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => { waiting.push(resolve); });
        }
        currentTx = ++txCounter;
        db.exec('BEGIN EXCLUSIVE');
        return currentTx;
    },

    end: async (txId, commit) => {
        if (currentTx !== txId) return;
        try {
            db.exec(commit ? 'COMMIT' : 'ROLLBACK');
        } finally {
            currentTx = null;
            drain();
        }
    },
};

module.exports = api;
