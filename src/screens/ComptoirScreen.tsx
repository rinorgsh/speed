import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Delete, ChevronLeft, Banknote, CreditCard, Search, X, Send, MessageSquare, Sliders, ReceiptText } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { OptionsModal } from '../components/OptionsModal';
import { LineActionsSheet } from '../components/LineActionsSheet';
import { ProductTile } from '../components/ProductTile';
import { LineNoteModal } from '../components/LineNoteModal';
import { theme } from '../theme';
import { useConfig } from '../store/useConfig';
import { useCart } from '../store/useCart';
import { useAuth } from '../store/useAuth';
import * as db from '../db/database';
import { printCustomerReceipt, printKitchen } from '../services/printing';
import { flushOutbox } from '../services/sync';
import type { Category, Product, SelectedOption, ServiceType } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { useT } from '../i18n';

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
export function ComptoirScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Comptoir'>) {
    const { width } = useWindowDimensions();
    // Mode TABLE : même disposition, mais service en salle. Une table n'est pas
    // du pay & go — on envoie en cuisine, le client consomme, puis on encaisse
    // (avec partage d'addition et remise éventuels).
    //
    // Le mode se déduit de la COMMANDE, pas des paramètres de navigation :
    // revenir sur cet écran sans paramètre conserverait ceux du passage
    // précédent, et une vente comptoir s'afficherait comme une table.
    const categories = useConfig((s) => s.categories);
    const allProducts = useConfig((s) => s.products);
    const order = useCart((s) => s.order);
    const server = useAuth((s) => s.server);
    const allTables = useConfig((s) => s.tables);
    const t = useT();

    const tableMode = order?.table_id != null;
    const tableLabel = order?.table_id != null
        ? allTables.find((tb) => tb.id === order.table_id)?.label ?? route.params?.tableLabel ?? '—'
        : null;

    const [serviceType, setServiceTypeState] = useState<ServiceType>('dine_in');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [mode, setMode] = useState<Mode>('qty');
    const [typing, setTyping] = useState(false);
    const [buffer, setBuffer] = useState('');
    const [modalProduct, setModalProduct] = useState<Product | null>(null);
    const [processing, setProcessing] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);
    // Note et actions de ligne : mêmes possibilités qu'au panier du téléphone,
    // dans la disposition de la caisse.
    const [noteOpen, setNoteOpen] = useState(false);
    const [actionsOpen, setActionsOpen] = useState(false);

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

    // Recherche : filtre sur TOUS les produits par nom (ignore la catégorie).
    const [search, setSearch] = useState('');
    const [searchActive, setSearchActive] = useState(false);
    const q = searchActive ? search.trim().toLowerCase() : '';
    const shown = q ? allProducts.filter((p) => p.name.toLowerCase().includes(q)) : products;
    useEffect(() => { if (!searchActive) setSearch(''); }, [searchActive]);

    // Comptoir : on REPREND la vente en cours si elle existe (y compris après un
    // aller-retour par la salle), sinon on en ouvre une neuve. En mode table, la
    // commande a déjà été reprise par l'écran des salles.
    useEffect(() => {
        if (order) { setServiceTypeState(order.service_type); return; }
        if (tableMode) return;

        void (async () => {
            const { session } = useAuth.getState();
            const enCours = session
                ? await db.getOpenCounterOrder(session.id, useAuth.getState().profileId)
                : null;
            if (enCours) { useCart.getState().resume(enCours); setServiceTypeState(enCours.service_type); }
            else startCounter(serviceType);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Quantité déjà au ticket, par produit : le compteur blanc des tuiles.
    const counts = useMemo(() => {
        const m = new Map<number, number>();
        for (const l of order?.lines ?? []) {
            if (l.voided || l.product_id == null) continue;
            m.set(l.product_id, (m.get(l.product_id) ?? 0) + l.qty);
        }
        return m;
    }, [order]);

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

    // Actions cuisine en attente : ajouts (+N) et annulations (−N), affichées
    // séparément sur le bouton Order comme sur téléphone.
    const pendingNew = useCart((s) => s.pendingNew());
    const pendingCancel = useCart((s) => s.pendingCancel());
    const toSend = pendingNew + pendingCancel;

    /** Envoi en préparation, sans encaisser : le parcours normal d'une table. */
    const sendToKitchen = async () => {
        const cart = useCart.getState();
        if (!cart.order || processing || !toSend) return;
        setProcessing(true);
        try {
            const batch = cart.sendToKitchen();
            const afterSend = useCart.getState().order;
            if (afterSend) await printKitchen(afterSend, batch.newLines, batch.cancelLines).catch(() => {});
            await flushOutbox();
            setFlash(t('Envoyé en cuisine'));
            setTimeout(() => setFlash(null), 1800);
        } finally {
            setProcessing(false);
        }
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
            const printed = await printCustomerReceipt(paid).catch(() => false);
            await flushOutbox();

            if (!printed) {
                await new Promise<void>((resolve) => {
                    Alert.alert('Ticket non imprimé', "L'imprimante caisse n'a pas répondu. Le paiement est bien enregistré.", [
                        { text: 'Réimprimer', onPress: async () => { await printCustomerReceipt(paid).catch(() => false); resolve(); } },
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
                    <Pressable key={c.id} onPress={() => onSelect(c.id)} style={[styles.tab, active && { backgroundColor: c.color ?? theme.colors.surfaceAlt, borderColor: c.color ?? theme.colors.borderStrong }]}>
                        <Text style={[styles.tabText, active && styles.tabTextActive]}>{c.name}</Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );

    return (
        // Cet écran n'a pas d'en-tête de navigation : il doit gérer LUI-MÊME
        // toutes les marges de sécurité, sinon son contenu passe sous l'heure
        // et la batterie (visible surtout sur iPad en paysage).
        <Screen style={{ padding: 0 }} edges={['top', 'bottom', 'left', 'right']}>
            <View style={styles.root}>
                {/* ---------- Produits ---------- */}
                <View style={styles.left}>
                    <View style={styles.topbar}>
                        {/* Retour salle À GAUCHE : c'est là qu'on cherche un retour,
                            comme le chevron d'un en-tête de navigation mobile. */}
                        <Pressable onPress={() => navigation.navigate('Rooms')} style={styles.backBtn}>
                            <ChevronLeft color={theme.colors.onPrimary} size={22} strokeWidth={2.5} />
                            <Text style={styles.backText}>{t('Salles')}</Text>
                        </Pressable>
                        <View style={styles.titleBox}>
                            <Text style={styles.who} numberOfLines={1}>{tableMode ? `${t('Table')} ${tableLabel}` : t('Comptoir')}</Text>
                            <Text style={styles.sub}>{server?.name}</Text>
                        </View>
                        <View style={styles.svcToggle}>
                            {(['dine_in', 'takeaway'] as ServiceType[]).map((st) => (
                                <Pressable key={st} onPress={() => selectService(st)} style={[styles.svcBtn, serviceType === st && styles.svcBtnOn]}>
                                    <Text style={[styles.svcText, serviceType === st && styles.svcTextOn]}>{st === 'dine_in' ? t('Sur place') : t('Emporter')}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <Pressable onPress={() => setSearchActive((v) => !v)} style={styles.iconBtn}>
                            <Search color={theme.colors.text} size={20} />
                        </Pressable>
                    </View>

                    {searchActive ? (
                        <View style={styles.searchRow}>
                            <Search color={theme.colors.textMuted} size={18} />
                            <TextInput
                                style={styles.searchInput}
                                placeholder={t('Rechercher un produit')}
                                placeholderTextColor={theme.colors.textFaint}
                                value={search}
                                onChangeText={setSearch}
                                autoFocus
                                returnKeyType="search"
                                autoCorrect={false}
                            />
                            <Pressable onPress={() => setSearchActive(false)} hitSlop={8}>
                                <X color={theme.colors.textMuted} size={18} />
                            </Pressable>
                        </View>
                    ) : (
                        <>
                            {renderTabs(roots, rootId, selectRoot)}
                            {children.length > 0 && renderTabs(children, childId, setChildId)}
                        </>
                    )}

                    <ScrollView style={{ flex: 1, marginTop: theme.spacing(2) }} contentContainerStyle={[styles.grid, { gap: GAP }]}>
                        {shown.map((p) => (
                            <ProductTile
                                key={p.id}
                                product={p}
                                size={cell}
                                qty={counts.get(p.id) ?? 0}
                                price={p.is_open_price ? t('Prix libre') : euro(p.price)}
                                onPress={() => onProduct(p)}
                            />
                        ))}
                        {!shown.length && <Text style={styles.empty}>{t('Aucun produit.')}</Text>}
                    </ScrollView>
                </View>

                {/* ---------- Ticket ---------- */}
                <View style={[styles.ticket, { width: TICKET_W }]}>
                    <View style={styles.tHead}>
                        <Text style={styles.tTitle}>
                            {tableMode ? `${t('Table')} ${tableLabel}` : 'Ticket'}{order?.ticket_number ? ` #${order.ticket_number}` : ''}
                        </Text>
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
                                        {/* Note de la ligne : visible partout où le ticket l'est. */}
                                        {!!l.note && <Text style={styles.lineNote} numberOfLines={2}>{l.note}</Text>}
                                    </View>
                                    <Text style={styles.lineTotal}>{euro(l.line_total)}</Text>
                                </Pressable>
                            );
                        })}
                        {!lines.length && <Text style={styles.tEmpty}>{t('Touchez un produit pour commencer.')}</Text>}
                    </ScrollView>

                    <View style={styles.totals}>
                        <View style={styles.totalRow}><Text style={styles.taxLabel}>{t('Dont TVA')}</Text><Text style={styles.taxValue}>{euro(order?.tax_total ?? 0)}</Text></View>
                        <View style={styles.totalRow}><Text style={styles.totalLabel}>{t('Total')}</Text><Text style={styles.totalValue}>{euro(total)}</Text></View>
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

                    {/* Note et actions de la ligne sélectionnée. Placées juste sous
                        le pavé, au contact du ticket : elles portent sur la LIGNE,
                        pas sur la commande, contrairement aux boutons du bas. */}
                    <View style={styles.lineTools}>
                        <Pressable
                            onPress={() => selected && setNoteOpen(true)}
                            disabled={!selected}
                            style={[styles.lineTool, !selected && styles.lineToolDim, !!selected?.note && styles.lineToolOn]}
                        >
                            <MessageSquare color={selected?.note ? theme.colors.warning : theme.colors.text} size={18} />
                            <Text style={[styles.lineToolText, !!selected?.note && styles.lineToolTextOn]} numberOfLines={1}>
                                {t('Note')}
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={() => selected && setActionsOpen(true)}
                            disabled={!selected}
                            style={[styles.lineTool, !selected && styles.lineToolDim]}
                        >
                            <Sliders color={theme.colors.text} size={18} />
                            <Text style={styles.lineToolText} numberOfLines={1}>Actions</Text>
                        </Pressable>
                    </View>

                    {/* Actions du bas : une table s'envoie puis s'encaisse plus tard,
                        un comptoir s'encaisse tout de suite (pay & go). */}
                    {tableMode ? (
                        /* Mêmes repères que sur téléphone : Order en ambre, Cart en vert. */
                        <View style={styles.pays}>
                            <Pressable
                                onPress={sendToKitchen}
                                disabled={!toSend || processing}
                                style={[styles.actionBtn, styles.orderBtn, (!toSend || processing) && styles.btnDisabled]}
                            >
                                {processing ? <ActivityIndicator color="#fff" /> : (
                                    <>
                                        <Send color="#fff" size={20} />
                                        <Text style={styles.actionText}>Order</Text>
                                        {pendingNew > 0 && (
                                            <View style={styles.badgeNew}><Text style={styles.badgeText}>+{fmtQty(pendingNew)}</Text></View>
                                        )}
                                        {pendingCancel > 0 && (
                                            <View style={styles.badgeCancel}><Text style={styles.badgeText}>−{fmtQty(pendingCancel)}</Text></View>
                                        )}
                                    </>
                                )}
                            </Pressable>
                            {/* « Payment » et non « Cart » : sur téléphone, le panier est
                                un écran à ouvrir, ici il est déjà sous les yeux. Ce bouton
                                mène à l'encaissement — même libellé que sur téléphone,
                                pour la même destination. */}
                            <Pressable
                                onPress={() => navigation.navigate('Payment')}
                                disabled={!lines.length || processing}
                                style={[styles.actionBtn, styles.cartBtn, (!lines.length || processing) && styles.btnDisabled]}
                            >
                                <CreditCard color="#fff" size={20} />
                                <Text style={styles.actionText}>Payment</Text>
                                <View style={styles.cartInfo}>
                                    <Text style={styles.cartInfoText}>{lines.length} · {euro(total)}</Text>
                                </View>
                            </Pressable>
                        </View>
                    ) : (
                        <View style={styles.pays}>
                            <Pressable onPress={() => pay('cash')} disabled={!lines.length || processing} style={[styles.pay, styles.payCash, (!lines.length || processing) && styles.payDim]}>
                                {processing ? <ActivityIndicator color="#06281b" /> : (<><Banknote color="#06281b" size={20} /><Text style={styles.payCashText}>{t('Espèces')}</Text></>)}
                            </Pressable>
                            <Pressable onPress={() => pay('card')} disabled={!lines.length || processing} style={[styles.pay, styles.payCard, (!lines.length || processing) && styles.payDim]}>
                                <CreditCard color={theme.colors.text} size={20} /><Text style={styles.payCardText}>{t('Carte')}</Text>
                            </Pressable>
                            {/* Encaissement détaillé : remise, partage d'addition, impression
                                de l'addition, montant partiel. Sans cette porte, le comptoir
                                iPad était le SEUL endroit d'où ces fonctions étaient
                                inatteignables — le pay & go reste à un tap juste à côté. */}
                            <Pressable
                                onPress={() => navigation.navigate('Payment')}
                                disabled={!lines.length || processing}
                                style={[styles.payMore, (!lines.length || processing) && styles.payDim]}
                            >
                                <ReceiptText color={theme.colors.text} size={20} />
                                <Text style={styles.payMoreText} numberOfLines={1}>{t('Détail')}</Text>
                            </Pressable>
                        </View>
                    )}
                </View>
            </View>

            {flash && (
                <View style={styles.flash} pointerEvents="none"><Text style={styles.flashText}>{flash}</Text></View>
            )}

            <OptionsModal product={modalProduct} visible={!!modalProduct} onClose={() => setModalProduct(null)} onConfirm={onConfirmOptions} />
            <LineNoteModal visible={noteOpen} line={selected} onClose={() => setNoteOpen(false)} />
            <LineActionsSheet visible={actionsOpen} line={selected} onClose={() => setActionsOpen(false)} />
        </Screen>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, flexDirection: 'row' },

    // Colonne produits
    left: { flex: 1, paddingHorizontal: theme.spacing(3), paddingTop: theme.spacing(2) },
    topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing(3), marginBottom: theme.spacing(2) },
    // Retour salle : plein accent, impossible à manquer et clairement une action.
    backBtn: {
        flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1.5),
        backgroundColor: theme.colors.primary, borderRadius: theme.radius.md,
        paddingLeft: theme.spacing(2), paddingRight: theme.spacing(3.5), height: 44,
    },
    backText: { color: theme.colors.onPrimary, fontWeight: '800', fontSize: 15 },
    titleBox: { flex: 1, minWidth: 0 },
    who: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
    sub: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: 1 },
    svcToggle: { flexDirection: 'row', backgroundColor: theme.colors.surface, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, padding: 3 },
    svcBtn: { paddingHorizontal: theme.spacing(3.5), paddingVertical: theme.spacing(2), borderRadius: theme.radius.pill },
    svcBtnOn: { backgroundColor: theme.colors.primary },
    svcText: { color: theme.colors.textMuted, fontWeight: '700', fontSize: 13 },
    svcTextOn: { color: theme.colors.onPrimary },
    iconBtn: { width: 44, height: 44, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },

    searchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2), backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing(3), height: 46, marginTop: theme.spacing(1) },
    searchInput: { flex: 1, color: theme.colors.text, fontSize: 15, height: '100%' },

    tabsContent: { gap: 8, paddingVertical: theme.spacing(1.5) },
    tab: { height: 48, paddingHorizontal: theme.spacing(4), borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
    tabText: { color: theme.colors.textMuted, fontWeight: '800', fontSize: 15 },
    tabTextActive: { color: theme.colors.onAccent },

    grid: { flexDirection: 'row', flexWrap: 'wrap', paddingBottom: theme.spacing(3) },
    product: { borderRadius: theme.radius.md, padding: theme.spacing(2.5), justifyContent: 'space-between' },
    unavailable: { opacity: 0.4 },
    productName: { color: '#fff', fontWeight: '700', fontSize: 14 },
    productPrice: { color: '#fff', fontWeight: '800', fontSize: 15 },
    counter: {
        position: 'absolute', top: 6, right: 6, minWidth: 26, height: 26, borderRadius: 13,
        backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
    },
    counterText: { color: theme.colors.bg, fontWeight: '800', fontSize: 14 },
    badge86: { position: 'absolute', top: 6, left: 8, color: '#fff', fontWeight: '800' },
    // Boutons d'action en mode table : mêmes couleurs que le téléphone.
    actionBtn: { flex: 1, height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing(2), borderRadius: theme.radius.md },
    orderBtn: { backgroundColor: theme.colors.warning },
    cartBtn: { backgroundColor: theme.colors.success },
    btnDisabled: { backgroundColor: theme.colors.surfaceAlt, opacity: 0.6 },
    actionText: { color: '#fff', fontSize: 18, fontWeight: '800' },
    badgeNew: { backgroundColor: 'rgba(255,255,255,0.30)', minWidth: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
    badgeCancel: { backgroundColor: theme.colors.danger, minWidth: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
    badgeText: { color: '#fff', fontWeight: '800', fontSize: 14 },
    cartInfo: { position: 'absolute', right: 10, top: 8 },
    cartInfoText: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '700' },
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
    lineNote: { color: theme.colors.warning, fontSize: 11, fontStyle: 'italic', marginTop: 2 },
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
    modeTextOn: { color: theme.colors.onPrimary },
    backCell: { backgroundColor: theme.colors.dangerSoft, borderWidth: 1, borderColor: theme.colors.danger },

    // Outils de LIGNE (note, actions) : volontairement plus discrets que les
    // boutons d'encaissement, pour qu'on ne les confonde pas.
    lineTools: { flexDirection: 'row', gap: theme.spacing(2), paddingTop: theme.spacing(3) },
    lineTool: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: theme.spacing(2), height: 46, borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
        paddingHorizontal: theme.spacing(2),
    },
    lineToolDim: { opacity: 0.45 },
    // Ligne porteuse d'une note : signalé sans avoir à ouvrir.
    lineToolOn: { borderColor: theme.colors.warning },
    lineToolText: { color: theme.colors.text, fontWeight: '700', fontSize: 14, flexShrink: 1 },
    lineToolTextOn: { color: theme.colors.warning },

    pays: { flexDirection: 'row', gap: theme.spacing(2.5), paddingVertical: theme.spacing(3) },
    // Plus étroit que Espèces/Carte : c'est une porte de sortie, pas le geste courant.
    payMore: {
        width: 96, height: 58, alignItems: 'center', justifyContent: 'center', gap: 2,
        borderRadius: theme.radius.md, backgroundColor: theme.colors.surface,
        borderWidth: 1, borderColor: theme.colors.border,
    },
    payMoreText: { color: theme.colors.text, fontWeight: '700', fontSize: 12 },
    pay: { flex: 1, height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing(2), borderRadius: theme.radius.md },
    payCash: { backgroundColor: theme.colors.success },
    payCashText: { color: '#06281b', fontWeight: '800', fontSize: 16 },
    payCard: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
    payCardText: { color: theme.colors.text, fontWeight: '800', fontSize: 16 },
    payDim: { opacity: 0.4 },

    flash: { position: 'absolute', bottom: theme.spacing(6), alignSelf: 'center', backgroundColor: theme.colors.success, borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing(5), paddingVertical: theme.spacing(3) },
    flashText: { color: '#06281b', fontWeight: '800', fontSize: 15 },
});
