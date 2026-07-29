import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banknote, CreditCard, Users, X, BadgePercent } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Keypad } from '../components/Keypad';
import { DiscountModal } from '../components/DiscountModal';
import { theme } from '../theme';
import { useCart } from '../store/useCart';
import { useAuth } from '../store/useAuth';
import { useConfig } from '../store/useConfig';
import { canDiscount, discountMaxPercent } from '../utils/permissions';
import { printCustomerReceipt } from '../services/printing';
import { flushOutbox } from '../services/sync';
import type { PaymentMethod } from '../types';
import type { RootStackParamList } from '../navigation/types';

const round2 = (x: number) => Math.round(x * 100) / 100;
const round05 = (x: number) => Math.round(x * 20) / 20; // arrondi cash belge (5 cts)

/** Paiement : choisir Cash/Carte, saisir le montant (défaut = reste), lignes supprimables. */
export function PaymentScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Payment'>) {
    const order = useCart((s) => s.order);
    const addPayment = useCart((s) => s.addPayment);
    const removePayment = useCart((s) => s.removePayment);
    const markPaid = useCart((s) => s.markPaid);
    const remaining = useCart((s) => s.remaining);
    const clear = useCart((s) => s.clear);
    const setDiscount = useCart((s) => s.setDiscount);
    const clearDiscount = useCart((s) => s.clearDiscount);
    const settings = useConfig((s) => s.settings);
    const server = useAuth((s) => s.server);
    const [entry, setEntry] = useState('');
    const [invoice, setInvoice] = useState(false);
    const [change, setChange] = useState(0);
    const [validating, setValidating] = useState(false);
    const [discountOpen, setDiscountOpen] = useState(false);

    const mayDiscount = canDiscount(server, settings);
    const maxPercent = discountMaxPercent(settings);

    if (!order) {
        navigation.goBack();
        return null;
    }

    const left = remaining();

    const pay = (method: PaymentMethod) => {
        const rem = remaining();
        if (rem <= 0.001) return;

        if (method === 'cash') {
            const due = round05(rem); // le cash est arrondi aux 5 centimes
            const tendered = parseFloat(entry || '') || due;
            if (tendered <= 0) return;
            const settles = tendered >= due;
            addPayment('cash', round2(settles ? due : tendered));
            setChange(settles && tendered > due ? round2(tendered - due) : 0);
        } else {
            const tendered = parseFloat(entry || '') || rem;
            if (tendered <= 0) return;
            addPayment('card', round2(Math.min(tendered, rem))); // carte : jamais plus que le dû
            setChange(0);
        }
        setEntry('');
    };

    const deletePayment = (i: number) => {
        removePayment(i);
        setChange(0);
    };

    const validate = async () => {
        if (remaining() > 0.03) {
            Alert.alert('Paiement incomplet', `Reste ${remaining().toFixed(2)} € à régler.`);
            return;
        }
        setValidating(true);
        await markPaid();
        const current = useCart.getState().order!;
        // Vente comptoir = sans salle ni table (walk-in).
        const wasCounter = current.room_id === null && current.table_id === null;
        const printed = await printCustomerReceipt(current, invoice).catch(() => false);
        await flushOutbox();
        setValidating(false);

        // Paiement enregistré quoi qu'il arrive ; si le ticket n'est pas sorti, on
        // propose de réimprimer avant de quitter.
        if (!printed) {
            await new Promise<void>((resolve) => {
                Alert.alert('Ticket non imprimé', "L'imprimante caisse n'a pas répondu. Le paiement est bien enregistré.", [
                    { text: 'Réimprimer', onPress: async () => { await printCustomerReceipt(current, invoice).catch(() => false); resolve(); } },
                    { text: 'Continuer sans', style: 'cancel', onPress: () => resolve() },
                ]);
            });
        }

        clear();

        // Comptoir (pay & go) : on rouvre directement une nouvelle vente comptoir,
        // avec la Salle en dessous (retour arrière possible). Une vraie table revient
        // à la Salle comme avant.
        const auth = useAuth.getState();
        if (wasCounter && auth.session && auth.server) {
            useCart.getState().startNew({
                sessionId: auth.session.id,
                serverId: auth.server.id,
                roomId: null,
                tableId: null,
                serviceType: current.service_type,
            });
            navigation.reset({ index: 1, routes: [{ name: 'Rooms' }, { name: 'Pos' }] });
        } else {
            navigation.reset({ index: 0, routes: [{ name: 'Rooms' }] });
        }
    };

    const settled = left <= 0.03;

    return (
        <Screen style={{ padding: 0 }} edges={['bottom']}>
            <ScrollView contentContainerStyle={styles.scroll}>
                {/* Résumé */}
                <View style={styles.summary}>
                    <Text style={styles.summaryLabel}>Total</Text>
                    <Text style={styles.summaryTotal}>{order.total.toFixed(2)} €</Text>
                    {/* Remise en cours : montant déduit + motif, visibles avant de valider. */}
                    {(order.discount_amount ?? 0) > 0 && (
                        <View style={styles.discountBanner}>
                            <Text style={styles.discountBannerText}>
                                Remise {order.discount_type === 'percent' ? `${order.discount_value} %` : 'montant'}
                                {'  '}− {(order.discount_amount ?? 0).toFixed(2)} €
                            </Text>
                            {!!order.discount_reason && (
                                <Text style={styles.discountReason} numberOfLines={1}>{order.discount_reason}</Text>
                            )}
                        </View>
                    )}
                    <Text style={[styles.remaining, settled && { color: theme.colors.success }]}>
                        {settled ? 'Soldé' : `Reste ${left.toFixed(2)} €`}
                    </Text>
                    {change > 0 && (
                        <View style={styles.changeBox}><Text style={styles.changeText}>Rendu monnaie : {change.toFixed(2)} €</Text></View>
                    )}
                </View>

                {/* Lignes de paiement (supprimables) */}
                {order.payments.map((p, i) => (
                    <View key={i} style={styles.payRow}>
                        <Text style={styles.payMethod}>{p.method === 'cash' ? 'Espèces' : 'Carte'}</Text>
                        <Text style={styles.payAmount}>{p.amount.toFixed(2)} €</Text>
                        <Pressable onPress={() => deletePayment(i)} style={styles.payDelete} hitSlop={8}>
                            <X color={theme.colors.danger} size={18} />
                        </Pressable>
                    </View>
                ))}

                {/* Montant en saisie (défaut = ce qui reste) */}
                <View style={styles.entryBox}>
                    <Text style={styles.entry}>{entry || left.toFixed(2)} €</Text>
                </View>
                <Keypad onKey={(d) => setEntry((a) => (d === '.' && a.includes('.') ? a : a + d))} onDelete={() => setEntry((a) => a.slice(0, -1))} />

                {/* Modes de paiement */}
                <View style={styles.methods}>
                    <Pressable style={[styles.method, settled && styles.methodDim]} onPress={() => pay('cash')}>
                        <Banknote color={theme.colors.text} size={22} />
                        <Text style={styles.methodText}>Espèces</Text>
                    </Pressable>
                    <Pressable style={[styles.method, settled && styles.methodDim]} onPress={() => pay('card')}>
                        <CreditCard color={theme.colors.text} size={22} />
                        <Text style={styles.methodText}>Carte</Text>
                    </Pressable>
                </View>

                <View style={styles.invoiceRow}>
                    <Text style={styles.invoiceLabel}>Facture détaillée (ventilation TVA)</Text>
                    <Switch value={invoice} onValueChange={setInvoice} />
                </View>
            </ScrollView>

            <View style={styles.footer}>
                {/* La remise n'est modifiable qu'avant tout encaissement. */}
                {mayDiscount && order.payments.length === 0 && (
                    <Pressable onPress={() => setDiscountOpen(true)} style={styles.splitBtn}>
                        <BadgePercent color={theme.colors.text} size={18} />
                        <Text style={styles.splitText}>
                            {(order.discount_amount ?? 0) > 0 ? 'Modifier la remise' : 'Appliquer une remise'}
                        </Text>
                    </Pressable>
                )}
                {order.payments.length === 0 && order.lines.some((l) => !l.voided && l.qty > 0) && (
                    <Pressable onPress={() => navigation.navigate('Split')} style={styles.splitBtn}>
                        <Users color={theme.colors.text} size={18} />
                        <Text style={styles.splitText}>Partager l'addition</Text>
                    </Pressable>
                )}
                <Button label="Valider le paiement" variant="success" onPress={validate} loading={validating} disabled={!settled} />
            </View>

            <DiscountModal
                visible={discountOpen}
                lines={order.lines}
                maxPercent={maxPercent}
                currentType={order.discount_type ?? null}
                currentValue={order.discount_value ?? null}
                currentReason={order.discount_reason ?? null}
                onClose={() => setDiscountOpen(false)}
                onApply={(type, value, reason) => server && setDiscount(type, value, reason, server.id)}
                onRemove={clearDiscount}
            />
        </Screen>
    );
}

