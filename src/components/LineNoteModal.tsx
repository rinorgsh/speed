import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '../theme';
import { useCart } from '../store/useCart';
import { useConfig } from '../store/useConfig';
import { useT } from '../i18n';
import type { OrderLine } from '../types';

/**
 * Saisie de la note d'une ligne de commande (« sans oignon », « bien cuit »).
 *
 * Partagé par le panier du téléphone et la caisse iPad : la disposition des
 * deux écrans diffère, mais la fonction doit être RIGOUREUSEMENT identique —
 * une note saisie au comptoir vaut celle saisie en salle, et rien ne justifie
 * deux comportements à maintenir.
 */
interface Props {
    visible: boolean;
    line: OrderLine | null;
    onClose: () => void;
}

/** Découpe une note en éléments : la virgule sépare les demandes cumulées. */
const noteParts = (text: string) => text.split(',').map((p) => p.trim()).filter(Boolean);

export function LineNoteModal({ visible, line, onClose }: Props) {
    const setLineNote = useCart((s) => s.setLineNote);
    const quickNotes = useConfig((s) => s.quickNotes);
    const t = useT();
    const [draft, setDraft] = useState('');

    // Le brouillon repart de la note enregistrée à chaque ouverture : rouvrir
    // après avoir annulé ne doit jamais ressusciter une saisie abandonnée.
    useEffect(() => {
        if (visible) setDraft(line?.note ?? '');
    }, [visible, line?.id, line?.note]);

    if (!line) return null;

    const isOn = (label: string) => noteParts(draft).some((p) => p.toLowerCase() === label.toLowerCase());

    /**
     * Les suggestions s'AJOUTENT au texte au lieu de le remplacer : une même
     * ligne cumule souvent plusieurs demandes (« Sans oignon, Bien cuit »).
     * Retoucher une case déjà active la retire.
     */
    const toggle = (label: string) => {
        const parts = noteParts(draft);
        const index = parts.findIndex((p) => p.toLowerCase() === label.toLowerCase());
        if (index >= 0) parts.splice(index, 1);
        else parts.push(label);
        setDraft(parts.join(', '));
    };

    const save = () => {
        setLineNote(line.id, draft);
        onClose();
    };

    const remove = () => {
        setLineNote(line.id, null);
        onClose();
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <Pressable style={styles.backdrop} onPress={onClose}>
                    <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
                        <Text style={styles.title} numberOfLines={1}>{line.name_snapshot}</Text>

                        {/* Une ligne déjà partie en cuisine a son ticket imprimé : la
                            note ajoutée après coup n'y figurera pas. */}
                        {line.sent_qty > 0 && (
                            <Text style={styles.warning}>
                                {t('Déjà envoyé en cuisine : prévenez-la de vive voix, le ticket est imprimé.')}
                            </Text>
                        )}

                        {/* Suggestions réglées dans l'admin : un tap suffit, personne ne
                            tape « sans oignon » au clavier en plein service. */}
                        {quickNotes.length > 0 && (
                            <ScrollView style={styles.quickScroll} contentContainerStyle={styles.quickNotes} keyboardShouldPersistTaps="handled">
                                {quickNotes.map((q) => {
                                    const on = isOn(q.label);
                                    return (
                                        <Pressable
                                            key={q.id}
                                            onPress={() => toggle(q.label)}
                                            style={({ pressed }) => [styles.quickNote, on && styles.quickNoteOn, pressed && styles.quickNotePressed]}
                                        >
                                            <Text style={[styles.quickNoteText, on && styles.quickNoteTextOn]}>{q.label}</Text>
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                        )}

                        <TextInput
                            value={draft}
                            onChangeText={setDraft}
                            placeholder={t('ex. sans oignon')}
                            placeholderTextColor={theme.colors.textMuted}
                            style={styles.input}
                            // Pas d'autoFocus : le clavier masquerait les suggestions,
                            // qui sont justement là pour éviter de taper.
                            multiline
                            maxLength={120}
                        />

                        <View style={styles.buttons}>
                            <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose}>
                                <Text style={styles.btnGhostText}>{t('Annuler')}</Text>
                            </Pressable>
                            {!!line.note && (
                                <Pressable style={[styles.btn, styles.btnGhost]} onPress={remove}>
                                    <Text style={styles.btnRemoveText}>{t('Retirer')}</Text>
                                </Pressable>
                            )}
                            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={save}>
                                <Text style={styles.btnPrimaryText}>{t('Enregistrer')}</Text>
                            </Pressable>
                        </View>
                    </Pressable>
                </Pressable>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: {
        backgroundColor: theme.colors.surfaceAlt,
        borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg,
        padding: theme.spacing(4), paddingBottom: theme.spacing(6),
        borderTopWidth: 1, borderColor: theme.colors.border,
        // Sur iPad, une feuille pleine largeur donnerait une ligne de boutons
        // démesurée : on la centre et on la borne.
        width: '100%', maxWidth: 620, alignSelf: 'center',
    },
    title: { color: theme.colors.text, fontSize: 18, fontWeight: '800', marginBottom: theme.spacing(3) },
    warning: { color: theme.colors.warning, fontSize: 13, marginBottom: theme.spacing(2.5) },
    // Beaucoup de notes rapides ne doivent pas repousser le champ hors de l'écran.
    quickScroll: { maxHeight: 190, marginBottom: theme.spacing(3) },
    quickNotes: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(2) },
    quickNote: {
        paddingHorizontal: theme.spacing(3.5), paddingVertical: theme.spacing(2.5),
        borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface,
        borderWidth: 1, borderColor: theme.colors.border,
    },
    quickNoteOn: { backgroundColor: theme.colors.warning, borderColor: theme.colors.warning },
    quickNotePressed: { opacity: 0.7 },
    quickNoteText: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },
    quickNoteTextOn: { color: '#1a1200' },
    input: {
        backgroundColor: theme.colors.surface, borderRadius: theme.radius.md,
        borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text,
        paddingHorizontal: theme.spacing(3.5), paddingTop: theme.spacing(3), paddingBottom: theme.spacing(3),
        minHeight: 84, fontSize: 16, textAlignVertical: 'top',
    },
    buttons: { flexDirection: 'row', gap: theme.spacing(3), marginTop: theme.spacing(3.5) },
    btn: { flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md },
    btnGhost: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
    btnGhostText: { color: theme.colors.textMuted, fontWeight: '700', fontSize: 15 },
    btnRemoveText: { color: theme.colors.danger, fontWeight: '700', fontSize: 15 },
    btnPrimary: { backgroundColor: theme.colors.primary },
    btnPrimaryText: { color: theme.colors.onPrimary, fontWeight: '800', fontSize: 15 },
});
