import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AlertTriangle } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Keypad } from '../components/Keypad';
import { Button } from '../components/Button';
import { theme } from '../theme';
import { closeSession, fetchSessionSummary } from '../api/client';
import { printOrderCancellation } from '../services/printing';
import { useAuth } from '../store/useAuth';
import { useConfig } from '../store/useConfig';
import type { Order } from '../types';
import type { RootStackParamList } from '../navigation/types';

const fmt = (n: number | undefined | null) => `${(n ?? 0).toFixed(2)} €`;
const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '—');

/** Fermeture de caisse : avertissement commandes, comptage cash, rapport Z détaillé. */
export function CloseSessionScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'CloseSession'>) {
    const session = useAuth((s) => s.session);
    const server = useAuth((s) => s.server);
    const setSession = useAuth((s) => s.setSession);
    const clearActiveProfile = useAuth((s) => s.clearActiveProfile);
    const sync = useConfig((s) => s.syncFromServer);
    const [summary, setSummary] = useState<any | null>(null);
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const [report, setReport] = useState<any | null>(null);
    // Petit écran : le pavé et le montant se resserrent pour que le bouton de
    // fermeture reste atteignable sans défiler.
    const { height } = useWindowDimensions();
    const shortScreen = height < 780;

    useEffect(() => {
        if (session) fetchSessionSummary(session.id).then(setSummary).catch(() => setSummary({ error: true }));
    }, [session]);

    // --- Rapport Z --- (AVANT la garde de session : la caisse vient d'être fermée,
    // la session est déjà coupée, on doit quand même afficher le rapport.)
    if (report) {
        return (
            <Screen>
                <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing(4) }}>
                    <Text style={styles.title}>Rapport Z</Text>

                    <Text style={styles.section}>Réconciliation caisse</Text>
                    <Row label="Fond de caisse" value={fmt(report.opening_cash)} />
                    <Row label="Ventes cash" value={fmt(report.cash_total)} />
                    <Row label="Cash attendu" value={fmt(report.expected_cash)} strong />
                    <Row label="Cash compté" value={fmt(report.closing_cash)} strong />
                    <Row
                        label={report.cash_difference < 0 ? 'Écart (manque)' : report.cash_difference > 0 ? 'Écart (excédent)' : 'Écart'}
                        value={fmt(report.cash_difference)}
                        color={report.cash_difference === 0 ? theme.colors.success : theme.colors.danger}
                    />
                    <Row label="Total carte" value={fmt(report.card_total)} />

                    {report.cancelled_count > 0 && (
                        <View style={[styles.banner, styles.bannerWarn]}>
                            <AlertTriangle color={theme.colors.warning} size={18} />
                            <Text style={styles.bannerText}>
                                {report.cancelled_count} commande(s) annulée(s) à la fermeture
                                {report.printFail ? ' — impression annulation à vérifier' : ''}
                            </Text>
                        </View>
                    )}

                    <Text style={styles.section}>Transactions ({report.orders_count})</Text>
                    {(report.transactions ?? []).map((t: any, i: number) => (
                        <View key={i} style={styles.txRow}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.txMain}>#{t.ticket_number ?? '—'} · {hm(t.paid_at)}</Text>
                                <Text style={styles.txSub}>{t.server ?? '—'} · {(t.payments ?? []).map((p: any) => p.method === 'cash' ? 'Espèces' : 'Carte').join(' + ')}</Text>
                            </View>
                            <Text style={styles.txAmount}>{fmt(t.total)}</Text>
                        </View>
                    ))}
                    {!(report.transactions ?? []).length && <Text style={styles.empty}>Aucune transaction.</Text>}

                    {Array.isArray(report.by_server) && report.by_server.length > 0 && (
                        <>
                            <Text style={styles.section}>Ventes par serveur</Text>
                            {report.by_server.map((s: any) => (
                                <Row key={s.server_id} label={`${s.name} (${s.orders})`} value={fmt(s.total)} />
                            ))}
                        </>
                    )}
                </ScrollView>
                <Button label="Terminer" onPress={() => void clearActiveProfile()} />
            </Screen>
        );
    }

    if (!session) {
        return <Screen><Text style={styles.title}>Aucune session ouverte</Text></Screen>;
    }

    const counted = parseFloat(amount || '0');
    const expected = summary?.expected_cash ?? 0;
    const diff = Math.round((counted - expected) * 100) / 100;
    const openCount = summary?.open_orders_count ?? 0;

    const doClose = async () => {
        if (!server) return;
        setLoading(true);
        try {
            const { report: z, cancelled } = await closeSession(session.id, counted, server.id);
            // Impression des annulations cuisine pour les commandes annulées (envoyées).
            let printFail = false;
            for (const o of cancelled as Order[]) {
                if (!(await printOrderCancellation(o))) printFail = true;
            }
            setSession(null);
            await sync();
            setReport({ ...z, printFail: printFail && cancelled.length > 0 });
        } catch (e: any) {
            Alert.alert('Fermeture impossible', e?.response?.data?.message ?? 'Connexion au serveur requise.');
        } finally {
            setLoading(false);
        }
    };

    const confirmClose = () => {
        const warn = openCount > 0
            ? `\n\n⚠ ${openCount} commande(s) non payée(s) (${fmt(summary?.open_orders_total)}) seront ANNULÉES et retirées des tables.`
            : '';
        Alert.alert(
            'Fermer la caisse ?',
            `Cash compté : ${fmt(counted)}${warn}`,
            [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Fermer', style: 'destructive', onPress: () => void doClose() },
            ],
        );
    };

    // --- Comptage ---
    return (
        <Screen>
            <Text style={styles.title}>Fermeture de caisse</Text>

            {!summary ? (
                <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
            ) : (
                /* Trois zones : ce qu'on lit en haut, la saisie au milieu, l'action
                   en bas. Le bouton de fermeture est ÉPINGLÉ — il était le dernier
                   élément d'une colonne sans défilement, donc invisible dès que
                   l'avertissement des commandes impayées s'affichait. */
                <View style={styles.countRoot}>
                    <View>
                        {openCount > 0 && (
                            <View style={[styles.banner, styles.bannerDanger]}>
                                <AlertTriangle color={theme.colors.danger} size={16} />
                                <Text style={styles.bannerText}>{openCount} commande(s) non payée(s) ({fmt(summary.open_orders_total)}) seront annulées.</Text>
                            </View>
                        )}

                        {/* Cash attendu — compact, toujours visible en haut */}
                        <View style={styles.expectedRow}>
                            <Text style={styles.expLabel}>Cash attendu en caisse</Text>
                            <Text style={styles.expValue}>{fmt(expected)}</Text>
                        </View>
                        <Text style={styles.expSub}>Fond {fmt(summary.opening_cash)} + ventes cash {fmt(summary.cash_total)}</Text>

                        {/* Cash compté + écart en direct */}
                        <View style={[styles.amountBox, shortScreen && styles.amountBoxCompact]}>
                            <Text style={styles.amountLabel}>Cash compté</Text>
                            <Text style={[styles.amount, shortScreen && styles.amountCompact]}>{amount || '0'} €</Text>
                            {!!amount && (
                                <Text style={[styles.diff, { color: diff === 0 ? theme.colors.success : theme.colors.danger }]}>
                                    Écart {diff > 0 ? '+' : ''}{diff.toFixed(2)} €
                                </Text>
                            )}
                        </View>
                    </View>

                    <ScrollView
                        style={styles.padScroll}
                        contentContainerStyle={styles.padScrollContent}
                        keyboardShouldPersistTaps="handled"
                    >
                        <Keypad
                            compact={shortScreen}
                            onKey={(d) => setAmount((a) => (d === '.' && a.includes('.') ? a : a + d))}
                            onDelete={() => setAmount((a) => a.slice(0, -1))}
                        />
                    </ScrollView>

                    <Button label="Fermer la caisse" variant="danger" onPress={confirmClose} loading={loading} />
                </View>
            )}
        </Screen>
    );
}

