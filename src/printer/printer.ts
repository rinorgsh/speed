import { Buffer } from 'buffer';
import TcpSocket from 'react-native-tcp-socket';
import { PRINTING } from '../config';
import type { Order, OrderLine, PrepStation, Printer, Product, Category, SelectedOption, Tax } from '../types';
import { EscPosBuilder } from './escpos';
import * as db from '../db/database';
import { t } from '../i18n';

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
    label: string;
    attempts: number;
    resolve: (ok: boolean) => void;
}

const queue: PrintJob[] = [];
let processing = false;
let jobCounter = 0;

/** Écouteurs du nombre de tickets en échec (alimente l'indicateur à l'écran). */
type FailedListener = (n: number) => void;
const failedListeners = new Set<FailedListener>();

export function onFailedPrintsChange(listener: FailedListener): () => void {
    failedListeners.add(listener);
    void notifyFailed();
    return () => failedListeners.delete(listener);
}

async function notifyFailed(): Promise<void> {
    const n = await db.countFailedPrintJobs().catch(() => 0);
    failedListeners.forEach((l) => l(n));
}

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
            // Imprimé pour de bon : le travail disparaît de la base.
            await db.deletePrintJob(job.id).catch(() => {});
            job.resolve(true);
        } catch (e: any) {
            job.attempts += 1;
            if (job.attempts >= PRINTING.maxRetries) {
                queue.shift();
                /*
                 * Le travail N'EST PAS PERDU : il est conservé en base, marqué
                 * en échec, et relançable depuis l'écran des salles. Un ticket
                 * qui ne sort pas est un plat qui ne sera pas préparé — le
                 * jeter après trois tentatives revenait à effacer une commande.
                 */
                await db.failPrintJob(job.id, e?.message ?? 'Imprimante injoignable').catch(() => {});
                void notifyFailed();
                job.resolve(false);
            } else {
                await new Promise((r) => setTimeout(r, 800 * job.attempts)); // backoff
            }
        }
    }
    processing = false;
}

/**
 * Met un travail en file APRÈS l'avoir écrit en base, et renvoie une promesse
 * (true = imprimé, false = échec après tentatives — le travail reste relançable).
 */
export function enqueuePrint(printer: Printer, data: Buffer, label = 'Ticket'): Promise<boolean> {
    const id = `job_${Date.now()}_${++jobCounter}`;
    const port = printer.port || PRINTING.port;

    return new Promise((resolve) => {
        void db.enqueuePrintJob({
            id,
            printer_id: printer.id,
            printer_name: printer.name,
            host: printer.ip_address,
            port,
            label,
            payload: data.toString('base64'),
        })
            .catch(() => {}) // une base indisponible ne doit pas empêcher d'imprimer
            .finally(() => {
                queue.push({ id, printer, data, label, attempts: 0, resolve });
                void processQueue();
            });
    });
}

/** Reconstruit une imprimante depuis un travail stocké (l'IP est figée dessus). */
function printerOf(job: db.PrintJobRow): Printer {
    return {
        id: job.printer_id,
        name: job.printer_name,
        ip_address: job.host,
        port: job.port,
        role: 'order',
        active: true,
    };
}

/** Remet en file un travail déjà stocké (relance manuelle ou reprise au démarrage). */
function requeueStored(job: db.PrintJobRow): Promise<boolean> {
    return new Promise((resolve) => {
        queue.push({
            id: job.id,
            printer: printerOf(job),
            data: Buffer.from(job.payload, 'base64'),
            label: job.label,
            attempts: 0,
            resolve,
        });
        void processQueue();
    });
}

/**
 * Relance tous les tickets en échec. Renvoie le nombre effectivement imprimé.
 * Appelé depuis le menu des salles, quand l'imprimante est de nouveau joignable.
 */
export async function retryFailedPrints(): Promise<{ ok: number; failed: number }> {
    const jobs = await db.getFailedPrintJobs();
    if (!jobs.length) return { ok: 0, failed: 0 };

    await db.resetFailedPrintJobs();
    const results = await Promise.all(jobs.map((j) => requeueStored(j)));
    await notifyFailed();

    const ok = results.filter(Boolean).length;
    return { ok, failed: results.length - ok };
}

/** Nombre de tickets en attente de relance. */
export function countFailedPrints(): Promise<number> {
    return db.countFailedPrintJobs();
}

/** L'exploitant renonce aux tickets en échec (ils ont été refaits à la main). */
export async function discardFailedPrints(): Promise<void> {
    await db.discardFailedPrintJobs();
    await notifyFailed();
}

