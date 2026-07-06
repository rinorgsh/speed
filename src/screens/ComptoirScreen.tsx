import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Delete, LayoutGrid, Banknote, CreditCard } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { OptionsModal } from '../components/OptionsModal';
import { theme } from '../theme';
import { useConfig } from '../store/useConfig';
import { useCart } from '../store/useCart';
import { useAuth } from '../store/useAuth';
import { printCustomerReceipt, printKitchen } from '../services/printing';
import { flushOutbox } from '../services/sync';
import type { Category, Product, SelectedOption, ServiceType } from '../types';
import type { RootStackParamList } from '../navigation/types';

type Mode = 'qty' | 'price';

const round2 = (x: number) => Math.round(x * 100) / 100;
const round05 = (x: number) => Math.round(x * 20) / 20; // arrondi cash belge (5 cts)
const fmtQty = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));
const euro = (n: number) => `${n.toFixed(2)} €`;

/**
 * COMPTOIR (iPad) — caisse rapide « vente directe / pay & go ».
 * Écran unique : grille produits à gauche, ticket + pavé Qté/Prix + encaissement
 * à droite. Commande walk-in (table_id = null). Après paiement, un nouveau ticket
 * s'ouvre automatiquement. Réutilise toute la logique existante (useCart, impression,
 * sync). Aucune dépendance native -> déployable en OTA.
 */
