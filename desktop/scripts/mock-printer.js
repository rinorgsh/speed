/**
 * Fausse imprimante ESC/POS : écoute le port 9100 comme une TM-m30II, décode ce
 * qu'elle reçoit et l'affiche dans le terminal.
 *
 * Sert à valider la chaîne complète (interface → pont → socket TCP) sans
 * matériel. Ce que ce script affiche est EXACTEMENT ce que l'imprimante
 * recevrait : mêmes octets, mêmes commandes, mêmes accents.
 */
const net = require('node:net');

const PORT = Number(process.argv[2]) || 9100;

/** Commandes ESC/POS reconnues, pour rendre le flux lisible. */
function describe(bytes, i) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    if (a === 0x1b && b === 0x40) return ['⟨init⟩', 2];
    if (a === 0x1b && b === 0x74) return [`⟨page de code ${c}⟩`, 3];
    if (a === 0x1b && b === 0x61) return [`⟨align ${['gauche', 'centre', 'droite'][c] ?? c}⟩`, 3];
    if (a === 0x1b && b === 0x45) return [c ? '⟨gras⟩' : '⟨/gras⟩', 3];
    if (a === 0x1d && b === 0x21) return [`⟨taille ${(c >> 4) + 1}x${(c & 0x0f) + 1}⟩`, 3];
    if (a === 0x1d && b === 0x56) return ['\n⟨COUPE PAPIER⟩', 4];
    if (a === 0x1b && b === 0x70) return ['⟨TIROIR-CAISSE⟩', 5];
    return null;
}

/** Décode les octets CP1252 en texte lisible (inverse de encodeCp1252). */
const CP1252_HIGH = {
    0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
    0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
    0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
    0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function render(buffer) {
    let out = '';
    let i = 0;
    while (i < buffer.length) {
        const command = describe(buffer, i);
        if (command) {
            out += command[0];
            i += command[1];
            continue;
        }
        const byte = buffer[i];
        out += byte >= 0x80 && byte <= 0x9f ? (CP1252_HIGH[byte] ?? '?') : Buffer.from([byte]).toString('latin1');
        i += 1;
    }
    return out;
}

net.createServer((socket) => {
    const chunks = [];
    console.log(`\n── Connexion de ${socket.remoteAddress} ──`);

    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('close', () => {
        const data = Buffer.concat(chunks);
        console.log(`${data.length} octets reçus. Ticket décodé :\n`);
        console.log('┌' + '─'.repeat(50));
        for (const line of render(data).split('\n')) console.log('│ ' + line);
        console.log('└' + '─'.repeat(50) + '\n');
    });
    socket.on('error', () => { /* le client coupe après écriture, c'est normal */ });
}).listen(PORT, () => {
    console.log(`Fausse imprimante ESC/POS en écoute sur le port ${PORT}.`);
    console.log('En attente d\'un ticket…');
});
