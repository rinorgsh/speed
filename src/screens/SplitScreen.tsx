import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banknote, CreditCard, Minus } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { theme } from '../theme';
import { useCart } from '../store/useCart';
import { useConfig } from '../store/useConfig';
import { computeOrderTotals } from '../utils/pricing';
import { printCustomerReceipt } from '../services/printing';
import { flushOutbox } from '../services/sync';
import { buildSubticket, settleSubticket } from '../services/split';
import type { OrderLine, PaymentMethod } from '../types';
import type { RootStackParamList } from '../navigation/types';

const euro = (n: number) => `${n.toFixed(2)} €`;
const fmtQty = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));

/**
 * Partage d'addition « par article » : on répartit les articles d'une table entre
 * plusieurs sous-tickets, chacun payé et imprimé séparément. La table se solde
 * quand tout est réglé. Accessible via « Partager » sur l'écran Paiement.
 */
export function SplitScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Split'>) {
    const order = useCart((s) => s.order);
    const tables = useConfig((s) => s.tables);
    const [assigned, setAssigned] = useState<Record<string, number>>({});
    const [person, setPerson] = useState(1);
    const [processing, setProcessing] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);

    if (!order) {
        navigation.goBack();
        return null;
    }

    const table = tables.find((t) => t.id === order.table_id);
    const where = order.table_id ? `Table ${table?.label ?? ''}` : 'Comptoir';

    const payable = order.lines.filter((l) => !l.voided && l.qty > 0);
    const availOf = (l: OrderLine) => l.qty - (assigned[l.id] ?? 0);

    // Lignes du ticket en cours (portions assignées) + total exact (TVA incluse).
    const cartEntries = payable.map((l) => ({ l, q: assigned[l.id] ?? 0 })).filter((x) => x.q > 0);
    const cartScaled: OrderLine[] = cartEntries.map((x) => ({
        ...x.l,
        qty: x.q,
        line_total: (x.l.line_total / x.l.qty) * x.q,
    }));
    const cartTotal = computeOrderTotals(cartScaled).total;
    const remainingUnits = payable.reduce((s, l) => s + availOf(l), 0);

    const assign = (l: OrderLine) => {
        if (availOf(l) <= 0) return;
        setAssigned((a) => ({ ...a, [l.id]: (a[l.id] ?? 0) + 1 }));
    };
    const unassign = (id: string) => setAssigned((a) => ({ ...a, [id]: Math.max(0, (a[id] ?? 0) - 1) }));

    const pay = async (method: PaymentMethod) => {
        if (processing || cartTotal <= 0) return;
        setProcessing(true);
        try {
            const assignments = cartEntries.map((x) => ({ lineId: x.l.id, qty: x.q }));
            const isFinal = remainingUnits === 0; // ce ticket prend tout ce qui reste

            if (isFinal) {
                // Dernier ticket : on paie la commande mère elle-même -> table libérée.
                const cart = useCart.getState();
                cart.addPayment(method, cart.order!.total);
                cart.markPaid();
                const paid = useCart.getState().order!;
                await printCustomerReceipt(paid, false).catch(() => false);
                await flushOutbox();
                cart.clear();
                navigation.reset({ index: 0, routes: [{ name: 'Rooms' }] });
                return;
            }

            // Ticket intermédiaire : commande enfant payée + réduction de la mère.
            const child = buildSubticket(useCart.getState().order!, assignments, method);
            await settleSubticket(child);
            useCart.getState().settleLines(assignments);
            setAssigned({});
            setPerson((p) => p + 1);
            setFlash(`Ticket encaissé · ${euro(child.total)}`);
            setTimeout(() => setFlash(null), 1800);
        } finally {
            setProcessing(false);
        }
    };

    return (
        <Screen style={{ padding: 0 }} edges={['bottom']}>
            <View style={styles.head}>
                <View style={styles.headRow}>
                    <View>
                        <Text style={styles.title}>Partager l'addition</Text>
                        <Text style={styles.sub}>{where}</Text>
                    </View>
                    <View style={styles.reste}>
                        <Text style={styles.resteLabel}>Reste</Text>
                        <Text style={styles.resteValue}>{euro(order.total)}</Text>
                    </View>
                </View>
            </View>

            <Text style={styles.sectionLabel}>À répartir</Text>
            <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: theme.spacing(2) }}>
                {payable.filter((l) => availOf(l) > 0).map((l) => (
                    <Pressable key={l.id} style={styles.row} onPress={() => assign(l)}>
                        <View style={styles.q}><Text style={styles.qText}>{fmtQty(availOf(l))}×</Text></View>
                        <Text style={styles.rowName} numberOfLines={1}>{l.name_snapshot}</Text>
                        <Text style={styles.rowPrice}>{euro(l.unit_price_snapshot)}</Text>
                    </Pressable>
                ))}
                {payable.every((l) => availOf(l) <= 0) && (
                    <Text style={styles.allIn}>Tout est dans le ticket en cours.</Text>
                )}
            </ScrollView>

            {/* Ticket en cours */}
            <View style={styles.ticket}>
                <View style={styles.ticketHead}>
                    <Text style={styles.person}>Personne {person}</Text>
                    {cartEntries.length > 0 && (
                        <Pressable onPress={() => setAssigned({})}><Text style={styles.clear}>Vider</Text></Pressable>
                    )}
                </View>

                <ScrollView style={styles.ticketLines} contentContainerStyle={{ paddingVertical: theme.spacing(1) }}>
                    {cartEntries.map((x) => (
                        <View key={x.l.id} style={styles.tline}>
                            <Text style={styles.tq}>{fmtQty(x.q)}×</Text>
                            <Text style={styles.tn} numberOfLines={1}>{x.l.name_snapshot}</Text>
                            <Text style={styles.ta}>{euro((x.l.line_total / x.l.qty) * x.q)}</Text>
                            <Pressable onPress={() => unassign(x.l.id)} hitSlop={8} style={styles.rm}>
                                <Minus color={theme.colors.textMuted} size={16} />
                            </Pressable>
                        </View>
                    ))}
                    {!cartEntries.length && <Text style={styles.tEmpty}>Touchez un article à ajouter à ce ticket.</Text>}
                </ScrollView>

                <View style={styles.foot}>
                    <View style={styles.totRow}>
                        <Text style={styles.totLabel}>À payer</Text>
                        <Text style={styles.totValue}>{euro(cartTotal)}</Text>
                    </View>
                    <View style={styles.pays}>
                        <Pressable onPress={() => pay('cash')} disabled={cartTotal <= 0 || processing} style={[styles.pay, styles.payCash, (cartTotal <= 0 || processing) && styles.payDim]}>
                            {processing ? <ActivityIndicator color="#06281b" /> : (<><Banknote color="#06281b" size={20} /><Text style={styles.payCashText}>Espèces</Text></>)}
                        </Pressable>
                        <Pressable onPress={() => pay('card')} disabled={cartTotal <= 0 || processing} style={[styles.pay, styles.payCard, (cartTotal <= 0 || processing) && styles.payDim]}>
                            <CreditCard color={theme.colors.text} size={20} /><Text style={styles.payCardText}>Carte</Text>
                        </Pressable>
                    </View>
                </View>
            </View>

            {flash && <View style={styles.flash} pointerEvents="none"><Text style={styles.flashText}>{flash}</Text></View>}
        </Screen>
    );
}