/**
 * Reprise au démarrage : les travaux restés « pending » viennent d'une
 * application arrêtée en pleine impression. On les retente une fois, puis ils
 * basculeront en échec s'ils ne passent toujours pas.
 */
export async function resumePendingPrints(): Promise<void> {
    const orphans = await db.getOrphanPrintJobs().catch(() => []);
    for (const job of orphans) void requeueStored(job);
    await notifyFailed();
}

// --- Construction des tickets ---

const euro = (n: number) => `${n.toFixed(2)} EUR`;

/**
 * Ligne d'en-tête d'un ticket cuisine, aussi grande que la largeur l'autorise.
 *
 * La double largeur ramène la ligne à 24 signes : au-delà, le texte passerait à
 * la ligne et perdrait tout son intérêt. On se rabat alors sur la double
 * hauteur seule, qui rend les 48 colonnes tout en restant lisible de loin.
 */
function bigLine(b: EscPosBuilder, text: string): void {
    b.size(text.length <= 24 ? 2 : 1, 2).line(text).size(1, 1);
}

/**
 * Options d'une ligne, regroupées par groupe de choix.
 *
 *      Sauce : Andalouse
 *      Salade : Tomate, Oignon
 *      Supplement : Cheddar (1,00 EUR)
 *
 * Plutôt qu'une liste à plat où « Andalouse » et « Cheddar » se ressemblent :
 * en cuisine on lit la ligne « Sauce » d'un coup d'œil, sans se demander à quoi
 * chaque terme se rapporte. Les lignes créées avant que le groupe soit figé sur
 * le snapshot n'en ont pas : elles retombent sur l'ancien rendu, un par ligne.
 *
 * `withPrice` distingue le ticket cuisine (sans prix) des documents client.
 */
function optionLines(options: SelectedOption[], withPrice: boolean): string[] {
    const rendered: string[] = [];
    const grouped = new Map<string, string[]>();

    for (const opt of options) {
        const label = withPrice && opt.price_delta ? `${opt.name} (${euro(opt.price_delta)})` : opt.name;
        if (!opt.group) {
            rendered.push(`   + ${label}`);
            continue;
        }
        grouped.set(opt.group, [...(grouped.get(opt.group) ?? []), label]);
    }

    for (const [group, labels] of grouped) {
        rendered.push(...wrap(`   ${group} : ${labels.join(', ')}`));
    }

    return rendered;
}

/** Largeur utile d'un rouleau 80 mm en corps normal. */
const COLS = 48;

/**
 * Coupe une ligne trop longue à la fin d'un mot, en alignant la suite sous le
 * premier caractère. Sans cela, « SALADE : Tout, Salade, Maïs, Carotte, Tomate,
 * Concombre, Oignon » repartait en marge à gauche au milieu d'un mot et se
 * confondait avec le groupe suivant.
 */
function wrap(line: string): string[] {
    if (line.length <= COLS) return [line];

    // L'indentation de tête est CONSERVÉE : la découper avec le reste la ferait
    // disparaître, et la ligne repartirait en marge — exactement le défaut qu'on
    // cherche à corriger.
    const lead = line.match(/^ */)?.[0] ?? '';
    const words = line.slice(lead.length).split(' ').filter(Boolean);
    const hanging = lead + '  '; // la suite est décalée : elle appartient visiblement à la ligne du dessus

    const out: string[] = [];
    let current = lead;

    for (const word of words) {
        const candidate = current.trim() ? `${current} ${word}` : current + word;
        if (candidate.length > COLS && current.trim()) {
            out.push(current);
            current = hanging + word;
        } else {
            current = candidate;
        }
    }
    if (current.trim()) out.push(current);

    return out;
}

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
    /*
     * En-tête d'un ticket cuisine : il se lit à un mètre, au-dessus d'un passe,
     * les mains occupées. Trois informations priment, dans cet ordre :
     *
     *      SALLE PRINCIPALE     <- où
     *          TABLE 12         <- où précisément
     *          Rinor            <- qui a pris la commande
     *
     * Le reste (sur place / à emporter, n° de ticket) descend en petit : c'est
     * du contexte, pas ce qu'on cherche des yeux en attrapant le papier.
     */
    b.align('center').bold(true);

    if (meta.roomName) {
        bigLine(b, meta.roomName.toUpperCase());
        bigLine(b, `TABLE ${meta.tableLabel ?? '-'}`);
    } else {
        bigLine(b, 'COMPTOIR');
    }

    // Le serveur : en double hauteur, sous la table. C'est lui qu'on appelle
    // quand une commande pose question.
    b.size(1, 2).line(meta.serverName).size(1, 1);

    b.bold(false);
    b.line(order.service_type === 'takeaway' ? 'A EMPORTER' : 'SUR PLACE');
    if (order.ticket_number != null) b.line(`Ticket #${order.ticket_number}`);
    b.align('left').rule();

    for (const l of lines) {
        const prefix = isCancellation ? 'ANNULER ' : '';
        b.size(2, 2).bold(true).line(`${prefix}${formatQty(l.qty)}x ${l.name_snapshot}`);

        /*
         * Options et note en DOUBLE HAUTEUR, en gras.
         *
         * Sur un ticket cuisine, elles ne sont pas un détail du produit : ce
         * sont LA consigne de préparation. « Sauce : andalouse » décide de ce
         * qu'on met dans le sandwich, au même titre que le nom du plat. Les
         * imprimer en corps normal sous un titre deux fois plus gros revenait
         * à hiérarchiser à l'envers, et obligeait à se pencher sur le papier.
         *
         * Double hauteur SEULEMENT, pas double largeur : la ligne conserve ses
         * 48 colonnes, donc « SALADE : Tomate, Concombre, Oignon » tient sans
         * repasser à la ligne.
         */
        b.size(1, 2).bold(true);
        for (const ligne of optionLines(l.options_snapshot, false)) b.line(ligne);
        if (l.note) b.line(`   ** ${l.note}`);

        b.size(1, 1).bold(false);
        b.feed();
    }

    b.rule().align('center').line(timeStamp());
    b.cut();
    return b.build();
}

