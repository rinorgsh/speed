import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Search, Send, ShoppingCart, X } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { OptionsModal } from '../components/OptionsModal';
import { theme } from '../theme';
import { useConfig } from '../store/useConfig';
import { useCart } from '../store/useCart';
import { printKitchen } from '../services/printing';
import type { Category, Product, SelectedOption } from '../types';
import type { RootStackParamList } from '../navigation/types';

// Dimensions calculées -> s'adapte à n'importe quel écran (iPhone / Samsung / iPad).
const SCREEN_W = Dimensions.get('window').width;
const IS_TABLET = SCREEN_W >= 700;
const H_PAD = 12; // marge latérale des grilles
const GAP = 10;
const PROD_COLS = IS_TABLET ? 5 : 3;
const PROD_SIZE = Math.floor((SCREEN_W - H_PAD * 2 - GAP * (PROD_COLS - 1)) / PROD_COLS);

/** Écran POS : catégories (imbriquées) + grille de produits + barre Order/Cart. */
export function PosScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Pos'>) {
    const categories = useConfig((s) => s.categories);
    const allProducts = useConfig((s) => s.products);
    const order = useCart((s) => s.order);
    const addLine = useCart((s) => s.addLine);

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

    const [modalProduct, setModalProduct] = useState<Product | null>(null);
    const [sending, setSending] = useState(false);
    const [search, setSearch] = useState('');
    const [searchActive, setSearchActive] = useState(false);

    // Recherche : filtre sur TOUS les produits par nom (ignore la catégorie).
    const q = searchActive ? search.trim().toLowerCase() : '';
    const shown = q ? allProducts.filter((p) => p.name.toLowerCase().includes(q)) : products;

    // Loupe dans l'en-tête de navigation : n'occupe aucune place à l'écran.
    useLayoutEffect(() => {
        navigation.setOptions({
            headerRight: () => (
                <Pressable onPress={() => setSearchActive((v) => !v)} hitSlop={12} style={{ paddingHorizontal: 4 }}>
                    <Search color={theme.colors.text} size={22} />
                </Pressable>
            ),
        });
    }, [navigation]);
    useEffect(() => { if (!searchActive) setSearch(''); }, [searchActive]);

    const counts = useMemo(() => {
        const m = new Map<number, number>();
        for (const l of order?.lines ?? []) {
            if (l.voided || l.product_id == null) continue;
            m.set(l.product_id, (m.get(l.product_id) ?? 0) + l.qty);
        }
        return m;
    }, [order]);

    const selectRoot = (id: number) => {
        setRootId(id);
        const kids = childrenOf(id);
        setChildId(kids[0]?.id ?? null);
    };

    const onProduct = (p: Product) => {
        if (!p.available) return;
        if (p.option_group_ids.length) setModalProduct(p);
        else addLine(p, [], 1, null);
    };

    const onConfirmOptions = (options: SelectedOption[], qty: number, note: string | null) => {
        if (modalProduct) addLine(modalProduct, options, qty, note);
        setModalProduct(null);
    };

    const sendOrder = async () => {
        if (sending) return;
        const cart = useCart.getState();
        if (cart.pendingNew() === 0 && cart.pendingCancel() === 0) return;
        setSending(true);
        const { newLines, cancelLines } = cart.sendToKitchen();
        const current = useCart.getState().order;
        if (current) await printKitchen(current, newLines, cancelLines).catch(() => {});
        setSending(false);
        const sent = newLines.reduce((s, l) => s + l.qty, 0);
        const cancelled = cancelLines.reduce((s, l) => s + l.qty, 0);
        Alert.alert('Cuisine', `${sent} article(s) envoyé(s)${cancelled ? `, ${cancelled} annulé(s)` : ''}.`);
    };

    const count = order?.lines.filter((l) => !l.voided).reduce((s, l) => s + l.qty, 0) ?? 0;
    const total = order?.total ?? 0;
    // Deux champs du bouton Order : nouveaux articles à envoyer / annulations.
    const pendingNew = order?.lines.reduce((s, l) => s + Math.max(0, l.qty - l.sent_qty), 0) ?? 0;
    const pendingCancel = order?.lines.reduce((s, l) => s + Math.max(0, l.sent_qty - l.qty), 0) ?? 0;
    const canOrder = pendingNew > 0 || pendingCancel > 0;
    const fmtQty = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));

    // Rangée d'onglets (catégories ou sous-catégories) : slide horizontal, chaque
    // bouton à la taille de son texte (jamais tronqué). Sélection = fond coloré.
    const renderTabs = (items: Category[], activeId: number | null, onSelect: (id: number) => void, big: boolean) => (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={big ? styles.catScroll : styles.subScroll}
            contentContainerStyle={styles.tabScrollContent}
        >
            {items.map((c) => {
                const active = activeId === c.id;
                return (
                    <Pressable
                        key={c.id}
                        onPress={() => onSelect(c.id)}
                        style={[big ? styles.cat : styles.subcat, { backgroundColor: active ? (c.color ?? theme.colors.surfaceAlt) : theme.colors.surface }]}
                    >
                        <Text style={[big ? styles.catText : styles.subcatText, active ? styles.tabTextActive : styles.tabTextIdle]}>{c.name}</Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );

    return (
        <Screen style={{ padding: 0 }} edges={['bottom']}>
            {/* Recherche (via la loupe de l'en-tête) OU onglets catégories */}
            {searchActive ? (
                <View style={styles.searchRow}>
                    <Search color={theme.colors.textMuted} size={18} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Rechercher un produit…"
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
                    {renderTabs(roots, rootId, selectRoot, true)}
                    {children.length > 0 && renderTabs(children, childId, setChildId, false)}
                </>
            )}

            {/* Grille produits — occupe tout l'espace dispo */}
            <ScrollView style={styles.gridScroll} contentContainerStyle={styles.grid}>
                {shown.map((p) => {
                    const qty = counts.get(p.id) ?? 0;
                    return (
                        <Pressable
                            key={p.id}
                            onPress={() => onProduct(p)}
                            disabled={!p.available}
                            style={[styles.product, { backgroundColor: p.color ?? theme.colors.surface }, !p.available && styles.unavailable]}
                        >
                            <Text style={styles.productName} numberOfLines={2}>{p.name}</Text>
                            <Text style={styles.productPrice}>{p.price.toFixed(2)} €</Text>
                            {qty > 0 && (
                                <View style={styles.counter}>
                                    <Text style={styles.counterText}>{qty % 1 === 0 ? qty : qty.toFixed(0)}</Text>
                                </View>
                            )}
                            {!p.available && <Text style={styles.badge86}>86</Text>}
                        </Pressable>
                    );
                })}
                {!shown.length && <Text style={styles.empty}>Aucun produit.</Text>}
            </ScrollView>

            {/* Barre du bas — collée en bas */}
            <View style={styles.bottomBar}>
                <Pressable onPress={sendOrder} disabled={!canOrder || sending} style={[styles.orderBtn, (!canOrder || sending) && styles.btnDisabled]}>
                    {sending ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <Send color="#fff" size={20} />
                            <Text style={styles.btnText}>Order</Text>
                            {pendingNew > 0 && (
                                <View style={styles.badgeNew}><Text style={styles.badgeText}>+{fmtQty(pendingNew)}</Text></View>
                            )}
                            {pendingCancel > 0 && (
                                <View style={styles.badgeCancel}><Text style={styles.badgeText}>−{fmtQty(pendingCancel)}</Text></View>
                            )}
                        </>
                    )}
                </Pressable>
                <Pressable onPress={() => navigation.navigate('Cart')} style={styles.cartBtn}>
                    <ShoppingCart color="#fff" size={20} />
                    <Text style={styles.btnText}>Cart</Text>
                    <View style={styles.cartInfo}>
                        <Text style={styles.cartInfoText}>{count} · {total.toFixed(2)} €</Text>
                    </View>
                </Pressable>
            </View>

            <OptionsModal product={modalProduct} visible={!!modalProduct} onClose={() => setModalProduct(null)} onConfirm={onConfirmOptions} />
        </Screen>
    );
}

const styles = StyleSheet.create({
    // Recherche
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2), backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing(3.5), height: 48, marginHorizontal: H_PAD, marginTop: theme.spacing(2.5) },
    searchInput: { flex: 1, color: theme.colors.text, fontSize: 16, height: '100%' },

    // Onglets (slide horizontal)
    catScroll: { flexGrow: 0, paddingTop: theme.spacing(2.5) },
    subScroll: { flexGrow: 0, paddingTop: theme.spacing(2) },
    tabScrollContent: { gap: GAP, paddingHorizontal: H_PAD },
    cat: { height: 56, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing(6) },
    subcat: { height: 56, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing(6) },
    catText: { fontWeight: '800', fontSize: 16 },
    subcatText: { fontWeight: '800', fontSize: 16 },
    tabTextActive: { color: theme.colors.onAccent },
    tabTextIdle: { color: theme.colors.textMuted },

    // Produits
    gridScroll: { flex: 1, marginTop: theme.spacing(2.5) },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: H_PAD, paddingBottom: theme.spacing(3) },
    product: { width: PROD_SIZE, height: PROD_SIZE, borderRadius: theme.radius.md, padding: theme.spacing(2.5), justifyContent: 'space-between' },
    unavailable: { opacity: 0.4 },
    productName: { color: '#fff', fontWeight: '700', fontSize: 14 },
    productPrice: { color: '#fff', fontWeight: '800', fontSize: 16 },
    counter: {
        position: 'absolute', top: 6, right: 6, minWidth: 26, height: 26, borderRadius: 13,
        backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
    },
    counterText: { color: theme.colors.bg, fontWeight: '800', fontSize: 14 },
    badge86: { position: 'absolute', top: 6, left: 8, color: '#fff', fontWeight: '800' },
    empty: { color: theme.colors.textMuted, padding: theme.spacing(4) },

    // Barre du bas
    bottomBar: { flexDirection: 'row', gap: theme.spacing(3), paddingHorizontal: H_PAD, paddingTop: theme.spacing(2.5), paddingBottom: theme.spacing(2) },
    orderBtn: { flex: 1, height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing(2), backgroundColor: theme.colors.warning, borderRadius: theme.radius.md },
    badgeNew: { backgroundColor: 'rgba(255,255,255,0.30)', minWidth: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
    badgeCancel: { backgroundColor: theme.colors.danger, minWidth: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
    badgeText: { color: '#fff', fontWeight: '800', fontSize: 14 },
    cartBtn: { flex: 1, height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing(2), backgroundColor: theme.colors.success, borderRadius: theme.radius.md },
    btnDisabled: { backgroundColor: theme.colors.surfaceAlt, opacity: 0.6 },
    btnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
    cartInfo: { position: 'absolute', right: 10, top: 8 },
    cartInfoText: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '700' },
});