const styles = StyleSheet.create({
    head: { paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(3), paddingBottom: theme.spacing(3), borderBottomWidth: 1, borderColor: theme.colors.border },
    headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    title: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
    sub: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 },
    reste: { alignItems: 'flex-end' },
    resteLabel: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
    resteValue: { color: theme.colors.text, fontSize: 20, fontWeight: '800', marginTop: 2 },

    sectionLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(3), paddingBottom: theme.spacing(1) },
    list: { flex: 1, paddingHorizontal: theme.spacing(3) },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(3), paddingVertical: theme.spacing(3), paddingHorizontal: theme.spacing(2), borderBottomWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm },
    q: { minWidth: 40, height: 34, paddingHorizontal: theme.spacing(2), borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
    qText: { color: theme.colors.text, fontWeight: '800', fontSize: 14 },
    rowName: { flex: 1, color: theme.colors.text, fontWeight: '700', fontSize: 15 },
    rowPrice: { color: theme.colors.textMuted, fontWeight: '800', fontSize: 14 },
    allIn: { color: theme.colors.textMuted, textAlign: 'center', padding: theme.spacing(6), fontWeight: '600' },

    ticket: { backgroundColor: theme.colors.bgElevated, borderTopWidth: 1, borderColor: theme.colors.border },
    ticketHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(3) },
    person: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
    clear: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '700' },
    ticketLines: { maxHeight: 170, paddingHorizontal: theme.spacing(4) },
    tline: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2.5), paddingVertical: theme.spacing(2), borderBottomWidth: 1, borderColor: theme.colors.border },
    tq: { color: theme.colors.textMuted, fontWeight: '800', fontSize: 13, minWidth: 28 },
    tn: { flex: 1, color: theme.colors.text, fontWeight: '700', fontSize: 14 },
    ta: { color: theme.colors.text, fontWeight: '800', fontSize: 14 },
    rm: { padding: theme.spacing(1) },
    tEmpty: { color: theme.colors.textMuted, textAlign: 'center', paddingVertical: theme.spacing(4), fontWeight: '600' },

    foot: { paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(2.5), paddingBottom: theme.spacing(3) },
    totRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: theme.spacing(3) },
    totLabel: { color: theme.colors.textMuted, fontWeight: '700', fontSize: 15 },
    totValue: { color: theme.colors.text, fontWeight: '800', fontSize: 24 },
    pays: { flexDirection: 'row', gap: theme.spacing(3) },
    pay: { flex: 1, height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing(2), borderRadius: theme.radius.md },
    payCash: { backgroundColor: theme.colors.success },
    payCashText: { color: '#06281b', fontWeight: '800', fontSize: 16 },
    payCard: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
    payCardText: { color: theme.colors.text, fontWeight: '800', fontSize: 16 },
    payDim: { opacity: 0.4 },

    flash: { position: 'absolute', bottom: theme.spacing(6), alignSelf: 'center', backgroundColor: theme.colors.success, borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing(5), paddingVertical: theme.spacing(3) },
    flashText: { color: '#06281b', fontWeight: '800', fontSize: 15 },
});
