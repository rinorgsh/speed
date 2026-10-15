import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
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
import { COLS_MAX, GAP, grille, H_CAT, H_PAD, H_SOUS, ONGLET_VISE, rangees as calculRangees, TUILE_VISEE } from '../utils/grille';
import { isFirstSend, resolveCallNumber } from '../services/callNumber';

/** Écran POS : catégories (imbriquées) + grille de produits + barre Order/Cart. */
export function PosScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Pos'>) {
    const { width: largeurEcran } = useWindowDimensions();
    const { cols: PROD_COLS, taille: PROD_SIZE } = useMemo(() => grille(largeurEcran), [largeurEcran]);

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

    /*
     * L'en-tête porte la TABLE, pas le mot « Commande ».
     *
     * Un serveur qui revient d'une autre table doit pouvoir vérifier d'un coup
     * d'œil où il se trouve avant d'ajouter quoi que ce soit. Le titre figé ne
     * le disait pas, et rien d'autre à l'écran ne le rappelait.
     */
    const tables = useConfig((s) => s.tables);
    const titre = useMemo(() => {
        if (!order?.table_id) return 'Comptoir';
        const t = tables.find((x) => x.id === order.table_id);
        return t ? `Table ${t.label}` : 'Commande';
    }, [order?.table_id, tables]);

    // Loupe dans l'en-tête de navigation : n'occupe aucune place à l'écran.
    useLayoutEffect(() => {
        navigation.setOptions({
            title: titre,
            headerRight: () => (
                <Pressable onPress={() => setSearchActive((v) => !v)} hitSlop={10} style={styles.searchBtn}>
                    <Search color={theme.colors.text} size={24} />
                </Pressable>
            ),
        });
    }, [navigation, titre]);
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
        const firstSend = isFirstSend(cart.order);
        const { newLines, cancelLines } = cart.sendToKitchen();
        const callNumber = await resolveCallNumber(firstSend, newLines.length > 0);
        const current = useCart.getState().order;
        if (current) await printKitchen(current, newLines, cancelLines, callNumber).catch(() => {});
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

    /*
     * Bandeau d'onglets en GRILLE.
     *
     * C'était un défilement horizontal d'une seule ligne : rien n'indiquait
     * qu'il restait des catégories hors écran. Puis des boutons enroulés à la
     * taille de leur texte, ce qui laissait un vide en fin de rangée et donnait
     * des cibles inégales — la plus courte étant la plus dure à viser.
     *
     * Désormais toutes les cellules ont la MÊME largeur et remplissent la ligne,
     * comme la grille produits juste en dessous. On défile verticalement au-delà
     * de `rangees`, sans jamais empiéter sur les produits.
     *
     * Le `paddingTop` est porté par le conteneur EXTÉRIEUR : à l'intérieur du
     * `maxHeight`, il rognait la rangée et coupait les boutons par le bas.
     */
    const renderTabs = (
        items: Category[],
        activeId: number | null,
        onSelect: (id: number) => void,
        big: boolean,
        maxRangees: number,
    ) => {
        const hauteur = big ? H_CAT : H_SOUS;
        // Peu d'onglets : ils se partagent la largeur au lieu de laisser un vide.
        const { cols, taille } = grille(
            largeurEcran,
            big ? TUILE_VISEE : ONGLET_VISE,
            1,
            Math.max(1, Math.min(items.length, big ? 4 : COLS_MAX)),
        );

        /*
         * Le bandeau ne réserve que les rangées qu'il utilise VRAIMENT.
         *
         * Un plafond fixe cachait la seconde rangée quand trois racines tenaient
         * sur deux colonnes, et gaspillait de la hauteur quand elles tenaient sur
         * une seule.
         */
        const rangees = calculRangees(items.length, cols, maxRangees);

        return (
            <View style={big ? styles.catBand : styles.subBand}>
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    style={{ maxHeight: hauteur * rangees + GAP * (rangees - 1) }}
                    contentContainerStyle={styles.tabWrap}
                >
                    {items.map((c) => {
                        const active = activeId === c.id;
                        return (
                            <Pressable
                                key={c.id}
                                onPress={() => onSelect(c.id)}
                                style={[
                                    styles.tab,
                                    { width: taille, height: hauteur },
                                    /*
                                        La couleur de la famille en LISERÉ, pas en aplat.
                                        Un onglet rouge vif et un bleu vif étaient les seules
                                        taches saturées de l'application ; ils juraient avec
                                        la sobriété du reste et écrasaient la grille.
                                    */
                                    big
                                        ? {
                                            backgroundColor: active ? theme.colors.surfaceAlt : theme.colors.surface,
                                            borderBottomWidth: 3,
                                            borderBottomColor: active ? (c.color ?? theme.colors.primary) : 'transparent',
                                        }
                                        : {
                                            backgroundColor: active ? theme.colors.surfaceAlt : theme.colors.bg,
                                            borderWidth: 1,
                                            borderColor: active ? theme.colors.borderStrong : theme.colors.border,
                                        },
                                ]}
                            >
                                {/* Deux lignes : « Sauce supplémentaire » ne tient pas sur
                                    une cellule de 118 pt, et le tronquer le rendrait
                                    indistinguable de « Sauce pour frite ». */}
                                <Text
                                    style={[big ? styles.catText : styles.subcatText, active ? styles.tabTextActive : styles.tabTextIdle]}
                                    numberOfLines={2}
                                >
                                    {c.name}
                                </Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </View>
        );
    };

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
                    {/*
                        Deux racines seulement — le cas de la friterie, Food et Drink —
                        n'ont pas besoin de deux rangées : la place rendue va aux
                        sous-catégories, qui sont nombreuses. La hauteur suit le
                        contenu, pas la structure.
                    */}
                    {/*
                        Les racines s'étalent sur deux rangées au plus. Ce qu'elles ne
                        prennent pas revient aux sous-catégories, qui sont nombreuses
                        chez un friterie — la place suit le contenu, pas la structure.
                    */}
                    {renderTabs(roots, rootId, selectRoot, true, 2)}
                    {children.length > 0 && renderTabs(children, childId, setChildId, false, roots.length <= 3 ? 3 : 2)}
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
                key={`grille-${PROD_COLS}`}
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

    // Onglets : grille à cellules égales.
    // Le padding vit sur le conteneur EXTÉRIEUR — à l'intérieur du maxHeight il
    // rognait la rangée et coupait les boutons par le bas.
    catBand: { paddingTop: theme.spacing(2.5) },
    subBand: { paddingTop: theme.spacing(2) },
    // `flexWrap` : les onglets passent à la ligne au lieu de filer hors écran.
    tabWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: H_PAD },
    tab: { borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing(1.5) },
    // Centré et sur deux lignes : la cellule étant fixe, c'est le texte qui doit
    // s'y plier, pas l'inverse.
    catText: { ...theme.font.heading, fontSize: 15, textAlign: 'center' },
    subcatText: { ...theme.font.label, fontSize: 13, textAlign: 'center', lineHeight: 15 },
    tabTextActive: { color: theme.colors.text },
    tabTextIdle: { color: theme.colors.textMuted },

    // Produits
    gridScroll: { flex: 1, marginTop: theme.spacing(2.5) },
    grid: { gap: GAP, paddingHorizontal: H_PAD, paddingBottom: theme.spacing(3) },
    gridRow: { gap: GAP },
    empty: { ...theme.font.body, color: theme.colors.textFaint, textAlign: 'center', paddingVertical: theme.spacing(10) },

    // Barre du bas
    bottomBar: { flexDirection: 'row', gap: theme.spacing(2.5), paddingHorizontal: H_PAD, paddingTop: theme.spacing(2.5), paddingBottom: theme.spacing(2) },
    action: { flex: 1, height: 62, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: theme.radius.md },
    actionOn: { backgroundColor: theme.colors.success },
    actionOff: { backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
    actionLine: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2) },
    actionText: { ...theme.font.heading, color: theme.colors.text, fontSize: 17, fontWeight: '800' },
    actionTextOn: { color: '#04220F' },
    actionSub: { ...theme.font.chiffres, color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
    actionSubOn: { color: 'rgba(4,34,15,0.75)' },
    btnDisabled: { opacity: 0.45 },
});
