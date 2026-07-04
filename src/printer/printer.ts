import { Buffer } from 'buffer';
import TcpSocket from 'react-native-tcp-socket';
import { PRINTING } from '../config';
import type { Order, OrderLine, Printer, Product, Category, Tax } from '../types';
import { EscPosBuilder } from './escpos';

/**
 * Module d'impression POS — Epson TM-m30II (ESC/POS sur TCP 9100).
 *
 * - Connexion LAN directe téléphone → imprimante (jamais via le serveur).
 * - File d'attente avec retry : un job d'impression est rejoué en cas d'échec.
 * - Routage : les lignes sont regroupées par imprimante (catégorie → printer_id),
 *   un ticket cuisine distinct par imprimante (gros texte, sans prix).
 * - Facture client sur l'imprimante `receipt` (prix + ventilation TVA) + kick tiroir.
 */

interface PrintJob {
    id: string;
    printer: Printer;
    data: Buffer;
    attempts: number;
    resolve: (ok: boolean) => void;
}

const queue: PrintJob[] = [];
let processing = false;
let jobCounter = 0;

/** Envoie un buffer brut à une imprimante via TCP 9100 (timeout géré). */
function sendRaw(host: string, port: number, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (err?: Error) => {
            if (settled) return;
            settled = true;
            try {
                client.destroy();
            } catch {
                /* noop */
            }
            err ? reject(err) : resolve();
        };

        const client = TcpSocket.createConnection({ host, port }, () => {
            client.write(data, undefined, () => {
                // Laisse le buffer partir avant de fermer.
                setTimeout(() => done(), 250);
            });
        });

        client.setTimeout(PRINTING.connectTimeout, () => done(new Error('Timeout imprimante')));
        client.on('error', (e: Error) => done(e));
    });
}

/** Boucle de traitement de la file (séquentielle, avec retry). */
async function processQueue(): Promise<void> {
    if (processing) return;
    processing = true;
    while (queue.length) {
        const job = queue[0];
        try {
            await sendRaw(job.printer.ip_address, job.printer.port || PRINTING.port, job.data);
            queue.shift();
            job.resolve(true);
        } catch {
            job.attempts += 1;
            if (job.attempts >= PRINTING.maxRetries) {
                queue.shift();
                job.resolve(false);
            } else {
                await new Promise((r) => setTimeout(r, 800 * job.attempts)); // backoff
            }
        }
    }
    processing = false;
}

/** Met un job en file et renvoie une promesse (true = imprimé, false = échec après retries). */
export function enqueuePrint(printer: Printer, data: Buffer): Promise<boolean> {
    return new Promise((resolve) => {
        queue.push({ id: `job_${++jobCounter}`, printer, data, attempts: 0, resolve });
        void processQueue();
    });
}

// --- Construction des tickets ---

const euro = (n: number) => `${n.toFixed(2)} EUR`;

/** Ticket cuisine/bar : gros texte, SANS prix. isCancellation = ticket d'annulation. */
export function buildKitchenTicket(
    order: Order,
    lines: OrderLine[],
    meta: { tableLabel: string | null; roomName: string | null; serverName: string },
    isCancellation = false,
): Buffer {
    const b = new EscPosBuilder().init();

    if (isCancellation) {
        b.align('center').bold(true).size(2, 2).line('*** ANNULATION ***');
        b.size(1, 1);
    }
    b.align('center').bold(true).size(1, 1);
    b.line(meta.roomName ? `${meta.roomName} - Table ${meta.tableLabel ?? '-'}` : 'COMPTOIR');
    b.size(1, 1).line(`Serveur: ${meta.serverName}`);
    b.line(order.service_type === 'takeaway' ? 'A EMPORTER' : 'SUR PLACE');
    if (order.ticket_number != null) b.bold(true).line(`Ticket #${order.ticket_number}`).bold(false);
    b.align('left').bold(false).rule();

    for (const l of lines) {
        const prefix = isCancellation ? 'ANNULER ' : '';
        b.size(2, 2).bold(true).line(`${prefix}${formatQty(l.qty)}x ${l.name_snapshot}`);
        b.size(1, 1).bold(false);
        for (const opt of l.options_snapshot) {
            b.line(`   + ${opt.name}`);
        }
        if (l.note) b.line(`   ** ${l.note}`);
        b.feed();
    }

    b.rule().align('center').line(timeStamp());
    b.cut();
    return b.build();
}

