/**
 * Transport ESC/POS pour le bureau — l'équivalent exact de `sendRaw` du mobile
 * (src/printer/printer.ts), avec `node:net` à la place de react-native-tcp-socket.
 *
 * Volontairement isolé d'Electron : ce fichier ne dépend que de Node, il peut
 * donc être exécuté et vérifié sans ouvrir de fenêtre (cf. scripts/selftest.js).
 * C'est aussi ce qui garantit qu'il reste la SEULE pièce spécifique au bureau.
 */
const net = require('node:net');

/** Aligné sur PRINTING.connectTimeout du mobile. */
const CONNECT_TIMEOUT = 4000;

/**
 * @param {string} host
 * @param {number} port
 * @param {Buffer} data
 * @returns {Promise<void>}
 */
function sendRaw(host, port, data) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (err) => {
            if (settled) return;
            settled = true;
            try {
                client.destroy();
            } catch {
                /* noop */
            }
            err ? reject(err) : resolve();
        };

        const client = net.createConnection({ host, port }, () => {
            client.write(data, () => {
                // Laisse le tampon partir avant de fermer, comme sur mobile.
                setTimeout(() => done(), 250);
            });
        });

        client.setTimeout(CONNECT_TIMEOUT, () => done(new Error('Timeout imprimante')));
        client.on('error', (e) => done(e));
    });
}

module.exports = { sendRaw, CONNECT_TIMEOUT };
