import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from './Button';
import { theme } from '../theme';
import { useConfig } from '../store/useConfig';
import type { OptionItem, Product, SelectedOption } from '../types';

/**
 * Modale de sélection des modificateurs d'un produit (cuisson, sauce, suppléments).
 * Respecte min/max/required de chaque groupe. Renvoie les options + qté + note.
 */
export function OptionsModal({
    product,
    visible,
    onClose,
    onConfirm,
}: {
    product: Product | null;
    visible: boolean;
    onClose: () => void;
    onConfirm: (options: SelectedOption[], qty: number, note: string | null) => void;
}) {
    const optionGroup = useConfig((s) => s.optionGroup);
    const [selected, setSelected] = useState<Record<number, number[]>>({});
    const [qty, setQty] = useState(1);
    const [note, setNote] = useState('');

    const groups = useMemo(
        () => (product?.option_group_ids ?? []).map((id) => optionGroup(id)).filter(Boolean),
        [product, optionGroup],
    );

    // Réinitialise à l'ouverture d'un produit.
    React.useEffect(() => {
        setSelected({});
        setQty(1);
        setNote('');
    }, [product?.id]);

    const toggle = (groupId: number, optionId: number, maxSelect: number) => {
        setSelected((prev) => {
            const current = prev[groupId] ?? [];
            if (current.includes(optionId)) {
                return { ...prev, [groupId]: current.filter((id) => id !== optionId) };
            }
            if (maxSelect === 1) return { ...prev, [groupId]: [optionId] };
            if (current.length >= maxSelect) return prev;
            return { ...prev, [groupId]: [...current, optionId] };
        });
    };

    const valid = groups.every((g) => !g!.required || (selected[g!.id]?.length ?? 0) >= g!.min_select);

    const confirm = () => {
        const flat: SelectedOption[] = [];
        for (const g of groups) {
            for (const optId of selected[g!.id] ?? []) {
                const opt = g!.options.find((o: OptionItem) => o.id === optId);
                if (opt) flat.push({ option_id: opt.id, name: opt.name, price_delta: opt.price_delta });
            }
        }
        onConfirm(flat, qty, note.trim() || null);
    };

    if (!product) return null;

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.sheet}>
                    <Text style={styles.title}>{product.name}</Text>
                    <ScrollView style={{ maxHeight: 360 }}>
                        {groups.map((g) => (
                            <View key={g!.id} style={styles.group}>
                                <Text style={styles.groupTitle}>
                                    {g!.name}
                                    {g!.required ? ' *' : ''}
                                    <Text style={styles.groupHint}> ({g!.min_select}–{g!.max_select})</Text>
                                </Text>
                                <View style={styles.options}>
                                    {g!.options.map((o: OptionItem) => {
                                        const on = (selected[g!.id] ?? []).includes(o.id);
                                        return (
                                            <Pressable key={o.id} onPress={() => toggle(g!.id, o.id, g!.max_select)} style={[styles.chip, on && styles.chipOn]}>
                                                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                                    {o.name}{o.price_delta ? ` +${o.price_delta.toFixed(2)}€` : ''}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            </View>
                        ))}

                        <Text style={styles.groupTitle}>Note</Text>
                        <TextInput value={note} onChangeText={setNote} placeholder="ex. sans oignon" placeholderTextColor={theme.colors.textMuted} style={styles.note} />
                    </ScrollView>

                    <View style={styles.qtyRow}>
                        <Text style={styles.qtyLabel}>Quantité</Text>
                        <View style={styles.qtyControls}>
                            <Pressable style={styles.qtyBtn} onPress={() => setQty((q) => Math.max(1, q - 1))}><Text style={styles.qtyBtnText}>−</Text></Pressable>
                            <Text style={styles.qtyValue}>{qty}</Text>
                            <Pressable style={styles.qtyBtn} onPress={() => setQty((q) => q + 1)}><Text style={styles.qtyBtnText}>+</Text></Pressable>
                        </View>
                    </View>

                    <View style={styles.actions}>
                        <Button label="Annuler" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
                        <Button label="Ajouter" onPress={confirm} disabled={!valid} style={{ flex: 1 }} />
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.colors.bgElevated, borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg, padding: theme.spacing(5), borderTopWidth: 1, borderColor: theme.colors.border },
    title: { color: theme.colors.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginBottom: theme.spacing(4) },
    group: { marginBottom: theme.spacing(4) },
    groupTitle: { color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(2.5) },
    groupHint: { color: theme.colors.textMuted, fontWeight: '400', fontSize: 12 },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(2.5) },
    chip: { paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2.5), borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
    chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    chipText: { color: theme.colors.textMuted, fontWeight: '600' },
    chipTextOn: { color: theme.colors.onPrimary, fontWeight: '700' },
    note: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, color: theme.colors.text, paddingHorizontal: theme.spacing(3), height: 50, marginTop: theme.spacing(1), borderWidth: 1, borderColor: theme.colors.border },
    qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: theme.spacing(4) },
    qtyLabel: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    qtyControls: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(4) },
    qtyBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    qtyBtnText: { color: theme.colors.text, fontSize: 24, fontWeight: '800' },
    qtyValue: { color: theme.colors.text, fontSize: 20, fontWeight: '800', minWidth: 28, textAlign: 'center' },
    actions: { flexDirection: 'row', gap: theme.spacing(3) },
});
