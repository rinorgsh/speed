import React from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import { theme } from '../theme';
import { useCart } from '../store/useCart';
import { useT } from '../i18n';
import type { OrderLine } from '../types';

/**
 * Actions disponibles sur la ligne sélectionnée, en feuille plutôt qu'en
 * alerte : la liste est faite pour s'allonger, et une alerte plafonne à trois
 * boutons lisibles.
 *
 * Partagée par le panier du téléphone et la caisse iPad — les deux écrans
 * doivent proposer exactement les mêmes actions.
 */
interface Props {
    visible: boolean;
    line: OrderLine | null;
    onClose: () => void;
}

export function LineActionsSheet({ visible, line, onClose }: Props) {
    const setLineQty = useCart((s) => s.setLineQty);
    const t = useT();

    if (!line) return null;

    const remove = () => {
        onClose();
        // Un article déjà parti en cuisine ne disparaît pas en silence : le
        // retirer déclenche un ticket d'annulation au prochain envoi.
        if (line.sent_qty > 0) {
            Alert.alert(
                t('Retirer un article déjà envoyé ?'),
                t('La cuisine a déjà reçu cet article. Le retrait lui sera signalé au prochain envoi.'),
                [
                    { text: t('Annuler'), style: 'cancel' },
                    { text: t("Retirer l'article"), style: 'destructive', onPress: () => setLineQty(line.id, 0) },
                ],
            );
            return;
        }
        setLineQty(line.id, 0);
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
                    <Text style={styles.title} numberOfLines={1}>{line.name_snapshot}</Text>

                    <Pressable style={styles.row} onPress={remove}>
                        <Trash2 color={theme.colors.danger} size={20} />
                        <Text style={[styles.label, { color: theme.colors.danger }]}>{t("Retirer l'article")}</Text>
                    </Pressable>

                    <Pressable style={styles.cancel} onPress={onClose}>
                        <Text style={styles.cancelText}>{t('Annuler')}</Text>
                    </Pressable>
                </Pressable>
            </Pressable>
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
        width: '100%', maxWidth: 620, alignSelf: 'center',
    },
    title: { color: theme.colors.text, fontSize: 18, fontWeight: '800', marginBottom: theme.spacing(3) },
    row: {
        flexDirection: 'row', alignItems: 'center', gap: theme.spacing(3),
        paddingVertical: theme.spacing(3.5), borderTopWidth: 1, borderColor: theme.colors.border,
    },
    label: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    cancel: {
        marginTop: theme.spacing(3), height: 48, alignItems: 'center', justifyContent: 'center',
        borderRadius: theme.radius.md, backgroundColor: theme.colors.surface,
        borderWidth: 1, borderColor: theme.colors.border,
    },
    cancelText: { color: theme.colors.textMuted, fontWeight: '700', fontSize: 15 },
});
