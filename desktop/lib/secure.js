/**
 * Secrets de l'appareil (jeton Sanctum, URL du serveur) — équivalent bureau
 * d'`expo-secure-store`.
 *
 * Le chiffrement est confié à `safeStorage` d'Electron, adossé au système :
 * DPAPI sur Windows, Keychain sur macOS. Rien n'est écrit en clair.
 *
 * Repli documenté : si le système ne fournit pas de chiffrement (session Linux
 * sans trousseau, cas marginal ici), on refuse d'écrire en clair et on le fait
 * savoir plutôt que de donner une fausse impression de sécurité.
 */
const fs = require('node:fs');
const path = require('node:path');
const { safeStorage } = require('electron');

let file = null;
let cache = null;

function init(userDataPath) {
    file = path.join(userDataPath, 'secure.json');
    try {
        cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        cache = {};
    }
}

function persist() {
    fs.writeFileSync(file, JSON.stringify(cache), 'utf8');
}

function get(key) {
    const stored = cache[key];
    if (stored == null) return null;
    try {
        return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
        return null; // trousseau changé : le secret est illisible, on repart de zéro
    }
}

function set(key, value) {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Le chiffrement du système n'est pas disponible : secret non enregistré.");
    }
    cache[key] = safeStorage.encryptString(value).toString('base64');
    persist();
}

function remove(key) {
    delete cache[key];
    persist();
}

module.exports = { init, get, set, remove };
