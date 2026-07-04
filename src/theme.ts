/**
 * Système de design — dark premium (surfaces en couches + bordures subtiles,
 * façon Linear/Vercel). Tous les écrans référencent ces tokens : les affiner
 * met à jour toute l'app de façon cohérente.
 */
export const theme = {
    colors: {
        // Fond le plus profond -> surfaces de plus en plus claires.
        bg: '#0B0E15',
        bgElevated: '#0F131C',
        surface: '#151A24',
        surfaceAlt: '#1E2431',
        border: '#272E3C',
        borderStrong: '#333B4C',

        // Texte.
        text: '#F4F6FA',
        textMuted: '#8B94A7',
        textFaint: '#5C6577',

        // Accent + états.
        primary: '#6366F1',
        primarySoft: 'rgba(99,102,241,0.16)',
        success: '#22C55E',
        successSoft: 'rgba(34,197,94,0.16)',
        danger: '#F04452',
        dangerSoft: 'rgba(240,68,82,0.16)',
        warning: '#F5A524',

        // États de table.
        free: '#151A24',
        occupied: '#22C55E',
        billRequested: '#F5A524',

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