/**
 * Avis cuisine de déplacement de table. Indispensable dès qu'un article est
 * déjà parti en préparation : le ticket imprimé porte l'ANCIEN numéro de table,
 * la cuisine doit savoir où sortir l'assiette.
 */
export function buildTableMoveNotice(
    kind: 'transfer' | 'merge',
    fromLabel: string,
    toLabel: string,
    order: Order,
    serverName: string,
): Buffer {
    const b = new EscPosBuilder().init();

    b.align('center').bold(true).size(2, 2);
    b.line(kind === 'merge' ? '*** FUSION ***' : '*** TRANSFERT ***');
    b.size(1, 1).bold(false).feed();

    b.size(2, 2).bold(true).line(`Table ${fromLabel}`);
    b.size(1, 1).line('devient');
    b.size(2, 2).line(`Table ${toLabel}`);
    b.size(1, 1).bold(false).feed();

    b.align('left').rule();
    b.line(`Serveur: ${serverName}`);
    if (order.ticket_number != null) b.line(`Ticket #${order.ticket_number}`);
    b.line(
        kind === 'merge'
            ? 'Les articles des deux tables sont regroupes.'
            : 'Servir les articles deja envoyes a la nouvelle table.',
    );
    b.rule().align('center').line(timeStamp());
    b.cut();
    return b.build();
}

/**
 * ADDITION présentée au client avant paiement (« la note »).
 *
 * Ce n'est PAS un ticket de caisse : aucun paiement n'a eu lieu. Le document
 * l'annonce clairement en tête et en pied, sans numéro de ticket mis en avant
 * et sans ligne de règlement — il ne doit jamais pouvoir passer pour la preuve
 * d'un encaissement.
 */
