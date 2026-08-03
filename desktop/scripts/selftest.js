/**
 * Vérification automatique de la chaîne d'impression, SANS ouvrir de fenêtre.
 *
 * Enchaîne exactement ce que fait l'application :
 *   escpos.ts (code du mobile) → Buffer → socket TCP 9100
 *
 * Ce que ce test prouve : le code d'impression de l'app mobile s'exécute tel
 * quel côté bureau, et les octets partent bien sur une socket TCP brute — le
 * point qu'aucun navigateur ne peut atteindre, et la raison d'être de cette
 * application de bureau.
 *
 * Usage : node scripts/selftest.js [host] [port]
 * Sans imprimante réelle, lancer d'abord `npm run mock-printer`.
 */
const path = require('node:path');
const esbuild = require('esbuild');
const { sendRaw } = require('../lib/tcp');

const host = process.argv[2] || '127.0.0.1';
const port = Number(process.argv[3]) || 9100;

async function main() {
    // On compile le ticket pour Node : c'est le MÊME fichier TypeScript que
    // celui utilisé par l'interface, qui importe lui-même src/printer/escpos.ts.
    const built = await esbuild.build({
        entryPoints: [path.join(__dirname, '../renderer/ticket.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
        logLevel: 'silent',
    });

    const module = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, require);

    const data = module.exports.buildDemoTicket(new Date('2026-08-03T12:30:00'));

    console.log(`escpos.ts a produit ${data.length} octets.`);
    console.log(`Envoi vers ${host}:${port} en TCP brut…`);

    try {
        await sendRaw(host, port, data);
        console.log('✓ Flux envoyé sur la socket.');
    } catch (e) {
        console.error(`✗ Échec : ${e.message}`);
        process.exitCode = 1;
    }
}

main();
