import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Delete, Send, CreditCard, Sliders, MessageSquare } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { LineActionsSheet } from '../components/LineActionsSheet';
import { LineNoteModal } from '../components/LineNoteModal';
import { theme } from '../theme';
import { useCart } from '../store/useCart';
import { useT } from '../i18n';
import { printKitchen } from '../services/printing';
import { flushOutbox } from '../services/sync';
import type { RootStackParamList } from '../navigation/types';

type Mode = 'qty' | 'price';

/** Panier facon Odoo : lignes selectionnables + pave numerique (Qty / Price). */
export function CartScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Cart'>) {
    const order = useCart((s) => s.order);
    const setLineQty = useCart((s) => s.setLineQty);
    const setLinePrice = useCart((s) => s.setLinePrice);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [mode, setMode] = useState<Mode>('qty');
    const [typing, setTyping] = useState(false);
    const [buffer, setBuffer] = useState('');
    const [sending, setSending] = useState(false);
    // Menu d'actions sur la ligne sélectionnée, et saisie de la note.
    const [actionsOpen, setActionsOpen] = useState(false);
    const [noteOpen, setNoteOpen] = useState(false);
    const t = useT();

    const lines = order ? order.lines.filter((l) => !l.voided && l.qty > 0) : [];

    // Sélection valide : sinon la 1re ligne.
    useEffect(() => {
        if (!lines.length) { if (selectedId) setSelectedId(null); return; }
        if (!selectedId || !lines.some((l) => l.id === selectedId)) {
            setSelectedId(lines[lines.length - 1].id);
        }
    }, [lines, selectedId]);

    if (!order) {
        navigation.goBack();
        return null;
    }

    const selected = lines.find((l) => l.id === selectedId) ?? null;
    const fmt = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));

    const pendingNew = order.lines.reduce((s, l) => s + Math.max(0, l.qty - l.sent_qty), 0);
    const pendingCancel = order.lines.reduce((s, l) => s + Math.max(0, l.sent_qty - l.qty), 0);
    const canSend = pendingNew > 0 || pendingCancel > 0;

    const selectLine = (id: string) => { setSelectedId(id); setTyping(false); setBuffer(''); };
    const selectMode = (m: Mode) => { setMode(m); setTyping(false); setBuffer(''); };

    const apply = (value: number) => {
        if (!selected) return;
        if (mode === 'qty') setLineQty(selected.id, value);
        else setLinePrice(selected.id, value);
    };

    const current = selected ? (mode === 'qty' ? selected.qty : selected.unit_price_snapshot) : 0;

    const onKey = (k: string) => {
        if (!selected) return;
        // Buffer PERSISTANT (sinon "3 . 5" -> "35" car la valeur affichée perd le point).
        let buf = typing ? buffer : '';
        if (k === 'back') {
            buf = buf.slice(0, -1);
        } else if (k === '.') {
            if (buf === '') buf = '0.';
            else if (!buf.includes('.')) buf += '.';
        } else if (k === '+/-') {
            buf = String(-(parseFloat(buf || String(current)) || 0));
        } else {
            buf += k;
        }
        setBuffer(buf);
        setTyping(true);
        apply(parseFloat(buf) || 0);
    };

    const send = async () => {
        setSending(true);
        const { newLines, cancelLines } = useCart.getState().sendToKitchen();
        await flushOutbox(); // envoi autoritaire : le serveur est à jour avant tout
        const cur = useCart.getState().order;
        const ok = cur ? await printKitchen(cur, newLines, cancelLines) : true;
        setSending(false);
        const s = newLines.reduce((a, l) => a + l.qty, 0);
        const c = cancelLines.reduce((a, l) => a + l.qty, 0);
        const summary = `${s} envoyé(s)${c ? `, ${c} annulé(s)` : ''}.`;
        if (ok) {
            Alert.alert('Cuisine', summary);
        } else {
            Alert.alert('Impression cuisine échouée', `${summary}\n\nUne imprimante n'a pas répondu (envoi bien enregistré).`, [
                { text: 'OK', style: 'cancel' },
                {
                    text: 'Réimprimer',
                    onPress: async () => {
                        const r = cur ? await printKitchen(cur, newLines, cancelLines) : true;
                        if (!r) Alert.alert('Toujours injoignable', "Vérifiez l'imprimante (allumée, réseau, câble).");
                    },
                },
            ]);
        }
    };

    const openActions = () => {
        if (!selected) return;
        setActionsOpen(true);
    };

    const openNote = () => {
        if (!selected) return;
        setNoteOpen(true);
    };

    const KEYS: { k: string; label?: string; mode?: Mode; back?: boolean }[][] = [
        [{ k: '1' }, { k: '2' }, { k: '3' }, { k: 'qty', mode: 'qty', label: 'Qté' }],
        [{ k: '4' }, { k: '5' }, { k: '6' }, { k: 'price', mode: 'price', label: 'Prix' }],
        [{ k: '7' }, { k: '8' }, { k: '9' }, { k: 'back', back: true }],
        [{ k: '+/-' }, { k: '0' }, { k: '.' }, { k: 'spacer' }],
    ];

    return (
        <Screen style={{ padding: 0 }} edges={['bottom']}>
            {/* Lignes */}
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {lines.map((l) => {
                    const isSel = l.id === selectedId;
                    return (
                        <Pressable key={l.id} onPress={() => selectLine(l.id)} style={[styles.line, isSel && styles.lineSelected]}>
                            <View style={[styles.accent, isSel && styles.accentOn]} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.lineName}>{l.name_snapshot}</Text>
                                <Text style={styles.lineMeta}>{fmt(l.qty)} × {l.unit_price_snapshot.toFixed(2)} €{l.sent_qty > 0 ? '  • envoyé' : ''}</Text>
                                {l.options_snapshot.map((o) => (
                                    <Text key={o.option_id} style={styles.lineOpt}>+ {o.name}</Text>
                                ))}
                                {/* Note : sous le produit, comme sur le ticket. */}
                                {!!l.note && (
                                    <View style={styles.noteRow}>
                                        <MessageSquare color={theme.colors.warning} size={12} />
                                        <Text style={styles.lineNote}>{l.note}</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={styles.lineTotal}>{l.line_total.toFixed(2)} €</Text>
                        </Pressable>
                    );
                })}
                {!lines.length && <Text style={styles.empty}>Panier vide.</Text>}
            </ScrollView>

            {/* Totaux */}
            <View style={styles.totals}>
                <View style={styles.totalRow}><Text style={styles.taxLabel}>Taxes</Text><Text style={styles.taxValue}>{order.tax_total.toFixed(2)} €</Text></View>
                <View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>{order.total.toFixed(2)} €</Text></View>
            </View>

            {/* Pavé numérique */}
            <View style={styles.pad}>
                {KEYS.map((row, ri) => (
                    <View key={ri} style={styles.padRow}>
                        {row.map((cell) => {
                            if (cell.k === 'spacer') return <View key="sp" style={styles.padCell} />;
                            if (cell.mode) {
                                const active = mode === cell.mode;
                                return (
                                    <Pressable key={cell.k} onPress={() => selectMode(cell.mode!)} style={[styles.padCell, styles.modeCell, active && styles.modeCellOn]}>
                                        <Text style={[styles.modeText, active && styles.modeTextOn]}>{cell.label}</Text>
                                    </Pressable>
                                );
                            }
                            if (cell.back) {
                                return (
                                    <Pressable key="back" onPress={() => onKey('back')} style={[styles.padCell, styles.backCell]}>
                                        <Delete color={theme.colors.danger} size={24} />
                                    </Pressable>
                                );
                            }
                            return (
                                <Pressable key={cell.k} onPress={() => onKey(cell.k)} style={({ pressed }) => [styles.padCell, styles.digitCell, pressed && styles.padPressed]}>
                                    <Text style={styles.digitText}>{cell.k}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                ))}
            </View>

            {/* Note / Actions. La note est là en accès direct : c'est le geste le
                plus fréquent sur une ligne, il ne mérite pas un détour par un menu. */}
            <View style={styles.secondaryRow}>
                <Pressable
                    style={[styles.secondaryBtn, !selected && styles.secondaryDim, !!selected?.note && styles.secondaryOn]}
                    onPress={openNote}
                    disabled={!selected}
                >
                    <MessageSquare color={selected?.note ? theme.colors.warning : theme.colors.text} size={18} />
                    <Text style={[styles.secondaryText, !!selected?.note && styles.secondaryTextOn]}>{t('Note')}</Text>
                </Pressable>
                <Pressable style={[styles.secondaryBtn, !selected && styles.secondaryDim]} onPress={openActions} disabled={!selected}>
                    <Sliders color={theme.colors.text} size={18} />
                    <Text style={styles.secondaryText}>Actions</Text>
                </Pressable>
            </View>

            {/* Bas : Order + Payment */}
            <View style={styles.bottomBar}>
                <Pressable onPress={send} disabled={!canSend || sending} style={[styles.orderBtn, (!canSend || sending) && styles.disabled]}>
                    <Send color="#fff" size={18} />
                    <Text style={styles.bottomText}>Order</Text>
                    {pendingNew > 0 && <View style={styles.badgeNew}><Text style={styles.badgeText}>+{fmt(pendingNew)}</Text></View>}
                    {pendingCancel > 0 && <View style={styles.badgeCancel}><Text style={styles.badgeText}>−{fmt(pendingCancel)}</Text></View>}
                </Pressable>
                <Pressable onPress={() => navigation.navigate('Payment')} disabled={!lines.length} style={[styles.payBtn, !lines.length && styles.disabled]}>
                    <CreditCard color="#fff" size={18} />
                    <Text style={styles.bottomText}>Payment</Text>
                </Pressable>
            </View>

            <LineActionsSheet visible={actionsOpen} line={selected} onClose={() => setActionsOpen(false)} />
            <LineNoteModal visible={noteOpen} line={selected} onClose={() => setNoteOpen(false)} />
        </Screen>
    );
}

const styles = StyleSheet.create({
    list: { flex: 1 },
    listContent: { padding: theme.spacing(3), gap: theme.spacing(2.5) },
    line: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing(3.5), gap: theme.spacing(3), borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
    lineSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.surfaceAlt },
    accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: 'transparent' },
    accentOn: { backgroundColor: theme.colors.success },
    lineName: { color: theme.colors.text, fontWeight: '700', fontSize: 15 },
    lineMeta: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
    lineOpt: { color: theme.colors.textFaint, fontSize: 12 },
    noteRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1.5), marginTop: 3 },
    lineNote: { color: theme.colors.warning, fontSize: 12, fontStyle: 'italic', flex: 1 },
    lineTotal: { color: theme.colors.text, fontWeight: '800', fontSize: 16 },
    empty: { color: theme.colors.textMuted, textAlign: 'center', marginTop: theme.spacing(8) },

    totals: { paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3), borderTopWidth: 1, borderColor: theme.colors.border },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
    taxLabel: { color: theme.colors.textMuted, fontSize: 14 },
    taxValue: { color: theme.colors.textMuted, fontSize: 14 },
    totalLabel: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
    totalValue: { color: theme.colors.text, fontSize: 24, fontWeight: '800' },

    pad: { paddingHorizontal: theme.spacing(3), gap: theme.spacing(2), paddingTop: theme.spacing(2) },
    padRow: { flexDirection: 'row', gap: theme.spacing(2) },
    padCell: { flex: 1, height: 52, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center' },
    digitCell: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
    padPressed: { backgroundColor: theme.colors.surfaceAlt },
    digitText: { color: theme.colors.text, fontSize: 24, fontWeight: '700' },
    modeCell: { backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
    modeCellOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    modeText: { color: theme.colors.textMuted, fontSize: 15, fontWeight: '700' },
    modeTextOn: { color: theme.colors.onPrimary },
    backCell: { backgroundColor: theme.colors.dangerSoft, borderWidth: 1, borderColor: theme.colors.danger },

    secondaryRow: { flexDirection: 'row', gap: theme.spacing(2), paddingHorizontal: theme.spacing(3), paddingTop: theme.spacing(2) },
    secondaryBtn: { flex: 1, height: 46, flexDirection: 'row', gap: theme.spacing(2), alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border },
    secondaryText: { color: theme.colors.text, fontWeight: '600' },
    secondaryDim: { opacity: 0.45 },
    // Ligne porteuse d'une note : le bouton le signale sans qu'on l'ouvre.
    secondaryOn: { borderColor: theme.colors.warning },
    secondaryTextOn: { color: theme.colors.warning },

    bottomBar: { flexDirection: 'row', gap: theme.spacing(3), padding: theme.spacing(3) },
    orderBtn: { flex: 1, height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing(2), backgroundColor: theme.colors.warning, borderRadius: theme.radius.md },
    payBtn: { flex: 1, height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing(2), backgroundColor: theme.colors.success, borderRadius: theme.radius.md },
    disabled: { backgroundColor: theme.colors.surfaceAlt, opacity: 0.6 },
    bottomText: { color: '#fff', fontSize: 17, fontWeight: '800' },
    badgeNew: { backgroundColor: 'rgba(255,255,255,0.30)', minWidth: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
    badgeCancel: { backgroundColor: theme.colors.danger, minWidth: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
    badgeText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
