import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
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
    const { height: hauteurEcran } = useWindowDimensions();
    const optionGroup = useConfig((s) => s.optionGroup);
    const [selected, setSelected] = useState<Record<number, number[]>>({});
    const [qty, setQty] = useState(1);
    const [note, setNote] = useState('');

    const groups = useMemo(
        () => (product?.option_group_ids ?? []).map((id) => optionGroup(id)).filter(Boolean),
        [product, optionGroup],
    );

    /*
     * Les groupes passent par une référence, et NON par les dépendances : une
     * synchronisation du catalogue en pleine prise de commande recalculerait
     * `groups`, relancerait l'effet et effacerait les choix déjà faits. Seul le
     * changement de produit doit réinitialiser.
     */
    const groupesRef = React.useRef(groups);
    groupesRef.current = groups;

    /*
     * « Vide » n'est pas le bon point de départ : les garnitures qui accompagnent
     * le plat d'office arrivent COCHÉES, le serveur retire ce dont le client ne
     * veut pas plutôt que de ressaisir ce qui va de soi.
     *
     * `max_select` reste la loi : un groupe déclarant plus de valeurs par défaut
     * qu'il n'autorise de choix garde les premières, sinon la modale s'ouvrirait
     * sur un état que `toggle` refuserait de reproduire.
     */
    React.useEffect(() => {
        const defauts: Record<number, number[]> = {};
        for (const g of groupesRef.current) {
            const coches = g!.options.filter((o: OptionItem) => o.default_selected).map((o: OptionItem) => o.id);
            if (coches.length) defauts[g!.id] = coches.slice(0, g!.max_select);
        }
        setSelected(defauts);
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
            const retenues = selected[g!.id] ?? [];

            /*
             * Options OFFERTES au-delà du quota facturé.
             *
             * On facture les plus CHÈRES, pas les premières cochées : sinon
             * l'ordre des appuis fixerait le prix, et un serveur pressé ferait
             * perdre de l'argent sans jamais s'en apercevoir.
             *
             * La gratuité est FIGÉE ICI, sur la ligne, à 0,00 €. Tout ce qui
             * suit — ticket, addition, TVA, rapport de caisse — reste juste sans
             * qu'aucun calcul de prix n'ait à connaître cette règle.
             */
            const quota = g!.paid_max;
            const offertes = new Set<number>();

            if (quota != null && retenues.length > quota) {
                const parPrix = retenues
                    .map((id) => g!.options.find((o: OptionItem) => o.id === id))
                    .filter((o): o is OptionItem => !!o)
                    .sort((a, b) => b.price_delta - a.price_delta);

                for (const o of parPrix.slice(quota)) offertes.add(o.id);
            }

            for (const optId of retenues) {
                const opt = g!.options.find((o: OptionItem) => o.id === optId);
                if (!opt) continue;

                /*
                 * Une garniture d'office CONSERVÉE et gratuite ne dit rien : elle
                 * est la norme. On ne l'inscrit pas sur la ligne, sinon chaque
                 * burger répète « Salade : tomate, sla, ajuin, komkommer » et le
                 * seul mot qui compte — un retrait — s'y noie.
                 *
                 * Sauf si elle porte un supplément : là c'est de l'argent, et ça
                 * doit figurer sur la ligne comme sur l'addition.
                 */
                if (opt.default_selected && opt.price_delta === 0) continue;

                flat.push({
                    option_id: opt.id,
                    name: opt.name,
                    price_delta: offertes.has(opt.id) ? 0 : opt.price_delta,
                    group: g!.name,
                });
            }

            /*
             * Ce que le client REFUSE parmi ce qui vient d'office.
             *
             * Sans ça, la cuisine lit « Salade : tomate, sla, ajuin, komkommer »
             * sur chaque burger — quatre mots identiques à chaque ligne, dans
             * lesquels un vrai « sans oignon » se noie. On envoie donc l'écart,
             * pas la norme : c'est la seule information qui change le travail.
             */
            for (const opt of g!.options) {
                if (opt.default_selected && ! retenues.includes(opt.id)) {
                    flat.push({ option_id: opt.id, name: opt.name, price_delta: 0, group: g!.name, excluded: true });
                }
            }
        }
        onConfirm(flat, qty, note.trim() || null);
    };

    if (!product) return null;

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            {/* Appui hors de la feuille = abandon, comme le bouton Annuler. C'est
                le réflexe de tout le monde, et le même motif que les autres
                modales de l'application. Le `stopPropagation` intérieur évite
                qu'un appui sur une option referme la feuille. */}
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
                    <Text style={styles.title}>{product.name}</Text>
                    {/* Hauteur relative à l'écran : 360 px figés débordaient sur un
                        petit iPhone une fois le titre, la quantité et les boutons ajoutés,
                        et gaspillaient la place sur un grand. */}
                    <ScrollView style={{ maxHeight: hauteurEcran * 0.46 }}>
                        {groups.map((g) => (
                            <View key={g!.id} style={styles.group}>
                                <Text style={styles.groupTitle}>
                                    {g!.name}
                                    {g!.required ? ' *' : ''}
                                    {/* Sur un groupe pré-coché, « (0–4) » n'apprend rien et se lit
                                        même à l'envers. La consigne utile est le geste attendu. */}
                                    <Text style={styles.groupHint}>
                                        {g!.options.some((o: OptionItem) => o.default_selected)
                                            ? ' — décochez ce qui est retiré'
                                            : ` (${g!.min_select}–${g!.max_select})`}
                                    </Text>
                                    {/* Sans cette mention, le serveur ne sait pas que la
                                        seconde sauce est offerte et hésite à la proposer. */}
                                    {g!.paid_max != null && g!.paid_max < g!.max_select && (
                                        <Text style={styles.groupOffert}>
                                            {'  '}{g!.max_select - g!.paid_max} offerte{g!.max_select - g!.paid_max > 1 ? 's' : ''}
                                        </Text>
                                    )}
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
                </Pressable>
            </Pressable>
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
    groupOffert: { color: theme.colors.success, fontWeight: '700', fontSize: 12 },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(2.5) },
    chip: { paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3), borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
    chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    chipText: { color: theme.colors.textMuted, fontWeight: '600' },
    chipTextOn: { color: theme.colors.onPrimary, fontWeight: '700' },
    note: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, color: theme.colors.text, paddingHorizontal: theme.spacing(3), height: 50, marginTop: theme.spacing(1), borderWidth: 1, borderColor: theme.colors.border },
    qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: theme.spacing(4) },
    qtyLabel: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    qtyControls: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(4) },
    qtyBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    qtyBtnText: { color: theme.colors.text, fontSize: 24, fontWeight: '800' },
    qtyValue: { color: theme.colors.text, fontSize: 20, fontWeight: '800', minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] },
    actions: { flexDirection: 'row', gap: theme.spacing(3) },
});
