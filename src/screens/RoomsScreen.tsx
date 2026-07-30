import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Menu as MenuIcon, Wallet, LayoutGrid, Lock, ShoppingBag, Repeat, Map as MapIcon, Languages } from 'lucide-react-native';

const PAD = 16; // padding du Screen (spacing 4)
const GAP = 12;
// Largeur visée pour une tuile de table. Le nombre de colonnes en découle :
// 3 sur un téléphone, davantage sur un iPad. Calculé DANS le composant pour
// suivre les rotations — une constante de module resterait figée.
const TABLE_TARGET = 150;
import { Screen } from '../components/Screen';
import { SyncBadge } from '../components/SyncBadge';
import { RoomPlan, type TableState } from '../components/RoomPlan';
import { theme } from '../theme';
import { useConfig } from '../store/useConfig';
import { useAuth } from '../store/useAuth';
import { useCart } from '../store/useCart';
import { useRealtime } from '../store/useRealtime';
import { useTables } from '../store/useTables';
import * as db from '../db/database';
import { pullOpenOrders, resolveTableOrder, flushOutbox } from '../services/sync';
import { mergeTables, transferTable } from '../services/tableOps';
import { LOCALES, useLocale, useT } from '../i18n';
import type { RoomDecoration, Table } from '../types';
import type { RootStackParamList } from '../navigation/types';

// Préférence locale : mode d'affichage choisi sur CET appareil.
const VIEW_MODE_PREF = 'rooms_view_mode';