export function ComptoirScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Comptoir'>) {
    const { width } = useWindowDimensions();
    const categories = useConfig((s) => s.categories);
    const allProducts = useConfig((s) => s.products);
    const order = useCart((s) => s.order);
    const server = useAuth((s) => s.server);

    const [serviceType, setServiceTypeState] = useState<ServiceType>('dine_in');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [mode, setMode] = useState<Mode>('qty');
    const [typing, setTyping] = useState(false);
    const [buffer, setBuffer] = useState('');
    const [modalProduct, setModalProduct] = useState<Product | null>(null);
    const [processing, setProcessing] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);

    // Catégories imbriquées (Food / Drink -> sous-catégories), comme le POS.
    const roots = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
    const childrenOf = (id: number) => categories.filter((c) => c.parent_id === id);
    const [rootId, setRootId] = useState<number | null>(roots[0]?.id ?? null);
    const children = rootId ? childrenOf(rootId) : [];
    const [childId, setChildId] = useState<number | null>(children[0]?.id ?? null);
    const activeCategoryId = children.length ? childId : rootId;
    const products = useMemo(
        () => (activeCategoryId ? allProducts.filter((p) => p.category_id === activeCategoryId) : []),
        [allProducts, activeCategoryId],
    );

    // Ouvre une commande comptoir au montage si aucune n'est active.
    useEffect(() => {
        if (!order) startCounter(serviceType);
        else setServiceTypeState(order.service_type);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const lines = order ? order.lines.filter((l) => !l.voided && l.qty > 0) : [];
    const selected = lines.find((l) => l.id === selectedId) ?? null;
    const total = order?.total ?? 0;

    // --- Grille : dimensions responsive (panneau ticket = largeur fixe à droite) ---
    const TICKET_W = width >= 1100 ? 400 : 340;
    const GAP = 10;
    const gridW = width - TICKET_W - 24;
    const cols = Math.max(2, Math.min(5, Math.floor(gridW / 160)));
    const cell = Math.floor((gridW - GAP * (cols - 1)) / cols);

    // --- Actions ---
    function startCounter(st: ServiceType) {
        const { session, server: srv } = useAuth.getState();
        if (!session || !srv) return;
        useCart.getState().startNew({ sessionId: session.id, serverId: srv.id, roomId: null, tableId: null, serviceType: st });
        setSelectedId(null);
        setMode('qty');
        setTyping(false);
        setBuffer('');
    }

    const selectService = (st: ServiceType) => {
        setServiceTypeState(st);
        useCart.getState().setServiceType(st);
    };

    const selectRoot = (id: number) => {
        setRootId(id);
        const kids = childrenOf(id);
        setChildId(kids[0]?.id ?? null);
    };

    const selectLine = (id: string) => { setSelectedId(id); setTyping(false); setBuffer(''); };
    const selectMode = (m: Mode) => { setMode(m); setTyping(false); setBuffer(''); };

    // Sélectionne la ligne du produit qu'on vient d'ajouter (pour l'éditer au pavé).
    const selectAfterAdd = (productId: number) => {
        const ls = (useCart.getState().order?.lines ?? []).filter((l) => l.product_id === productId && !l.voided && l.qty > 0);
        if (ls.length) { setSelectedId(ls[ls.length - 1].id); setMode('qty'); setTyping(false); setBuffer(''); }
    };

    const onProduct = (p: Product) => {
        if (!p.available) return;
        if (p.option_group_ids.length) { setModalProduct(p); return; }
        useCart.getState().addLine(p, [], 1, null);
        // Prix libre -> on bascule direct en mode Prix pour saisir le montant.
        if (p.is_open_price) { selectAfterAdd(p.id); setMode('price'); setTyping(false); setBuffer(''); }
        else selectAfterAdd(p.id);
    };

    const onConfirmOptions = (options: SelectedOption[], qty: number, note: string | null) => {
        if (modalProduct) { useCart.getState().addLine(modalProduct, options, qty, note); selectAfterAdd(modalProduct.id); }
        setModalProduct(null);
    };

    const current = selected ? (mode === 'qty' ? selected.qty : selected.unit_price_snapshot) : 0;

    const onKey = (k: string) => {
        if (!selected) return;
        let buf = typing ? buffer : '';
        if (k === 'back') buf = buf.slice(0, -1);
        else if (k === '.') { if (buf === '') buf = '0.'; else if (!buf.includes('.')) buf += '.'; }
        else if (k === '+/-') buf = String(-(parseFloat(buf || String(current)) || 0));
        else buf += k;
        setBuffer(buf);
        setTyping(true);
        const v = parseFloat(buf) || 0;
        if (mode === 'qty') useCart.getState().setLineQty(selected.id, v);
        else useCart.getState().setLinePrice(selected.id, v);
    };

    const removeSelected = () => {
        if (selected) useCart.getState().setLineQty(selected.id, 0);
    };

    // --- Encaissement pay & go ---
    const pay = async (method: 'cash' | 'card') => {
        const cart = useCart.getState();
        const ord = cart.order;
        if (!ord || processing || cart.remaining() <= 0.001) return;
        setProcessing(true);
        try {
            // 1) Envoi en préparation (cuisine/bar selon la catégorie -> imprimante).
            const batch = cart.sendToKitchen();
            const afterSend = useCart.getState().order;
            if (afterSend) await printKitchen(afterSend, batch.newLines, batch.cancelLines).catch(() => {});

            // 2) Paiement du montant total (cash arrondi 5 cts belge).
            const rem = cart.remaining();
            const amount = method === 'cash' ? round05(rem) : rem;
            cart.addPayment(method, round2(amount));
            cart.markPaid();

            // 3) Ticket client + remontée serveur.
            const paid = useCart.getState().order!;
            const printed = await printCustomerReceipt(paid, false).catch(() => false);
            await flushOutbox();

            if (!printed) {
                await new Promise<void>((resolve) => {
                    Alert.alert('Ticket non imprimé', "L'imprimante caisse n'a pas répondu. Le paiement est bien enregistré.", [
                        { text: 'Réimprimer', onPress: async () => { await printCustomerReceipt(paid, false).catch(() => false); resolve(); } },
                        { text: 'Continuer sans', style: 'cancel', onPress: () => resolve() },
                    ]);
                });
            }

            // 4) Pay & go : nouveau ticket immédiatement.
            startCounter(serviceType);
            setFlash(method === 'cash' ? `Encaissé ${euro(amount)}` : 'Encaissé par carte');
            setTimeout(() => setFlash(null), 2200);
        } finally {
            setProcessing(false);
        }
    };

    // --- Pavé numérique (Qté / Prix) ---
    const KEYS: { k: string; label?: string; mode?: Mode; back?: boolean; spacer?: boolean }[][] = [
        [{ k: '1' }, { k: '2' }, { k: '3' }, { k: 'qty', mode: 'qty', label: 'Qté' }],
        [{ k: '4' }, { k: '5' }, { k: '6' }, { k: 'price', mode: 'price', label: 'Prix' }],
        [{ k: '7' }, { k: '8' }, { k: '9' }, { k: 'back', back: true }],
        [{ k: '+/-' }, { k: '0' }, { k: '.' }, { k: 'sp', spacer: true }],
    ];

    const renderTabs = (items: Category[], activeId: number | null, onSelect: (id: number) => void) => (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.tabsContent}>
            {items.map((c) => {
                const active = activeId === c.id;
                return (
                    <Pressable key={c.id} onPress={() => onSelect(c.id)} style={[styles.tab, active && styles.tabActive]}>
                        <Text style={[styles.tabText, active && styles.tabTextActive]}>{c.name}</Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );

    return (
        <Screen style={{ padding: 0 }} edges={['bottom']}>
            <View style={styles.root}>
                {/* ---------- Produits ---------- */}
                <View style={styles.left}>
                    <View style={styles.topbar}>
                        <View>
                            <Text style={styles.who}>Comptoir</Text>
                            <Text style={styles.sub}>{server?.name}</Text>
                        </View>
                        <View style={styles.svcToggle}>
                            {(['dine_in', 'takeaway'] as ServiceType[]).map((st) => (
                                <Pressable key={st} onPress={() => selectService(st)} style={[styles.svcBtn, serviceType === st && styles.svcBtnOn]}>
                                    <Text style={[styles.svcText, serviceType === st && styles.svcTextOn]}>{st === 'dine_in' ? 'Sur place' : 'Emporter'}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <Pressable onPress={() => navigation.navigate('Rooms')} style={styles.salleBtn}>
                            <LayoutGrid color={theme.colors.text} size={18} />
                            <Text style={styles.salleText}>Salle</Text>
                        </Pressable>
                    </View>

                    {renderTabs(roots, rootId, selectRoot)}
                    {children.length > 0 && renderTabs(children, childId, setChildId)}

                    <ScrollView style={{ flex: 1, marginTop: theme.spacing(2) }} contentContainerStyle={[styles.grid, { gap: GAP }]}>
                        {products.map((p) => (
                            <Pressable
                                key={p.id}
                                onPress={() => onProduct(p)}
                                disabled={!p.available}
                                style={[styles.product, { width: cell, height: cell, backgroundColor: p.color ?? theme.colors.surface }, !p.available && styles.unavailable]}
                            >
                                <Text style={styles.productName} numberOfLines={2}>{p.name}</Text>
                                <Text style={styles.productPrice}>{p.is_open_price ? 'Prix libre' : euro(p.price)}</Text>
                                {!p.available && <Text style={styles.badge86}>86</Text>}
                            </Pressable>
                        ))}
                        {!products.length && <Text style={styles.empty}>Aucun produit.</Text>}
                    </ScrollView>
                </View>

                {/* ---------- Ticket ---------- */}
                <View style={[styles.ticket, { width: TICKET_W }]}>
                    <View style={styles.tHead}>
                        <Text style={styles.tTitle}>Ticket {order?.ticket_number ? `#${order.ticket_number}` : ''}</Text>
                        <Text style={styles.tTag}>{serviceType === 'dine_in' ? 'Sur place' : 'Emporter'}</Text>
                    </View>

                    <ScrollView style={styles.tLines} contentContainerStyle={{ paddingVertical: theme.spacing(1) }}>
                        {lines.map((l) => {
                            const isSel = l.id === selectedId;
                            return (
                                <Pressable key={l.id} onPress={() => selectLine(l.id)} style={[styles.line, isSel && styles.lineSel]}>
                                    <View style={[styles.qtyBox, isSel && mode === 'qty' && styles.fieldOn]}>
                                        <Text style={[styles.qtyText, isSel && mode === 'qty' && styles.fieldOnText]}>{fmtQty(l.qty)}×</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.lineName} numberOfLines={1}>{l.name_snapshot}</Text>
                                        <Text style={[styles.lineMeta, isSel && mode === 'price' && styles.metaOn]}>{euro(l.unit_price_snapshot)}</Text>
                                    </View>
                                    <Text style={styles.lineTotal}>{euro(l.line_total)}</Text>
                                </Pressable>
                            );
                        })}
                        {!lines.length && <Text style={styles.tEmpty}>Touchez un produit pour commencer.</Text>}
                    </ScrollView>

                    <View style={styles.totals}>
                        <View style={styles.totalRow}><Text style={styles.taxLabel}>Dont TVA</Text><Text style={styles.taxValue}>{euro(order?.tax_total ?? 0)}</Text></View>
                        <View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>{euro(total)}</Text></View>
                    </View>

                    {/* Pavé Qté / Prix */}
                    <View style={styles.pad}>
                        {KEYS.map((row, ri) => (
                            <View key={ri} style={styles.padRow}>
                                {row.map((c) => {
                                    if (c.spacer) return <View key="sp" style={styles.padCell} />;
                                    if (c.mode) {
                                        const on = mode === c.mode;
                                        return (
                                            <Pressable key={c.k} onPress={() => selectMode(c.mode!)} style={[styles.padCell, styles.modeCell, on && styles.modeCellOn]}>
                                                <Text style={[styles.modeText, on && styles.modeTextOn]}>{c.label}</Text>
                                            </Pressable>
                                        );
                                    }
                                    if (c.back) {
                                        return (
                                            <Pressable key="back" onPress={() => onKey('back')} style={[styles.padCell, styles.backCell]}>
                                                <Delete color={theme.colors.danger} size={22} />
                                            </Pressable>
                                        );
                                    }
                                    return (
                                        <Pressable key={c.k} onPress={() => onKey(c.k)} style={({ pressed }) => [styles.padCell, styles.digitCell, pressed && styles.digitPressed]}>
                                            <Text style={styles.digitText}>{c.k}</Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        ))}
                    </View>

                    {/* Encaissement */}
                    <View style={styles.pays}>
                        <Pressable onPress={() => pay('cash')} disabled={!lines.length || processing} style={[styles.pay, styles.payCash, (!lines.length || processing) && styles.payDim]}>
                            {processing ? <ActivityIndicator color="#06281b" /> : (<><Banknote color="#06281b" size={20} /><Text style={styles.payCashText}>Espèces</Text></>)}
                        </Pressable>
                        <Pressable onPress={() => pay('card')} disabled={!lines.length || processing} style={[styles.pay, styles.payCard, (!lines.length || processing) && styles.payDim]}>
                            <CreditCard color={theme.colors.text} size={20} /><Text style={styles.payCardText}>Carte</Text>
                        </Pressable>
                    </View>
                </View>
            </View>

            {flash && (
                <View style={styles.flash} pointerEvents="none"><Text style={styles.flashText}>{flash}</Text></View>
            )}

            <OptionsModal product={modalProduct} visible={!!modalProduct} onClose={() => setModalProduct(null)} onConfirm={onConfirmOptions} />
        </Screen>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, flexDirection: 'row' },

    // Colonne produits
    left: { flex: 1, paddingHorizontal: theme.spacing(3), paddingTop: theme.spacing(2) },
    topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing(3), marginBottom: theme.spacing(2) },
    who: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
    sub: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: 1 },
    svcToggle: { flexDirection: 'row', backgroundColor: theme.colors.surface, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, padding: 3 },
    svcBtn: { paddingHorizontal: theme.spacing(3.5), paddingVertical: theme.spacing(2), borderRadius: theme.radius.pill },
    svcBtnOn: { backgroundColor: theme.colors.primary },
    svcText: { color: theme.colors.textMuted, fontWeight: '700', fontSize: 13 },
    svcTextOn: { color: '#fff' },
    salleBtn: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2), backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing(3.5), paddingVertical: theme.spacing(2.5), borderWidth: 1, borderColor: theme.colors.border },
    salleText: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },

    tabsContent: { gap: 8, paddingVertical: theme.spacing(1.5) },
    tab: { height: 48, paddingHorizontal: theme.spacing(4), borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
    tabActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    tabText: { color: theme.colors.textMuted, fontWeight: '800', fontSize: 15 },
    tabTextActive: { color: '#fff' },

    grid: { flexDirection: 'row', flexWrap: 'wrap', paddingBottom: theme.spacing(3) },
    product: { borderRadius: theme.radius.md, padding: theme.spacing(2.5), justifyContent: 'space-between' },
    unavailable: { opacity: 0.4 },
    productName: { color: '#fff', fontWeight: '700', fontSize: 14 },
    productPrice: { color: '#fff', fontWeight: '800', fontSize: 15 },
    badge86: { position: 'absolute', top: 6, left: 8, color: '#fff', fontWeight: '800' },
    empty: { color: theme.colors.textMuted, padding: theme.spacing(4) },

    // Ticket
    ticket: { backgroundColor: theme.colors.bgElevated, borderLeftWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingTop: theme.spacing(2.5) },
    tHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: theme.spacing(2.5), borderBottomWidth: 1, borderColor: theme.colors.border },
    tTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800' },
    tTag: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
    tLines: { flex: 1 },
    line: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2.5), paddingVertical: theme.spacing(2), paddingHorizontal: theme.spacing(2), borderRadius: theme.radius.md, borderWidth: 1, borderColor: 'transparent' },
    lineSel: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
    qtyBox: { minWidth: 42, height: 34, paddingHorizontal: theme.spacing(2), borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
    qtyText: { color: theme.colors.text, fontWeight: '800', fontSize: 14 },
    fieldOn: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
    fieldOnText: { color: theme.colors.bg },
    lineName: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },
    lineMeta: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: 1 },
    metaOn: { color: theme.colors.text, fontWeight: '800' },
    lineTotal: { color: theme.colors.text, fontWeight: '800', fontSize: 15 },
    tEmpty: { color: theme.colors.textMuted, textAlign: 'center', marginTop: theme.spacing(8), paddingHorizontal: theme.spacing(4) },

    totals: { paddingVertical: theme.spacing(2.5), borderTopWidth: 1, borderColor: theme.colors.border },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    taxLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
    taxValue: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
    totalLabel: { color: theme.colors.text, fontSize: 15, fontWeight: '700', marginTop: 2 },
    totalValue: { color: theme.colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginTop: 2 },

    pad: { paddingTop: theme.spacing(2), gap: theme.spacing(2) },
    padRow: { flexDirection: 'row', gap: theme.spacing(2) },
    padCell: { flex: 1, height: 46, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center' },
    digitCell: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
    digitPressed: { backgroundColor: theme.colors.surfaceAlt },
    digitText: { color: theme.colors.text, fontSize: 22, fontWeight: '700' },
    modeCell: { backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
    modeCellOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    modeText: { color: theme.colors.textMuted, fontSize: 14, fontWeight: '700' },
    modeTextOn: { color: '#fff' },
    backCell: { backgroundColor: theme.colors.dangerSoft, borderWidth: 1, borderColor: theme.colors.danger },

    pays: { flexDirection: 'row', gap: theme.spacing(2.5), paddingVertical: theme.spacing(3) },
    pay: { flex: 1, height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing(2), borderRadius: theme.radius.md },
    payCash: { backgroundColor: theme.colors.success },
    payCashText: { color: '#06281b', fontWeight: '800', fontSize: 16 },
    payCard: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
    payCardText: { color: theme.colors.text, fontWeight: '800', fontSize: 16 },
    payDim: { opacity: 0.4 },

    flash: { position: 'absolute', bottom: theme.spacing(6), alignSelf: 'center', backgroundColor: theme.colors.success, borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing(5), paddingVertical: theme.spacing(3) },
    flashText: { color: '#06281b', fontWeight: '800', fontSize: 15 },
});