const styles = StyleSheet.create({
    scroll: { padding: theme.spacing(4) },
    summary: { alignItems: 'center', marginBottom: theme.spacing(4) },
    summaryLabel: { color: theme.colors.textMuted },
    summaryTotal: { color: theme.colors.text, fontSize: 42, fontWeight: '800', letterSpacing: -1 },
    remaining: { color: theme.colors.warning, fontWeight: '700', marginTop: theme.spacing(1) },
    discountBanner: {
        marginTop: theme.spacing(2), backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm,
        borderWidth: 1, borderColor: theme.colors.border,
        paddingHorizontal: theme.spacing(3.5), paddingVertical: theme.spacing(2), alignItems: 'center',
    },
    discountBannerText: { color: theme.colors.text, fontWeight: '800', fontSize: 14 },
    discountReason: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
    changeBox: { marginTop: theme.spacing(3), backgroundColor: theme.colors.warning, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2.5) },
    changeText: { color: '#1a1205', fontWeight: '800', fontSize: 16 },
    payRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: theme.spacing(2.5), paddingHorizontal: theme.spacing(3.5), marginBottom: theme.spacing(2), gap: theme.spacing(3) },
    payMethod: { color: theme.colors.textMuted, flex: 1, fontWeight: '600' },
    payAmount: { color: theme.colors.text, fontWeight: '800', fontSize: 16 },
    payDelete: { padding: theme.spacing(1) },
    entryBox: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: theme.spacing(5), alignItems: 'center', marginTop: theme.spacing(2), marginBottom: theme.spacing(4) },
    entry: { color: theme.colors.text, fontSize: 32, fontWeight: '800' },
    methods: { flexDirection: 'row', gap: theme.spacing(3), marginTop: theme.spacing(2) },
    method: { flex: 1, flexDirection: 'row', gap: theme.spacing(2), alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, height: 62, borderWidth: 1, borderColor: theme.colors.border },
    methodDim: { opacity: 0.5 },
    methodText: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
    invoiceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.spacing(5) },
    invoiceLabel: { color: theme.colors.text, fontSize: 14 },
    footer: { padding: theme.spacing(4), borderTopWidth: 1, borderColor: theme.colors.border },
    splitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing(2), height: 50, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, marginBottom: theme.spacing(3) },
    splitText: { color: theme.colors.text, fontWeight: '700', fontSize: 15 },
});