/** Salles (onglets) ou vue « étage » (toutes les salles). État table instantané. */
export function RoomsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Rooms'>) {
    const rooms = useConfig((s) => s.rooms);
    const allTables = useConfig((s) => s.tables);
    const server = useAuth((s) => s.server);
    const session = useAuth((s) => s.session);
    const profileName = useAuth((s) => s.profileName);
    const profileId = useAuth((s) => s.profileId);
    const clearActiveProfile = useAuth((s) => s.clearActiveProfile);
    const { startNew, resume } = useCart();
    const occupied = useTables((s) => s.occupied);
    const pending = useTables((s) => s.pending);
    const summaries = useTables((s) => s.summaries);
    const refreshTables = useTables((s) => s.refresh);
    const users = useConfig((s) => s.users);
    const tableTick = useRealtime((s) => s.tableTick);
    const [roomId, setRoomId] = useState<number | null>(rooms[0]?.id ?? null);
    const [floorView, setFloorView] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [opening, setOpening] = useState<number | null>(null); // table en cours d'ouverture
    const [moving, setMoving] = useState(false); // transfert/fusion en cours
    const [moveSource, setMoveSource] = useState<Table | null>(null); // choix de cible (vue liste)
    const t = useT();
    const locale = useLocale((s) => s.locale);
    const setLocale = useLocale((s) => s.setLocale);
    const { width } = useWindowDimensions();
    const isTablet = width >= 700; // iPad -> caisse comptoir dédiée dispo

    // Grille de tables : jamais moins de 3 colonnes (rendu téléphone actuel),
    // davantage dès qu'il y a de la place.
    const tableCols = Math.max(3, Math.floor((width - PAD * 2 + GAP) / (TABLE_TARGET + GAP)));
    const tableSize = Math.floor((width - PAD * 2 - GAP * (tableCols - 1)) / tableCols);

    // Changement de profil -> les salles changent : on resélectionne une salle valide
    // du profil courant (évite d'afficher une salle/onglet d'un autre profil).
    useEffect(() => {
        if (!rooms.length) { if (roomId !== null) setRoomId(null); return; }
        if (roomId == null || !rooms.some((r) => r.id === roomId)) setRoomId(rooms[0].id);
    }, [rooms, roomId]);

    const currentRoom = rooms.find((r) => r.id === roomId);
    const tablesOf = useCallback((rid: number) => allTables.filter((t) => t.room_id === rid), [allTables]);
    const tables = useMemo(() => (roomId != null ? tablesOf(roomId) : []), [tablesOf, roomId]);

    // --- Mode d'affichage : grille classique ou plan personnalisé ---
    // Le plan n'est proposé que si la salle a réellement été dessinée dans l'admin.
    const planAvailable = !!currentRoom?.plan_enabled && tables.some((t) => t.pos_x != null);
    const [viewPref, setViewPref] = useState<'grid' | 'plan' | null>(null);
    const [decorations, setDecorations] = useState<RoomDecoration[]>([]);

    useEffect(() => {
        void db.getPref(VIEW_MODE_PREF).then((v) => setViewPref(v === 'plan' || v === 'grid' ? v : null));
    }, []);

    // Sans choix explicite : plan par défaut sur grand écran, grille sur téléphone —
    // un plan à l'échelle d'un iPhone n'apporte rien.
    const planMode = planAvailable && (viewPref ? viewPref === 'plan' : isTablet);

    const toggleViewMode = () => {
        const next = planMode ? 'grid' : 'plan';
        setViewPref(next);
        void db.setPref(VIEW_MODE_PREF, next);
    };

    // Le calque décor est lu à la demande (il ne sert qu'au mode plan).
    useEffect(() => {
        if (roomId == null || !planMode) { setDecorations([]); return; }
        let cancelled = false;
        void db.getDecorations(roomId).then((d) => { if (!cancelled) setDecorations(d); });
        return () => { cancelled = true; };
    }, [roomId, planMode, allTables]);

    const serverColorOf = useCallback(
        (id: number | null) => (id != null ? users.find((u) => u.id === id)?.color ?? null : null),
        [users],
    );

    const tableStateOf = useCallback((tableId: number): TableState => {
        const isOccupied = occupied.includes(tableId);
        const summary = summaries[tableId];
        const openedAt = summary?.openedAt ? Date.parse(summary.openedAt) : NaN;
        return {
            status: isOccupied ? 'occupied' : 'free',
            total: isOccupied ? summary?.total : undefined,
            covers: summary?.covers ?? undefined,
            pending: pending[tableId] ?? 0,
            serverColor: serverColorOf(summary?.serverId ?? null),
            minutes: Number.isNaN(openedAt) ? undefined : Math.floor((Date.now() - openedAt) / 60000),
        };
    }, [occupied, summaries, pending, serverColorOf]);

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

        // Grand écran : même disposition que la caisse comptoir (grille produits +
        // ticket), bien plus efficace qu'un parcours en trois écrans sur un iPad.
        if (isTablet) navigation.navigate('Comptoir', { tableId: table.id, tableLabel: table.label, roomId: table.room_id });
        else navigation.navigate('Pos');
    };

    // Dépôt d'une table sur une autre : transfert si la cible est libre, fusion
    // si elle est occupée. On confirme toujours — c'est une action à conséquence
    // visible en cuisine et sur l'addition.
    const handleDrop = (source: Table, target: Table) => {
        if (moving) return;
        const targetOccupied = occupied.includes(target.id);

        const run = async (kind: 'transfer' | 'merge') => {
            setMoving(true);
            const res = kind === 'transfer'
                ? await transferTable(source, target)
                : await mergeTables(source, target);
            setMoving(false);
            if (!res.ok) Alert.alert('Déplacement impossible', res.reason);
        };

        if (targetOccupied) {
            Alert.alert(
                `Fusionner ${source.label} → ${target.label} ?`,
                `Les articles de la table ${source.label} rejoignent la table ${target.label}. La table ${source.label} sera libérée.`,
                [
                    { text: 'Annuler', style: 'cancel' },
                    { text: 'Fusionner', onPress: () => void run('merge') },
                ],
            );
            return;
        }

        Alert.alert(
            `Transférer ${source.label} → ${target.label} ?`,
            `La commande de la table ${source.label} passe sur la table ${target.label}.`,
            [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Transférer', onPress: () => void run('transfer') },
            ],
        );
    };

    // Vue liste (téléphone) : le glisser-déposer n'a pas de sens, on passe par un
    // menu d'actions sur appui long -> parité fonctionnelle avec le plan.
    const tableActions = (table: Table) => {
        if (!occupied.includes(table.id)) return;
        const targets = tables.filter((t) => t.id !== table.id);
        Alert.alert(`Table ${table.label}`, 'Que voulez-vous faire ?', [
            { text: 'Annuler', style: 'cancel' },
            {
                text: 'Déplacer / fusionner',
                onPress: () => {
                    if (!targets.length) {
                        Alert.alert('Aucune autre table', 'Cette salle ne contient qu\'une table.');
                        return;
                    }
                    setMoveSource(table);
                },
            },
            { text: 'Libérer la table', style: 'destructive', onPress: () => releaseTable(table) },
        ]);
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

    // Comptoir = vente sans table. Sur iPad : caisse dédiée (produits + ticket + pavé
    // Qté/Prix). Sur téléphone : même parcours qu'une table (écran Commande).
    const openComptoir = async () => {
        if (!session || !server) return;
        closeMenu();

        // On REPREND la vente comptoir en cours s'il y en a une. Sans ça, un
        // aller-retour par la salle repartait de zéro et le ticket saisi était
        // perdu — une vente sans table n'est rattrapable par aucun autre écran.
        const current = useCart.getState().order;
        const enCours = current && current.table_id === null && ['open', 'sent'].includes(current.status)
            ? current
            : await db.getOpenCounterOrder(session.id, profileId);

        if (enCours) resume(enCours);
        else startNew({ sessionId: session.id, serverId: server.id, roomId: null, tableId: null, serviceType: 'dine_in' });

        if (isTablet) navigation.navigate('Comptoir');
        else navigation.navigate('Pos');
    };

    const renderTable = (t: Table) => {
        const isOccupied = occupied.includes(t.id);
        const pendingCount = pending[t.id] ?? 0; // articles pas encore envoyés en cuisine
        return (
            <View key={t.id} style={[styles.tableWrap, { width: tableSize, height: tableSize }]}>
                <Pressable
                    onPress={() => openTable(t)}
                    onLongPress={() => tableActions(t)}
                    delayLongPress={600}
                    style={({ pressed }) => [styles.table, { width: tableSize, height: tableSize }, isOccupied ? styles.tableOccupied : styles.tableFree, pressed && styles.tablePressed]}
                >
                    {opening === t.id
                        ? <ActivityIndicator color={isOccupied ? '#06281b' : theme.colors.primary} />
                        : <Text style={[styles.tableLabel, { fontSize: Math.max(20, tableSize * 0.34) }, isOccupied && styles.tableLabelOccupied]}>{t.label}</Text>}
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
                <View style={styles.topRight}>
                    <SyncBadge />
                    <Pressable onPress={() => setMenuOpen(true)} style={styles.menuBtn} hitSlop={10}>
                        <MenuIcon color={theme.colors.text} size={30} strokeWidth={2.5} />
                    </Pressable>
                </View>
            </View>

            {/* Onglets salles (masqués en vue étage) : chaque onglet = largeur de son
                texte, défilement horizontal -> les noms complets sont toujours lisibles
                (utile pour Event qui a beaucoup de salles). */}
            {!floorView && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsContent}>
                    {rooms.map((r) => (
                        <Pressable key={r.id} onPress={() => setRoomId(r.id)} style={[styles.tab, roomId === r.id && styles.tabActive]}>
                            <Text style={[styles.tabText, roomId === r.id && styles.tabTextActive]}>{r.name}</Text>
                        </Pressable>
                    ))}
                </ScrollView>
            )}

            {floorView ? (
                /* Vue étage : toutes les salles + leurs tables */
                <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing(4) }}>
                    {rooms.map((r) => (
                        <View key={r.id} style={styles.floorSection}>
                            <Text style={styles.floorRoomName}>{r.name}</Text>
                            <View style={styles.grid}>
                                {tablesOf(r.id).map(renderTable)}
                                {!tablesOf(r.id).length && <Text style={styles.empty}>{t('Aucune table.')}</Text>}
                            </View>
                        </View>
                    ))}
                </ScrollView>
            ) : planMode && currentRoom ? (
                /* Vue plan : disposition réelle de la salle (iPad en priorité) */
                <RoomPlan
                    room={currentRoom}
                    tables={tables}
                    decorations={decorations}
                    stateOf={tableStateOf}
                    onPressTable={openTable}
                    onLongPressTable={tableActions}
                    onDropTable={handleDrop}
                />
            ) : (
                /* Vue liste : PAS d'image de fond. Une photo derrière une grille de
                   tuiles n'apporte aucune information et nuit à la lisibilité des
                   états — l'image n'a de sens que sur le plan, où elle situe. */
                <View style={styles.bg}>
                    <ScrollView contentContainerStyle={styles.grid}>
                        {tables.map(renderTable)}
                        {!tables.length && <Text style={styles.empty}>{t('Aucune table dans cette salle.')}</Text>}
                    </ScrollView>
                </View>
            )}

            {/* Choix de la table de destination (vue liste, sans glisser-déposer) */}
            <Modal visible={moveSource !== null} transparent animationType="fade" onRequestClose={() => setMoveSource(null)}>
                <Pressable style={styles.menuBackdrop} onPress={() => setMoveSource(null)}>
                    <View style={styles.pickerSheet}>
                        <Text style={styles.pickerTitle}>{t('Table')} {moveSource?.label} →</Text>
                        <Text style={styles.pickerHint}>
                            {t('Une table libre = transfert. Une table occupée = fusion.')}
                        </Text>
                        <ScrollView contentContainerStyle={styles.pickerGrid}>
                            {tables.filter((t) => t.id !== moveSource?.id).map((t) => {
                                const busy = occupied.includes(t.id);
                                return (
                                    <Pressable
                                        key={t.id}
                                        style={[styles.pickerTable, busy && styles.pickerTableBusy]}
                                        onPress={() => {
                                            const src = moveSource;
                                            setMoveSource(null);
                                            if (src) handleDrop(src, t);
                                        }}
                                    >
                                        <Text style={[styles.pickerTableText, busy && styles.pickerTableTextBusy]}>{t.label}</Text>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    </View>
                </Pressable>
            </Modal>

            {/* Menu déroulant */}
            <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
                <Pressable style={styles.menuBackdrop} onPress={closeMenu}>
                    <View style={styles.menu}>
                        <Pressable style={styles.menuItem} onPress={() => void openComptoir()}>
                            <ShoppingBag color={theme.colors.text} size={20} />
                            <Text style={styles.menuText}>{t('Comptoir')}</Text>
                        </Pressable>
                        {server?.role === 'admin' && (
                            <Pressable style={styles.menuItem} onPress={() => { closeMenu(); navigation.navigate('CloseSession'); }}>
                                <Wallet color={theme.colors.text} size={20} />
                                <Text style={styles.menuText}>{t('Fermer la caisse')}</Text>
                            </Pressable>
                        )}
                        {planAvailable && !floorView && (
                            <Pressable style={styles.menuItem} onPress={() => { toggleViewMode(); closeMenu(); }}>
                                <MapIcon color={theme.colors.text} size={20} />
                                <Text style={styles.menuText}>{planMode ? t('Vue liste') : t('Vue plan')}</Text>
                            </Pressable>
                        )}
                        <Pressable style={styles.menuItem} onPress={() => { setFloorView((v) => !v); closeMenu(); }}>
                            <LayoutGrid color={theme.colors.text} size={20} />
                            <Text style={styles.menuText}>{floorView ? t('Vue par salle') : t('Vue étage')}</Text>
                        </Pressable>
                        <Pressable
                            style={styles.menuItem}
                            onPress={() => {
                                const i = LOCALES.findIndex((l) => l.value === locale);
                                void setLocale(LOCALES[(i + 1) % LOCALES.length].value);
                            }}
                        >
                            <Languages color={theme.colors.text} size={20} />
                            <Text style={styles.menuText}>
                                {t('Langue')} · {LOCALES.find((l) => l.value === locale)?.label}
                            </Text>
                        </Pressable>
                        <Pressable style={styles.menuItem} onPress={changeProfile}>
                            <Repeat color={theme.colors.text} size={20} />
                            <Text style={styles.menuText}>{t('Changer de profil')}{profileName ? ` (${profileName})` : ''}</Text>
                        </Pressable>
                        <Pressable style={styles.menuItem} onPress={() => { closeMenu(); navigation.reset({ index: 0, routes: [{ name: 'Unlock' }] }); }}>
                            <Lock color={theme.colors.text} size={20} />
                            <Text style={styles.menuText}>{t('Verrouiller')}</Text>
                        </Pressable>
                    </View>
                </Pressable>
            </Modal>
        </Screen>
    );
}

const styles = StyleSheet.create({
    topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing(3) },
    topRight: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(2.5) },
    server: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
    menuBtn: { padding: theme.spacing(2), borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt },
    tabs: { flexGrow: 0, marginBottom: theme.spacing(4) },
    tabsContent: { gap: GAP, paddingRight: theme.spacing(2) },
    tab: { paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3.5), borderRadius: theme.radius.md, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
    tabActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    tabText: { color: theme.colors.textMuted, fontWeight: '700', fontSize: 15 },
    tabTextActive: { color: theme.colors.onPrimary },
    bg: { flex: 1 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingBottom: theme.spacing(4) },
    // Conteneur d'une tuile (pour ancrer le badge qui déborde du coin).
    tableWrap: {},
    // 3 grandes tables carrées par ligne (taille calculée pour remplir la largeur).
    table: {
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
    tableFree: { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong },
    tableOccupied: { backgroundColor: theme.colors.success, borderColor: theme.colors.success },
    tablePressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
    tableLabel: { color: theme.colors.text, fontWeight: '800' },
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
    // Sélecteur de table de destination (vue liste)
    pickerSheet: {
        position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '70%',
        backgroundColor: theme.colors.surfaceAlt, borderTopLeftRadius: theme.radius.lg,
        borderTopRightRadius: theme.radius.lg, padding: theme.spacing(4),
    },
    pickerTitle: { color: theme.colors.text, fontSize: 19, fontWeight: '800' },
    pickerHint: { color: theme.colors.textMuted, fontSize: 13, marginTop: theme.spacing(1), marginBottom: theme.spacing(4) },
    pickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingBottom: theme.spacing(6) },
    pickerTable: {
        width: 76, height: 76, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center',
        backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.border,
    },
    pickerTableBusy: { backgroundColor: theme.colors.success, borderColor: theme.colors.success },
    pickerTableText: { color: theme.colors.text, fontSize: 22, fontWeight: '800' },
    pickerTableTextBusy: { color: '#06281b' },
});
