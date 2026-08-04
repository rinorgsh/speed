/**
 * Aperçu d'un ticket de caisse SANS imprimante ni appareil.
 *
 * Construit un vrai ticket avec le code de l'application (buildReceipt) et
 * l'envoie à la fausse imprimante, qui le décode et l'affiche. Indispensable
 * pour juger une mise en page au caractère près — un ticket se règle en
 * colonnes, pas à l'estime.
 *
 * Usage :
 *   npm run mock-printer                              (terminal 1)
 *   node scripts/preview-receipt.mjs [fr|nl|en] [caisse|cuisine]
 */
import esbuild from 'esbuild';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// scripts/ -> desktop/ -> racine du projet mobile.
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shim = (f) => path.join(APP, 'desktop/shims', f);
const require_ = createRequire(import.meta.url);

const built = await esbuild.build({
    stdin: {
        contents: `
            export { buildReceipt, buildKitchenTicket } from '${APP}/src/printer/printer';
            export { useLocale } from '${APP}/src/i18n';
        `,
        resolveDir: APP,
        loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
    define: { __DEV__: 'false', 'process.env.NODE_ENV': '"production"' },
    alias: {
        'react-native': 'react-native-web',
        'react-native-tcp-socket': shim('tcp-socket.ts'),
        'expo-sqlite': shim('sqlite.ts'),
        'expo-secure-store': shim('secure-store.ts'),
        'expo-updates': shim('updates.ts'),
    },
});

const mod = { exports: {} };
new Function('module', 'exports', 'require', built.outputFiles[0].text)(mod, mod.exports, require_);

const line = (id, name, qty, unit, rate) => ({
    id, order_id: 'o1', product_id: 1, name_snapshot: name, qty,
    unit_price_snapshot: unit, tax_rate_snapshot: rate,
    price_includes_tax_snapshot: true, options_snapshot: [], note: null,
    line_total: qty * unit, sent_at: null, sent_qty: qty,
    voided: false, void_reason: null, voided_by: null,
});

// Deux taux : 21 % sur place et 6 % à emporter — le cas que Rinor décrit.
const lines = [
    line('l1', 'Entrecôte', 1, 14.41, 21),
    line('l2', 'Café', 2, 2.50, 21),
    line('l3', 'Sandwich à emporter', 1, 5.30, 6),
];
const total = lines.reduce((s, l) => s + l.line_total, 0);
const tax = lines.reduce((s, l) => s + l.line_total - l.line_total / (1 + l.tax_rate_snapshot / 100), 0);

const order = {
    id: 'o1', profile_id: 1, ticket_number: 42, version: 1, session_id: 1,
    room_id: 1, table_id: 2, server_id: 1, status: 'paid', service_type: 'dine_in',
    covers: 2, subtotal: total - tax, tax_total: tax, total,
    opened_at: null, paid_at: null, lines, payments: [{ method: 'cash', amount: total }],
};

const settings = {
    restaurant_name: 'ANTIKA', address: 'Zemst', phone: '+32 2 123 45 67',
    vat_number: 'BE 0123.456.789', receipt_footer: null,
};

const langue = process.argv[2] || 'fr';
mod.exports.useLocale.setState({ locale: langue, overridden: true });

const document = process.argv[3] || 'caisse';
const data = document === 'cuisine'
    ? mod.exports.buildKitchenTicket(order, lines, {
        tableLabel: '12',
        roomName: 'Salle principale',
        serverName: 'Rinor',
    })
    : mod.exports.buildReceipt(order, lines, settings, { tableLabel: '2' });

const net = await import('node:net');
const socket = net.createConnection({ host: '127.0.0.1', port: 9100 }, () => {
    socket.write(data, () => setTimeout(() => socket.destroy(), 250));
});
socket.on('error', (e) => console.error('Envoi impossible :', e.message));