function Row({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
    return (
        <View style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={[styles.rowValue, strong && { fontSize: 17, fontWeight: '800' }, color && { color }]}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    title: { color: theme.colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.3, marginBottom: theme.spacing(4) },
    subtitle: { color: theme.colors.textMuted, marginTop: theme.spacing(4), marginBottom: theme.spacing(2), fontSize: 15 },
    section: { color: theme.colors.textMuted, marginTop: theme.spacing(5), marginBottom: theme.spacing(2), fontWeight: '700', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    countRoot: { flex: 1 },
    // Seule la saisie défile : l'en-tête et le bouton restent en place.
    padScroll: { flex: 1 },
    padScrollContent: { justifyContent: 'flex-end', flexGrow: 1, paddingTop: theme.spacing(2) },
    amountLabel: { color: theme.colors.textMuted, fontSize: 13, marginBottom: theme.spacing(1) },
    expectedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3) },
    banner: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2.5), borderRadius: theme.radius.md, padding: theme.spacing(3.5), marginBottom: theme.spacing(4) },
    bannerDanger: { backgroundColor: theme.colors.dangerSoft, borderWidth: 1, borderColor: theme.colors.danger },
    bannerWarn: { backgroundColor: theme.colors.warning + '22', borderWidth: 1, borderColor: theme.colors.warning, marginTop: theme.spacing(4) },
    bannerText: { color: theme.colors.text, flex: 1, fontSize: 13, fontWeight: '600' },
    expectedBox: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.lg, padding: theme.spacing(4), marginBottom: theme.spacing(2) },
    expLabel: { color: theme.colors.textMuted, fontSize: 13 },
    expValue: { color: theme.colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
    expSub: { color: theme.colors.textFaint, fontSize: 12 },
    amountBox: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: theme.spacing(3.5), alignItems: 'center', marginTop: theme.spacing(3), marginBottom: theme.spacing(3) },
    amount: { color: theme.colors.text, fontSize: 40, fontWeight: '800', letterSpacing: -1 },
    amountBoxCompact: { paddingVertical: theme.spacing(2.5), marginTop: theme.spacing(2), marginBottom: theme.spacing(2) },
    amountCompact: { fontSize: 32 },
    diff: { fontSize: 15, fontWeight: '700', marginTop: theme.spacing(1.5) },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: theme.spacing(2.5), borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    rowLabel: { color: theme.colors.textMuted, fontSize: 15 },
    rowValue: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
    txRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing(2.5), borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    txMain: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
    txSub: { color: theme.colors.textMuted, fontSize: 12, marginTop: 1 },
    txAmount: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
    empty: { color: theme.colors.textMuted, textAlign: 'center', marginVertical: theme.spacing(4) },
});