export function buildBill(
    order: Order,
    lines: OrderLine[],
    settings: Record<string, string | null>,
    meta: { tableLabel: string | null; serverName: string },
): Buffer {
    const b = new EscPosBuilder().init();
    // Même règle que le ticket de caisse : la langue de l'APPAREIL, celle dans
    // laquelle le serveur s'adresse au client.
    const rt = (key: string) => t(key);

    // En-tête établissement.
    b.align('center').bold(true).size(2, 2).line(settings.restaurant_name ?? 'POS');
    b.size(1, 1).bold(false);
    if (settings.address) b.line(settings.address);
    if (settings.phone) b.line(settings.phone);

    // Nature du document, en gros : c'est ce qui le distingue du ticket de caisse.
    b.feed().bold(true).size(2, 2).line(rt('ADDITION')).size(1, 1).bold(false);
    b.line(rt('Document non fiscal'));
    b.feed();

    b.align('left');
    if (meta.tableLabel) b.line(`${rt('Table')}: ${meta.tableLabel}`);
    if (order.covers) b.line(`${rt('Couverts')}: ${order.covers}`);
    b.line(`${rt('Serveur')}: ${meta.serverName}`);
    b.line(timeStamp());
    b.rule();

    for (const l of lines) {
        b.twoCols(`${formatQty(l.qty)}x ${l.name_snapshot}`, euro(l.line_total));
        for (const ligne of optionLines(l.options_snapshot, true)) b.line(ligne);
        // Note sous le produit : le client doit retrouver sur l'addition ce
        // qu'il a demandé à table.
        if (l.note) b.line(`   ** ${l.note}`);
    }
    b.rule();

    const discount = order.discount_amount ?? 0;
    if (discount > 0) {
        b.twoCols(rt('Total avant remise'), euro(round2(order.total + discount)));
        const label = order.discount_type === 'percent'
            ? `${rt('Remise')} ${order.discount_value ?? 0}%`
            : rt('Remise');
        b.bold(true).twoCols(label, `-${euro(discount)}`).bold(false);
    }

    b.twoCols(rt('TVA'), euro(order.tax_total));
    b.bold(true).size(1, 2).twoCols(rt('A PAYER'), euro(order.total)).size(1, 1).bold(false);

    b.feed().align('center').line(rt('Ticket de caisse remis apres paiement.'));
    b.cut();
    return b.build();
}

/**
 * Ligne à quatre colonnes de la ventilation TVA, calée sur 48 caractères.
 *
 * Les nombres sont alignés à droite : c'est ce qui rend une colonne de montants
 * lisible et vérifiable d'un coup d'œil, y compris par un comptable.
 */
function vatRow(a: string, b: string, c: string, d: string): string {
    return a.padStart(12) + b.padStart(12) + c.padStart(11) + d.padStart(13);
}