/** Facture / ticket client : prix + ventilation TVA + en-tête établissement. */
export function buildReceipt(
    order: Order,
    lines: OrderLine[],
    settings: Record<string, string | null>,
    detailed: boolean,
): Buffer {
    const b = new EscPosBuilder().init();

    // En-tête établissement.
    b.align('center').bold(true).size(2, 2).line(settings.restaurant_name ?? 'POS');
    b.size(1, 1).bold(false);
    if (settings.address) b.line(settings.address);
    if (settings.phone) b.line(settings.phone);
    if (settings.vat_number) b.line(`TVA: ${settings.vat_number}`);
    // N° de ticket du jour (bien visible) + date.
    if (order.ticket_number != null) {
        b.feed().bold(true).size(1, 2).line(`TICKET N°${order.ticket_number}`).size(1, 1).bold(false);
    }
    b.line(timeStamp());
    b.align('left').rule();

    // Lignes.
    for (const l of lines) {
        b.twoCols(`${formatQty(l.qty)}x ${l.name_snapshot}`, euro(l.line_total));
        for (const opt of l.options_snapshot) {
            b.line(`   + ${opt.name}${opt.price_delta ? ` (${euro(opt.price_delta)})` : ''}`);
        }
    }
    b.rule();

    // Totaux + ventilation TVA (facture détaillée).
    if (detailed) {
        for (const v of vatBreakdown(lines)) {
            b.twoCols(`Dont TVA ${v.rate}%`, euro(v.taxAmount));
        }
    }
    b.twoCols('Sous-total', euro(order.subtotal));
    b.twoCols('TVA', euro(order.tax_total));
    b.bold(true).size(1, 2).twoCols('TOTAL', euro(order.total)).size(1, 1).bold(false);

    // Paiements.
    b.feed();
    for (const p of order.payments) {
        b.twoCols(p.method === 'cash' ? 'Especes' : 'Carte', euro(p.amount));
    }

    b.feed().align('center').line(settings.receipt_footer ?? 'Merci !');
    b.line(timeStamp());
    b.cut();
    return b.build();
}

// --- Helpers ---

function formatQty(qty: number): string {
    return Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function timeStamp(): string {
    const d = new Date();
    return d.toLocaleDateString('fr-BE') + ' ' + d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
}

/** Ventilation de la TVA par taux (à partir des snapshots de lignes). */
export function vatBreakdown(lines: OrderLine[]): { rate: number; base: number; taxAmount: number }[] {
    const map = new Map<number, { base: number; taxAmount: number }>();
    for (const l of lines) {
        if (l.voided) continue;
        const rate = l.tax_rate_snapshot;
        const total = l.line_total;
        // line_total est TTC si price_includes_tax, sinon HT.
        const tax = l.price_includes_tax_snapshot
            ? total - total / (1 + rate / 100)
            : total * (rate / 100);
        const base = l.price_includes_tax_snapshot ? total - tax : total;
        const acc = map.get(rate) ?? { base: 0, taxAmount: 0 };
        acc.base += base;
        acc.taxAmount += tax;
        map.set(rate, acc);
    }
    return [...map.entries()]
        .map(([rate, v]) => ({ rate, base: round2(v.base), taxAmount: round2(v.taxAmount) }))
        .sort((a, b) => a.rate - b.rate);
}

/**
 * Regroupe les lignes par imprimante de routage (catégorie → printer_id) pour
 * les tickets cuisine/bar. Les lignes sans imprimante vont sur `fallback`.
 */
export function groupLinesByPrinter(
    lines: OrderLine[],
    products: Product[],
    categories: Category[],
    printers: Printer[],
    fallback: Printer | null,
): { printer: Printer; lines: OrderLine[] }[] {
    const productById = new Map(products.map((p) => [p.id, p]));
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const printerById = new Map(printers.map((p) => [p.id, p]));
    const groups = new Map<number, { printer: Printer; lines: OrderLine[] }>();

    for (const line of lines) {
        const product = line.product_id ? productById.get(line.product_id) : undefined;
        const category = product ? categoryById.get(product.category_id) : undefined;
        const printer = (category?.printer_id ? printerById.get(category.printer_id) : undefined) ?? fallback;
        if (!printer) continue;
        const group = groups.get(printer.id) ?? { printer, lines: [] };
        group.lines.push(line);
        groups.set(printer.id, group);
    }
    return [...groups.values()];
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export type { Tax };
