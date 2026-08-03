/**
 * Ticket de démonstration de la preuve.
 *
 * Le point à démontrer tient dans l'import ci-dessous : on charge le VRAI
 * `src/printer/escpos.ts` de l'application mobile, sans copie ni adaptation.
 * Les octets envoyés depuis le bureau sont donc, au bit près, ceux que produit
 * l'iPad.
 *
 * La structure reprend celle de `buildBill` : en-tête établissement, lignes
 * avec note, remise, totaux, coupe, tiroir-caisse. Les accents et le symbole €
 * valident au passage l'encodage CP1252.
 */
import { EscPosBuilder } from '../../src/printer/escpos';

export function buildDemoTicket(now: Date = new Date()): Buffer {
    const b = new EscPosBuilder().init();

    b.align('center').bold(true).size(2, 2).line('LE BRASERO');
    b.size(1, 1).bold(false);
    b.line('Rue de la Loi 12, Bruxelles');
    b.line('+32 2 123 45 67');

    b.feed().bold(true).size(2, 2).line('ADDITION').size(1, 1).bold(false);
    b.line('Document non fiscal');
    b.feed();

    b.align('left');
    b.line('Table: 12');
    b.line('Serveur: Rinor');
    b.line(now.toLocaleString('fr-BE'));
    b.rule();

    b.twoCols('2x Entrecôte', '49,00 EUR');
    b.line('   + Cuisson à point');
    b.line('   ** Sans oignon, bien cuit');
    b.twoCols('1x Crème brûlée', '8,50 EUR');
    b.twoCols('3x Café', '7,50 EUR');
    b.rule();

    b.twoCols('Total avant remise', '65,00 EUR');
    b.bold(true).twoCols('Remise 10%', '-6,50 EUR').bold(false);
    b.twoCols('TVA', '6,64 EUR');
    b.bold(true).size(1, 2).twoCols('A PAYER', '58,50 EUR').size(1, 1).bold(false);

    b.feed().align('center').line('Ticket de caisse remis apres paiement.');
    b.line('Accents : é è ê à ç ù œ — €');
    b.cut();
    b.kickDrawer();

    return b.build();
}