/** Facture / ticket client : prix + ventilation TVA + en-tête établissement. */
export function buildReceipt(
    order: Order,
    lines: OrderLine[],
    settings: Record<string, string | null>,
    meta: { tableLabel: string | null },
): Buffer {
    const b = new EscPosBuilder().init();

    // Langue du ticket : celle de l'APPAREIL. Le serveur qui encaisse bascule
    // l'application dans la langue du client, et le ticket suit — « TVA »
    // devient « Btw » en néerlandais, « VAT » en anglais.
    const rt = (key: string) => t(key);

    // En-tête établissement.
    b.align('center').bold(true).size(2, 2).line(settings.restaurant_name ?? 'POS');
    b.size(1, 1).bold(false);
    if (settings.address) b.line(settings.address);
    if (settings.phone) b.line(settings.phone);
    if (settings.vat_number) b.line(`${rt('TVA')}: ${settings.vat_number}`);

    // Repère principal : la TABLE, pas le numéro de ticket. C'est ce que le
    // client et le serveur cherchent des yeux en reprenant un ticket.
    b.feed().bold(true).size(1, 2);
    b.line(meta.tableLabel
        ? `${rt('Table').toUpperCase()} N°${meta.tableLabel}`
        : rt('Comptoir').toUpperCase());
    b.size(1, 1).bold(false);

    // Le numéro de ticket reste imprimé, en petit : c'est lui qui permet de
    // retrouver une vente dans le rapport Z et la comptabilité.
    if (order.ticket_number != null) {
        b.line(`${rt('Ticket')} ${order.ticket_number}`);
    }
    b.line(timeStamp());
    b.align('left').rule();

    // Lignes.
    for (const l of lines) {
        b.twoCols(`${formatQty(l.qty)}x ${l.name_snapshot}`, euro(l.line_total));
        for (const ligne of optionLines(l.options_snapshot, true)) b.line(ligne);
        if (l.note) b.line(`   ** ${l.note}`);
    }
    b.rule();

    // Remise : affichée AVANT les totaux, avec le total brut, pour que le client
    // voie ce qui lui a été accordé.
    const discount = order.discount_amount ?? 0;
    if (discount > 0) {
        b.twoCols(rt('Total avant remise'), euro(round2(order.total + discount)));
        const label = order.discount_type === 'percent'
            ? `${rt('Remise')} ${order.discount_value ?? 0}%`
            : rt('Remise');
        b.bold(true).twoCols(label, `-${euro(discount)}`).bold(false);
        if (order.discount_reason) b.line(`  (${order.discount_reason})`);
    }

    /*
     * Ventilation TVA, une ligne par taux :
     *
     *           TA    TAX RATE         TX        TOTAL
     *        11,91       21,00       2,49        14,40
     *
     * TA = base hors taxe, TX = montant de la taxe, TOTAL = TTC. C'est la forme
     * attendue sur un ticket belge, et elle se vérifie de tête : TA + TX = TOTAL.
     *
     * Une remise sur l'addition est déjà répartie au prorata entre les taux par
     * `vatBreakdown` — sans quoi la TVA déclarée dépasserait l'encaissé.
     */
    const breakdown = vatBreakdown(lines, discount);
    if (breakdown.length) {
        // Pas de trait ici : celui qui ferme la liste des articles fait office
        // de séparateur, deux traits collés feraient sale.
        b.line(vatRow('TA', 'TAX RATE', 'TX', 'TOTAL'));
        for (const v of breakdown) {
            // Nombres bruts : la devise est évidente et « EUR » sur chaque
            // cellule rendrait le tableau illisible.
            b.line(vatRow(
                v.base.toFixed(2),
                v.rate.toFixed(2),
                v.taxAmount.toFixed(2),
                round2(v.base + v.taxAmount).toFixed(2),
            ));
        }
        b.rule();
    }

    b.twoCols(rt('Sous-total'), euro(order.subtotal));
    b.twoCols(rt('TVA'), euro(order.tax_total));
    b.bold(true).size(1, 2).twoCols(rt('TOTAL'), euro(order.total)).size(1, 1).bold(false);

    // Paiements.
    b.feed();
    for (const p of order.payments) {
        b.twoCols(p.method === 'cash' ? rt('Especes') : rt('Carte'), euro(p.amount));
    }

    b.feed().align('center').line(settings.receipt_footer ?? rt('Merci !'));
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
export function vatBreakdown(
    lines: OrderLine[],
    discountAmount = 0,
): { rate: number; base: number; taxAmount: number }[] {
    // Une remise sur l'addition est répartie au prorata sur chaque taux : sinon
    // la ventilation TVA du ticket ne correspondrait pas au total encaissé.
    const gross = lines.reduce(
        (s, l) => (l.voided ? s : s + (l.price_includes_tax_snapshot ? l.line_total : l.line_total * (1 + l.tax_rate_snapshot / 100))),
        0,
    );
    const ratio = gross > 0 ? Math.max(gross - Math.max(discountAmount, 0), 0) / gross : 1;

    const map = new Map<number, { base: number; taxAmount: number }>();
    for (const l of lines) {
        if (l.voided) continue;
        const rate = l.tax_rate_snapshot;
        const total = l.line_total * ratio;
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
/**
 * Regroupe les lignes par POSTE de préparation (catégorie → poste). Les lignes
 * dont la catégorie n'a pas de poste retombent sur `legacyFallback`, ce qui
 * préserve le comportement des installations pas encore migrées.
 */
export function groupLinesByStation(
    lines: OrderLine[],
    products: Product[],
    categories: Category[],
    stations: PrepStation[],
    printers: Printer[],
    legacyFallback: Printer | null,
): { station: PrepStation | null; printer: Printer | null; lines: OrderLine[] }[] {
    const productById = new Map(products.map((p) => [p.id, p]));
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const stationById = new Map(stations.map((s) => [s.id, s]));
    const printerById = new Map(printers.map((p) => [p.id, p]));

    /**
     * Clé de regroupement = un ticket.
     *
     * Par poste de préparation quand il y en a un. Sinon PAR IMPRIMANTE : deux
     * catégories routées vers deux imprimantes différentes doivent produire
     * deux tickets, y compris si les deux fiches pointent la même machine —
     * c'est ainsi qu'on obtient un ticket « durum » et un ticket « sandwich »
     * sur le même rouleau. Auparavant toutes les lignes sans poste tombaient
     * dans un groupe unique : un seul ticket sortait, sur l'imprimante de la
     * première ligne, et le routage par catégorie n'avait aucun effet.
     */
    const groups = new Map<string, { station: PrepStation | null; printer: Printer | null; lines: OrderLine[] }>();

    for (const line of lines) {
        const product = line.product_id ? productById.get(line.product_id) : undefined;
        const category = product ? categoryById.get(product.category_id) : undefined;
        const station = category?.station_id ? stationById.get(category.station_id) ?? null : null;

        const printer = station
            ? (station.printer_id ? printerById.get(station.printer_id) ?? null : null)
            : ((category?.printer_id ? printerById.get(category.printer_id) : undefined) ?? legacyFallback);

        const key = station ? `poste:${station.id}` : `imprimante:${printer?.id ?? 0}`;

        const group = groups.get(key) ?? { station, printer: printer ?? null, lines: [] };
        group.lines.push(line);
        groups.set(key, group);
    }

    return [...groups.values()];
}

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
