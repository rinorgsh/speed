import { Buffer } from 'buffer';

/**
 * Encodeur ESC/POS pour imprimantes Epson (TM-m30II).
 *
 * Construit un flux d'octets via un builder fluide. Le texte est encodé en
 * WPC1252 (CP1252) pour les accents FR : on sélectionne la page 16 sur
 * l'imprimante (ESC t 16) et on convertit la chaîne en octets CP1252.
 */

const ESC = 0x1b;
const GS = 0x1d;

// Caractères CP1252 de la plage 0x80–0x9F qui diffèrent de l'Unicode brut.
const CP1252_SPECIALS: Record<number, number> = {
    0x20ac: 0x80, // €
    0x201a: 0x82,
    0x0192: 0x83,
    0x201e: 0x84,
    0x2026: 0x85, // …
    0x2020: 0x86,
    0x2021: 0x87,
    0x02c6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8a,
    0x2039: 0x8b,
    0x0152: 0x8c, // Œ
    0x017d: 0x8e,
    0x2018: 0x91, // '
    0x2019: 0x92, // '
    0x201c: 0x93, // "
    0x201d: 0x94, // "
    0x2022: 0x95,
    0x2013: 0x96, // –
    0x2014: 0x97, // —
    0x02dc: 0x98,
    0x2122: 0x99, // ™
    0x0161: 0x9a,
    0x203a: 0x9b,
    0x0153: 0x9c, // œ
    0x017e: 0x9e,
    0x0178: 0x9f, // Ÿ
};

/** Convertit une chaîne JS en octets CP1252 (FR-friendly). */
export function encodeCp1252(text: string): number[] {
    const out: number[] = [];
    for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp <= 0xff) {
            out.push(cp); // ASCII + Latin-1 (== CP1252 pour 0xA0–0xFF)
        } else if (CP1252_SPECIALS[cp] !== undefined) {
            out.push(CP1252_SPECIALS[cp]);
        } else {
            out.push(0x3f); // « ? » pour les caractères non représentables
        }
    }
    return out;
}

export type Align = 'left' | 'center' | 'right';

export class EscPosBuilder {
    private bytes: number[] = [];

    /** Initialise l'imprimante + page de code WPC1252 (accents FR). */
    init(): this {
        this.bytes.push(ESC, 0x40); // ESC @ : reset
        this.bytes.push(ESC, 0x74, 16); // ESC t 16 : code page WPC1252
        return this;
    }

    align(a: Align): this {
        const n = a === 'center' ? 1 : a === 'right' ? 2 : 0;
        this.bytes.push(ESC, 0x61, n);
        return this;
    }

    bold(on: boolean): this {
        this.bytes.push(ESC, 0x45, on ? 1 : 0);
        return this;
    }

    /** Taille : multiplicateur largeur/hauteur de 1 à 8 (GS ! n). */
    size(width: number, height: number): this {
        const w = Math.max(1, Math.min(8, width)) - 1;
        const h = Math.max(1, Math.min(8, height)) - 1;
        this.bytes.push(GS, 0x21, (w << 4) | h);
        return this;
    }

    text(value: string): this {
        this.bytes.push(...encodeCp1252(value));
        return this;
    }

    line(value = ''): this {
        return this.text(value).feed();
    }

    feed(n = 1): this {
        for (let i = 0; i < n; i++) this.bytes.push(0x0a);
        return this;
    }

    /** Ligne de séparation pleine largeur (48 colonnes en police A 80mm). */
    rule(char = '-', width = 48): this {
        return this.line(char.repeat(width));
    }

    /** Deux colonnes : libellé à gauche, valeur alignée à droite. */
    twoCols(left: string, right: string, width = 48): this {
        const space = Math.max(1, width - left.length - right.length);
        return this.line(left + ' '.repeat(space) + right);
    }

    /** Coupe partielle du papier (avec avance). */
    cut(): this {
        this.feed(4);
        this.bytes.push(GS, 0x56, 66, 0); // GS V 66 0 : partial cut
        return this;
    }

    /** Impulsion d'ouverture du tiroir-caisse (connecteur DK Epson). */
    kickDrawer(): this {
        this.bytes.push(ESC, 0x70, 0x00, 0x19, 0xfa); // ESC p 0 25 250
        return this;
    }

    build(): Buffer {
        return Buffer.from(this.bytes);
    }
}
