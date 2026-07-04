import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, ImageBackground, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Menu as MenuIcon, Wallet, LayoutGrid, Lock, ShoppingBag, Repeat } from 'lucide-react-native';

// Tailles calculées (app verrouillée en portrait).
const SCREEN_W = Dimensions.get('window').width;
const PAD = 16; // padding du Screen (spacing 4)
const GAP = 12;
const TABLE_COLS = 3;
const TABLE_SIZE = Math.floor((SCREEN_W - PAD * 2 - GAP * (TABLE_COLS - 1)) / TABLE_COLS);
const MAX_FILL_TABS = 5; // au-delà : largeur fixe + scroll
const TAB_FIXED_W = Math.floor((SCREEN_W - PAD * 2 - GAP * (MAX_FILL_TABS - 1)) / MAX_FILL_TABS);
import { Screen } from '../components/Screen';
import { theme } from '../theme';
import { useConfig } from '../store/useConfig';
import { useAuth } from '../store/useAuth';
import { useCart } from '../store/useCart';
import { useRealtime } from '../store/useRealtime';
import { useTables } from '../store/useTables';
import * as db from '../db/database';
import { pullOpenOrders, resolveTableOrder, flushOutbox } from '../services/sync';
import type { Table } from '../types';
import type { RootStackParamList } from '../navigation/types';

