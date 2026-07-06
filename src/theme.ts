/**
 * Système de design — dark monochrome sobre (identité « speed »). Neutres sans
 * teinte, accent = blanc (état sélectionné = surface blanche + texte foncé, comme
 * l'admin web). Tous les écrans référencent ces tokens : les affiner met à jour
 * toute l'app de façon cohérente.
 */
export const theme = {
    colors: {
        // Fond le plus profond -> surfaces de plus en plus claires (gris neutres).
        bg: '#0A0A0B',
        bgElevated: '#101012',
        surface: '#161618',
        surfaceAlt: '#202023',
        border: '#2A2A2E',
        borderStrong: '#3A3A40',

        // Texte.
        text: '#F6F6F7',
        textMuted: '#9A9AA2',
        textFaint: '#64646C',

        // Accent monochrome : le « sélectionné » est blanc, le texte dessus est foncé.
        primary: '#FFFFFF',
        primarySoft: 'rgba(255,255,255,0.10)',
        onPrimary: '#0A0A0B',

        // États fonctionnels (sobres, réservés au sens : validé / erreur / attention).
        success: '#22C55E',
        successSoft: 'rgba(34,197,94,0.15)',
        danger: '#F04452',
        dangerSoft: 'rgba(240,68,82,0.15)',
        warning: '#F5A524',

        // États de table.
        free: '#161618',
        occupied: '#22C55E',
        billRequested: '#F5A524',

        // Texte sur surfaces colorées (danger/success/tuiles produit).
        onAccent: '#FFFFFF',
    },
    radius: { sm: 10, md: 14, lg: 20, pill: 999 },
    spacing: (n: number) => n * 4,
    // Élévation douce (surtout iOS ; discrète sur fond sombre mais soignée).
    shadow: {
        card: {
            shadowColor: '#000000',
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.22,
            shadowRadius: 12,
            elevation: 4,
        },
    },
    font: {
        title: { fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.4 },
        heading: { fontSize: 20, fontWeight: '800' as const, letterSpacing: -0.2 },
        body: { fontSize: 15, fontWeight: '500' as const },
        label: { fontSize: 13, fontWeight: '600' as const },
    },
};
