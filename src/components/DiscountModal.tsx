import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Percent, Euro, X } from 'lucide-react-native';
import { theme } from '../theme';
import { Keypad } from './Keypad';
import { discountAmountFor, grossTotal } from '../utils/pricing';
import type { OrderLine } from '../types';

/**
 * Remise sur l'addition (jamais ligne par ligne) : en pourcentage ou en montant.
 * Le motif est demandé mais reste facultatif — un serveur bloqué par un champ
 * obligatoire pendant un service saisit n'importe quoi, ce qui ne vaut rien.
 */
interface Props {
    visible: boolean;
    lines: OrderLine[];
    maxPercent: number;
    currentType: 'percent' | 'amount' | null;
    currentValue: number | null;
    currentReason: string | null;
    onClose: () => void;
    onApply: (type: 'percent' | 'amount', value: number, reason: string) => void;
    onRemove: () => void;
}

const QUICK_PERCENTS = [5, 10, 15, 20, 50];

export function DiscountModal({
    visible, lines, maxPercent, currentType, currentValue, currentReason, onClose, onApply, onRemove,
}: Props) {
    const [type, setType] = useState<'percent' | 'amount'>(currentType ?? 'percent');
    const [entry, setEntry] = useState(currentValue ? String(currentValue) : '');
    const [reason, setReason] = useState(currentReason ?? '');

    const gross = useMemo(() => grossTotal(lines), [lines]);
    const value = parseFloat(entry || '0') || 0;
    const amount = discountAmountFor(lines, type, value, maxPercent);
    const capped = value > 0 && amount < (type === 'percent' ? (gross * value) / 100 : value);

    const reset = () => {
        setType(currentType ?? 'percent');
        setEntry(currentValue ? String(currentValue) : '');
        setReason(currentReason ?? '');
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onShow={reset}>
            <View style={styles.backdrop}>
                <View style={styles.sheet}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Remise sur l'addition</Text>
                        <Pressable onPress={onClose} hitSlop={10}><X color={theme.colors.textMuted} size={22} /></Pressable>
                    </View>

                    <ScrollView keyboardShouldPersistTaps="handled">
                        {/* Type de remise */}
                        <View style={styles.tabs}>
                            <Pressable style={[styles.tab, type === 'percent' && styles.tabActive]} onPress={() => { setType('percent'); setEntry(''); }}>
                                <Percent color={type === 'percent' ? theme.colors.onPrimary : theme.colors.text} size={18} />
                                <Text style={[styles.tabText, type === 'percent' && styles.tabTextActive]}>Pourcentage</Text>
                            </Pressable>
                            <Pressable style={[styles.tab, type === 'amount' && styles.tabActive]} onPress={() => { setType('amount'); setEntry(''); }}>
                                <Euro color={type === 'amount' ? theme.colors.onPrimary : theme.colors.text} size={18} />
                                <Text style={[styles.tabText, type === 'amount' && styles.tabTextActive]}>Montant</Text>
                            </Pressable>
                        </View>

                        {type === 'percent' && (
                            <View style={styles.quickRow}>
                                {QUICK_PERCENTS.filter((p) => p <= maxPercent).map((p) => (
                                    <Pressable key={p} style={styles.quick} onPress={() => setEntry(String(p))}>
                                        <Text style={styles.quickText}>{p}%</Text>
                                    </Pressable>
                                ))}
                            </View>
                        )}

                        <View style={styles.entryBox}>
                            <Text style={styles.entry}>{entry || '0'}{type === 'percent' ? ' %' : ' €'}</Text>
                            <Text style={styles.preview}>
                                {amount > 0
                                    ? `− ${amount.toFixed(2)} €   →   ${(gross - amount).toFixed(2)} € à payer`
                                    : `Total actuel : ${gross.toFixed(2)} €`}
                            </Text>
                            {capped && (
                                <Text style={styles.capped}>Plafonné à {maxPercent} % par les réglages.</Text>
                            )}
                        </View>

                        <Keypad
                            onKey={(d) => setEntry((a) => (d === '.' && a.includes('.') ? a : a + d))}
                            onDelete={() => setEntry((a) => a.slice(0, -1))}
                        />

                        <Text style={styles.label}>Motif (facultatif)</Text>
                        <TextInput
                            value={reason}
                            onChangeText={setReason}
                            placeholder="Geste commercial, erreur cuisine…"
                            placeholderTextColor={theme.colors.textFaint}
                            style={styles.input}
                            maxLength={120}
                        />

                        <View style={styles.actions}>
                            {currentType && (
                                <Pressable style={[styles.action, styles.actionGhost]} onPress={() => { onRemove(); onClose(); }}>
                                    <Text style={styles.actionGhostText}>Retirer la remise</Text>
                                </Pressable>
                            )}
                            <Pressable
                                style={[styles.action, styles.actionPrimary, amount <= 0 && styles.actionDisabled]}
                                disabled={amount <= 0}
                                onPress={() => { onApply(type, value, reason); onClose(); }}
                            >
                                <Text style={styles.actionPrimaryText}>Appliquer</Text>
                            </Pressable>
                        </View>
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: {
        backgroundColor: theme.colors.bg, borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg,
        padding: theme.spacing(4), maxHeight: '92%',
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing(4) },
    title: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
    tabs: { flexDirection: 'row', gap: theme.spacing(2.5), marginBottom: theme.spacing(3.5) },
    tab: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing(2),
        height: 52, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface,
        borderWidth: 1, borderColor: theme.colors.border,
    },
    tabActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    tabText: { color: theme.colors.text, fontWeight: '700' },
    tabTextActive: { color: theme.colors.onPrimary },
    quickRow: { flexDirection: 'row', gap: theme.spacing(2), marginBottom: theme.spacing(3) },
    quick: {
        flex: 1, height: 44, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center',
        backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border,
    },
    quickText: { color: theme.colors.text, fontWeight: '800' },
    entryBox: {
        backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1,
        borderColor: theme.colors.border, paddingVertical: theme.spacing(4), alignItems: 'center',
        marginBottom: theme.spacing(3), gap: theme.spacing(1.5),
    },
    entry: { color: theme.colors.text, fontSize: 34, fontWeight: '800' },
    preview: { color: theme.colors.textMuted, fontSize: 14 },
    capped: { color: theme.colors.warning, fontSize: 13, fontWeight: '700' },
    label: { color: theme.colors.textMuted, fontSize: 13, marginTop: theme.spacing(3), marginBottom: theme.spacing(1.5) },
    input: {
        backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1,
        borderColor: theme.colors.border, color: theme.colors.text, paddingHorizontal: theme.spacing(3.5),
        height: 50, fontSize: 15,
    },
    actions: { flexDirection: 'row', gap: theme.spacing(2.5), marginTop: theme.spacing(4), marginBottom: theme.spacing(2) },
    action: { flex: 1, height: 54, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
    actionPrimary: { backgroundColor: theme.colors.primary },
    actionPrimaryText: { color: theme.colors.onPrimary, fontWeight: '800', fontSize: 16 },
    actionGhost: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
    actionGhostText: { color: theme.colors.danger, fontWeight: '700' },
    actionDisabled: { opacity: 0.4 },
});