/** Salles (onglets) ou vue « étage » (toutes les salles). État table instantané. */
export function RoomsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Rooms'>) {
    const rooms = useConfig((s) => s.rooms);
    const allTables = useConfig((s) => s.tables);
    const server = useAuth((s) => s.server);
    const session = useAuth((s) => s.session);
    const profileName = useAuth((s) => s.profileName);
    const clearActiveProfile = useAuth((s) => s.clearActiveProfile);
    const { startNew, resume } = useCart();
    const occupied = useTables((s) => s.occupied);
    const pending = useTables((s) => s.pending);
    const refreshTables = useTables((s) => s.refresh);
    const tableTick = useRealtime((s) => s.tableTick);
    const [roomId, setRoomId] = useState<number | null>(rooms[0]?.id ?? null);
    const [floorView, setFloorView] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [opening, setOpening] = useState<number | null>(null); // table en cours d'ouverture

    // Changement de profil -> les salles changent : on resélectionne une salle valide
    // du profil courant (évite d'afficher une salle/onglet d'un autre profil).
    useEffect(() => {
        if (!rooms.length) { if (roomId !== null) setRoomId(null); return; }
        if (roomId == null || !rooms.some((r) => r.id === roomId)) setRoomId(rooms[0].id);
    }, [rooms, roomId]);

    const currentRoom = rooms.find((r) => r.id === roomId);
    const tablesOf = useCallback((rid: number) => allTables.filter((t) => t.room_id === rid), [allTables]);
    const tables = useMemo(() => (roomId != null ? tablesOf(roomId) : []), [tablesOf, roomId]);

    // Caisse fermée (ici ou sur un autre appareil) -> retour au choix de profil.
    // Guardé par le focus pour ne pas déclencher sur l'appareil qui affiche le rapport Z.
    const isFocused = useIsFocused();
    useEffect(() => {
        if (isFocused && !session) {
            useCart.getState().clear();
            void clearActiveProfile();
        }
    }, [isFocused, session, clearActiveProfile]);

    // Au focus : on récupère l'état partagé du serveur (miroir) puis on rafraîchit.
    useFocusEffect(useCallback(() => {
        void refreshTables();
        void pullOpenOrders();
    }, [refreshTables]));
    useEffect(() => { void refreshTables(); }, [tableTick, refreshTables]);

    const openTable = async (table: Table) => {
        if (!session || !server || opening) return;
        setOpening(table.id);
        // Source de vérité serveur : on REPREND la commande existante de la table
        // (jamais de doublon), repli sur le cache local si hors-ligne.
        const existing = await resolveTableOrder(table.id);
        setOpening(null);
        if (existing) resume(existing);
        else startNew({ sessionId: session.id, serverId: server.id, roomId: table.room_id, tableId: table.id });
        navigation.navigate('Pos');
    };

    const releaseTable = (table: Table) => {
        if (!occupied.includes(table.id)) return;
        Alert.alert(`Libérer la table ${table.label} ?`, 'La/les commande(s) en cours sur cette table seront annulées.', [
            { text: 'Annuler', style: 'cancel' },
            {
                text: 'Libérer',
                style: 'destructive',
                onPress: async () => {
                    useTables.getState().free(table.id);
                    const current = useCart.getState().order;
                    if (current?.table_id === table.id) useCart.getState().clear();
                    await db.releaseTable(table.id);
                    await flushOutbox(); // pousse l'annulation tout de suite (autoritaire)
                    void refreshTables();
                },
            },
        ]);
    };

    const closeMenu = () => setMenuOpen(false);

    // Changer de profil (Restaurant / Event) : on vide le panier actif et on
    // revient à l'écran de choix (les commandes ouvertes restent en base par profil).
    const changeProfile = () => {
        closeMenu();
        useCart.getState().clear();
        void clearActiveProfile();
    };

    // Commande au comptoir = À EMPORTER (pas de table, TVA emporter appliquée).
    const openCounter = () => {
        if (!session || !server) return;
        closeMenu();
        startNew({ sessionId: session.id, serverId: server.id, roomId: null, tableId: null, serviceType: 'takeaway' });
        navigation.navigate('Pos');
    };

    const renderTable = (t: Table) => {
        const isOccupied = occupied.includes(t.id);
        const pendingCount = pending[t.id] ?? 0; // articles pas encore envoyés en cuisine
        return (
            <View key={t.id} style={styles.tableWrap}>
                <Pressable
                    onPress={() => openTable(t)}
                    onLongPress={() => releaseTable(t)}
                    delayLongPress={600}
                    style={({ pressed }) => [styles.table, isOccupied ? styles.tableOccupied : styles.tableFree, pressed && styles.tablePressed]}
                >
                    {opening === t.id
                        ? <ActivityIndicator color={isOccupied ? '#06281b' : theme.colors.primary} />
                        : <Text style={[styles.tableLabel, isOccupied && styles.tableLabelOccupied]}>{t.label}</Text>}
                </Pressable>
                {pendingCount > 0 && (
                    <View style={styles.pendingBadge} pointerEvents="none">
                        <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
                    </View>
                )}
            </View>
        );
    };

    return (
        <Screen>
            <View style={styles.topbar}>
                <Text style={styles.server}>{server?.name}</Text>
                <Pressable onPress={() => setMenuOpen(true)} style={styles.menuBtn} hitSlop={10}>
                    <MenuIcon color={theme.colors.text} size={30} strokeWidth={2.5} />
                </Pressable>
            </View>

            {/* Onglets salles (masqués en vue étage) */}
            {!floorView && (rooms.length <= MAX_FILL_TABS ? (
                /* ≤ 5 salles : on remplit toute la largeur, tailles égales */
                <View style={styles.tabsRow}>
                    {rooms.map((r) => (
                        <Pressable key={r.id} onPress={() => setRoomId(r.id)} style={[styles.tab, styles.tabFill, roomId === r.id && styles.tabActive]}>
                            <Text numberOfLines={1} style={[styles.tabText, roomId === r.id && styles.tabTextActive]}>{r.name}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : (
                /* > 5 salles : largeur fixe égale + scroll horizontal */
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={{ gap: GAP }}>
                    {rooms.map((r) => (
                        <Pressable key={r.id} onPress={() => setRoomId(r.id)} style={[styles.tab, { width: TAB_FIXED_W }, roomId === r.id && styles.tabActive]}>
                            <Text numberOfLines={1} style={[styles.tabText, roomId === r.id && styles.tabTextActive]}>{r.name}</Text>
                        </Pressable>
                    ))}
                </ScrollView>
            ))}

            {floorView ? (
                /* Vue étage : toutes les salles + leurs tables */
                <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing(4) }}>
                    {rooms.map((r) => (
                        <View key={r.id} style={styles.floorSection}>
                            <Text style={styles.floorRoomName}>{r.name}</Text>
                            <View style={styles.grid}>
                                {tablesOf(r.id).map(renderTable)}
                                {!tablesOf(r.id).length && <Text style={styles.empty}>Aucune table.</Text>}
                            </View>
                        </View>
                    ))}
                </ScrollView>
            ) : (
                /* Vue par salle */
                <ImageBackground
                    source={currentRoom?.background_image_url ? { uri: currentRoom.background_image_url } : undefined}
                    style={styles.bg}
                    imageStyle={{ opacity: 0.25, borderRadius: theme.radius.md }}
                >
                    <ScrollView contentContainerStyle={styles.grid}>
                        {tables.map(renderTable)}
                        {!tables.length && <Text style={styles.empty}>Aucune table dans cette salle.</Text>}
                    </ScrollView>
                </ImageBackground>
            )}

            {/* Menu déroulant */}
            <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
                <Pressable style={styles.menuBackdrop} onPress={closeMenu}>
                    <View style={styles.menu}>
                        <Pressable style={styles.menuItem} onPress={openCounter}>
                            <ShoppingBag color={theme.colors.text} size={20} />
                            <Text style={styles.menuText}>Comptoir (à emporter)</Text>
                        </Pressable>
                        {server?.role === 'admin' && (
                            <Pressable style={styles.menuItem} onPress={() => { closeMenu(); navigation.navigate('CloseSession'); }}>
                                <Wallet color={theme.colors.text} size={20} />
                                <Text style={styles.menuText}>Fermer la caisse</Text>
                            </Pressable>
                        )}
                        <Pressable style={styles.menuItem} onPress={() => { setFloorView((v) => !v); closeMenu(); }}>
                            <LayoutGrid color={theme.colors.text} size={20} />
                            <Text style={styles.menuText}>{floorView ? 'Vue par salle' : 'Switch floor view'}</Text>
                        </Pressable>
                        <Pressable style={styles.menuItem} onPress={changeProfile}>
                            <Repeat color={theme.colors.text} size={20} />
                            <Text style={styles.menuText}>Changer de profil{profileName ? ` (${profileName})` : ''}</Text>
                        </Pressable>
                        <Pressable style={styles.menuItem} onPress={() => { closeMenu(); navigation.reset({ index: 0, routes: [{ name: 'Unlock' }] }); }}>
                            <Lock color={theme.colors.text} size={20} />
                            <Text style={styles.menuText}>Verrouiller</Text>
                        </Pressable>
                    </View>
                </Pressable>
            </Modal>
        </Screen>
    );
}

const styles = StyleSheet.create({
    topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing(3) },
    server: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
    menuBtn: { padding: theme.spacing(2), borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt },
    tabs: { flexGrow: 0, marginBottom: theme.spacing(4) },
    tabsRow: { flexDirection: 'row', gap: GAP, marginBottom: theme.spacing(4) },
    tabFill: { flex: 1 },
    tab: { paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(3.5), borderRadius: theme.radius.md, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
    tabActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    tabText: { color: theme.colors.textMuted, fontWeight: '700', fontSize: 15 },
    tabTextActive: { color: '#fff' },
    bg: { flex: 1 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingBottom: theme.spacing(4) },
    // Conteneur d'une tuile (pour ancrer le badge qui déborde du coin).
    tableWrap: { width: TABLE_SIZE, height: TABLE_SIZE },
    // 3 grandes tables carrées par ligne (taille calculée pour remplir la largeur).
    table: {
        width: TABLE_SIZE,
        height: TABLE_SIZE,
        borderRadius: theme.radius.lg,
        borderWidth: 3,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // Badge rouge = nb d'articles pas encore envoyés en cuisine. À l'INTÉRIEUR du coin
    // haut-droit (pas de débordement -> jamais coupé par les bords de la grille).
    pendingBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        minWidth: 28,
        height: 28,
        borderRadius: 14,
        paddingHorizontal: 7,
        backgroundColor: theme.colors.danger,
        borderWidth: 2,
        borderColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        elevation: 6,
    },
    pendingBadgeText: { color: '#fff', fontWeight: '800', fontSize: 14 },
    tableFree: { backgroundColor: theme.colors.surface, borderColor: theme.colors.success },
    tableOccupied: { backgroundColor: theme.colors.success, borderColor: theme.colors.success },
    tablePressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
    tableLabel: { color: theme.colors.text, fontSize: 40, fontWeight: '800' },
    tableLabelOccupied: { color: '#06281b' },
    empty: { color: theme.colors.textMuted },
    floorSection: { marginBottom: theme.spacing(5) },
    floorRoomName: { color: theme.colors.text, fontSize: 17, fontWeight: '700', marginBottom: theme.spacing(3.5) },
    // Menu
    menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
    menu: {
        position: 'absolute',
        top: theme.spacing(14),
        right: theme.spacing(4),
        backgroundColor: theme.colors.surfaceAlt,
        borderRadius: theme.radius.md,
        paddingVertical: theme.spacing(2),
        minWidth: 220,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    menuItem: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(3), paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3.5) },
    menuText: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
});
