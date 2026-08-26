import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Search, Send, ShoppingCart, X } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { OptionsModal } from '../components/OptionsModal';
import { ProductTile } from '../components/ProductTile';
import { theme } from '../theme';
import { useConfig, showProductPrices } from '../store/useConfig';
import * as haptique from '../services/haptique';
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
    const showPrices = useConfig(showProductPrices);
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
                <Pressable onPress={() => setSearchActive((v) => !v)} hitSlop={10} style={styles.searchBtn}>
                    <Search color={theme.colors.text} size={24} />
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
        if (p.option_group_ids.length) { setModalProduct(p); return; }
        // Le doigt sent que l'article est passé : plus besoin de vérifier l'écran.
        haptique.ajout();
        addLine(p, [], 1, null);
        // Prix libre : le montant est à saisir, et le pavé est dans le panier.
        // Sans ce renvoi, l'article restait à 0 € sans que rien ne le signale
        // (la caisse iPad, elle, bascule directement en mode Prix).
        if (p.is_open_price) navigation.navigate('Cart');
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
        haptique.reussite();
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
    /*
     * Quel bouton mérite le vert ? Celui que la situation appelle. Des articles
     * attendent d'être envoyés -> « Envoyer ». Plus rien en attente -> « Panier »,
     * la porte vers l'encaissement. Deux boutons de poids identique laissaient le
     * serveur choisir à chaque fois ; ici l'écran lui indique la suite.
     */
    const aEnvoyer = canOrder;
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
                        style={[
                            big ? styles.cat : styles.subcat,
                            // Le premier niveau se remplit de la couleur de la famille ;
                            // le second reste sourd, pour qu'on sache à quel étage on est.
                            big
                                ? { backgroundColor: active ? (c.color ?? theme.colors.surfaceAlt) : theme.colors.surface }
                                : { backgroundColor: active ? theme.colors.surfaceAlt : theme.colors.bg, borderColor: active ? theme.colors.borderStrong : theme.colors.border },
                        ]}
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

            {/*
                Grille produits, VIRTUALISÉE. Elle rendait auparavant tous les
                produits d'un coup : 143 tuiles chez la friterie, présentes en
                mémoire même hors de l'écran. Une FlatList n'en monte qu'une
                poignée à la fois et recycle le reste au défilement.
            */}
            <FlatList
                style={styles.gridScroll}
                contentContainerStyle={styles.grid}
                columnWrapperStyle={styles.gridRow}
                data={shown}
                keyExtractor={(p) => String(p.id)}
                numColumns={PROD_COLS}
                initialNumToRender={PROD_COLS * 4}
                windowSize={5}
                removeClippedSubviews
                keyboardShouldPersistTaps="handled"
                renderItem={({ item: p }) => (
                    <ProductTile
                        product={p}
                        size={PROD_SIZE}
                        qty={counts.get(p.id) ?? 0}
                        price={p.is_open_price ? 'Prix libre' : `${p.price.toFixed(2)} €`}
                        showPrice={showPrices}
                        onPress={() => onProduct(p)}
                    />
                )}
                ListEmptyComponent={<Text style={styles.empty}>Aucun produit.</Text>}
            />

            {/* Barre du bas — collée en bas.
                Le bouton mis en avant est celui que la SITUATION appelle : des
                articles non envoyés -> « Envoyer » ; plus rien en attente ->
                « Panier », d'où l'on encaisse sans jamais passer par la cuisine. */}
            <View style={styles.bottomBar}>
                <Pressable
                    onPress={sendOrder}
                    disabled={!canOrder || sending}
                    style={[styles.action, aEnvoyer ? styles.actionOn : styles.actionOff, (!canOrder || sending) && styles.btnDisabled]}
                >
                    {sending ? (
                        <ActivityIndicator color={aEnvoyer ? '#04220F' : theme.colors.text} />
                    ) : (
                        <>
                            <View style={styles.actionLine}>
                                <Send color={aEnvoyer ? '#04220F' : theme.colors.text} size={18} />
                                <Text style={[styles.actionText, aEnvoyer && styles.actionTextOn]}>Envoyer</Text>
                            </View>
                            {(pendingNew > 0 || pendingCancel > 0) && (
                                <Text style={[styles.actionSub, aEnvoyer && styles.actionSubOn]}>
                                    {pendingNew > 0 ? `+${fmtQty(pendingNew)}` : ''}
                                    {pendingNew > 0 && pendingCancel > 0 ? '  ' : ''}
                                    {pendingCancel > 0 ? `−${fmtQty(pendingCancel)}` : ''}
                                </Text>
                            )}
                        </>
                    )}
                </Pressable>
                <Pressable
                    onPress={() => navigation.navigate('Cart')}
                    style={[styles.action, aEnvoyer ? styles.actionOff : styles.actionOn]}
                >
                    <View style={styles.actionLine}>
                        <ShoppingCart color={aEnvoyer ? theme.colors.text : '#04220F'} size={18} />
                        <Text style={[styles.actionText, !aEnvoyer && styles.actionTextOn]}>Panier</Text>
                    </View>
                    <Text style={[styles.actionSub, !aEnvoyer && styles.actionSubOn]}>
                        {count} · {total.toFixed(2)} €
                    </Text>
                </Pressable>
            </View>

            <OptionsModal product={modalProduct} visible={!!modalProduct} onClose={() => setModalProduct(null)} onConfirm={onConfirmOptions} />
        </Screen>
    );
}

const styles = StyleSheet.create({
    // Recherche
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2), backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing(3.5), height: 48, marginHorizontal: H_PAD, marginTop: theme.spacing(2.5) },
    // Une icône de 22 px sans fond n'offrait presque aucune cible, alors que la
    // recherche est le chemin le plus court dans une carte de 143 produits.
    searchBtn: { width: 40, height: 40, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt },
    searchInput: { flex: 1, color: theme.colors.text, fontSize: 16, height: '100%' },

    // Onglets (slide horizontal)
    catScroll: { flexGrow: 0, paddingTop: theme.spacing(2.5) },
    subScroll: { flexGrow: 0, paddingTop: theme.spacing(2) },
    tabScrollContent: { gap: GAP, paddingHorizontal: H_PAD },
    cat: { height: 56, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing(6) },
    subcat: { height: 44, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing(4.5), borderWidth: 1, borderColor: theme.colors.border },
    catText: { fontWeight: '800', fontSize: 16, letterSpacing: -0.2 },
    subcatText: { fontWeight: '700', fontSize: 14 },
    tabTextActive: { color: theme.colors.onAccent },
    tabTextIdle: { color: theme.colors.textMuted },

    // Produits
    gridScroll: { flex: 1, marginTop: theme.spacing(2.5) },
    grid: { gap: GAP, paddingHorizontal: H_PAD, paddingBottom: theme.spacing(3) },
    gridRow: { gap: GAP },
    empty: { color: theme.colors.textMuted, padding: theme.spacing(4) },

    // Barre du bas
    bottomBar: { flexDirection: 'row', gap: theme.spacing(2.5), paddingHorizontal: H_PAD, paddingTop: theme.spacing(2.5), paddingBottom: theme.spacing(2) },
    action: { flex: 1, height: 62, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: theme.radius.md },
    actionOn: { backgroundColor: theme.colors.success },
    actionOff: { backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
    actionLine: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2) },
    actionText: { color: theme.colors.text, fontSize: 17, fontWeight: '800' },
    actionTextOn: { color: '#04220F' },
    actionSub: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
    actionSubOn: { color: 'rgba(4,34,15,0.75)' },
    btnDisabled: { opacity: 0.45 },
});
