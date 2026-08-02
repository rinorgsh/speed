import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { DoorOpen, MoveVertical, Trees, Wine } from 'lucide-react-native';
import { theme } from '../theme';
import { useT } from '../i18n';
import type { DecorationKind, Room, RoomDecoration, Table } from '../types';

/**
 * Rendu du plan de salle personnalisé (mode « plan »).
 *
 * Les coordonnées viennent du serveur en UNITÉS DE GRILLE sur le canevas de la
 * salle : on applique un seul facteur d'échelle, donc le plan est identique
 * partout (iPhone, iPad, admin web) sans recalcul de mise en page.
 *
 * Le déplacement/zoom utilise PanResponder (inclus dans React Native) plutôt
 * qu'un module natif : tout reste livrable par mise à jour OTA.
 */

export interface TableState {
    status: 'free' | 'occupied';
    total?: number;
    covers?: number;
    /** Articles saisis mais pas encore envoyés en cuisine. */
    pending?: number;
    serverColor?: string | null;
    /** Minutes écoulées depuis l'ouverture de la commande. */
    minutes?: number;
}

interface Props {
    room: Room;
    tables: Table[];
    decorations: RoomDecoration[];
    stateOf: (tableId: number) => TableState;
    onPressTable: (table: Table) => void;
    onLongPressTable?: (table: Table) => void;
    /**
     * Une table occupée a été déposée sur une autre : transfert si la cible est
     * libre, fusion si elle est occupée. Le parent confirme et exécute.
     */
    onDropTable?: (source: Table, target: Table) => void;
    /** Seuil d'alerte sur la durée d'occupation (minutes). */
    slowAfterMinutes?: number;
}

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;

/**
 * Distance entre le bord d'une table et le centre de ses chaises, en unités de
 * grille. Même valeur que l'éditeur de l'admin : le plan doit se lire pareil des
 * deux côtés, sinon un plan dessiné serré paraît aéré en salle (et l'inverse).
 */
const SEAT_OFFSET = 14;
const SEAT_SIZE = 12;
/** Marge du calque des chaises autour de la table (offset + rayon d'une chaise). */
const SEAT_PAD = SEAT_OFFSET + SEAT_SIZE / 2;

/**
 * Position des chaises autour d'une table, en unités de grille, repérées depuis
 * le coin haut-gauche de la table (valeurs négatives = au-dessus / à gauche).
 */
function seatDots(table: Table): { x: number; y: number }[] {
    const dots: { x: number; y: number }[] = [];
    const n = Math.min(table.seats ?? 0, 20);
    if (n <= 0) return dots;

    if (table.shape === 'round') {
        const rx = table.width / 2 + SEAT_OFFSET;
        const ry = table.height / 2 + SEAT_OFFSET;
        for (let i = 0; i < n; i++) {
            const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
            dots.push({
                x: table.width / 2 + Math.cos(angle) * rx,
                y: table.height / 2 + Math.sin(angle) * ry,
            });
        }
        return dots;
    }

    // Formes droites : réparties en haut et en bas, comme dans l'éditeur.
    const top = Math.ceil(n / 2);
    const bottom = n - top;
    for (let i = 0; i < top; i++) dots.push({ x: (table.width * (i + 1)) / (top + 1), y: -SEAT_OFFSET });
    for (let i = 0; i < bottom; i++) {
        dots.push({ x: (table.width * (i + 1)) / (bottom + 1), y: table.height + SEAT_OFFSET });
    }

    return dots;
}

/** Icône du décor : un mur, un bar et un escalier doivent se distinguer d'un coup d'œil. */
const DECOR_ICONS: Partial<Record<DecorationKind, typeof Wine>> = {
    bar: Wine,
    door: DoorOpen,
    plant: Trees,
    stairs: MoveVertical,
};

export function RoomPlan({
    room,
    tables,
    decorations,
    stateOf,
    onPressTable,
    onLongPressTable,
    onDropTable,
    slowAfterMinutes = 90,
}: Props) {
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    // Déplacement et zoom pilotés par des valeurs ANIMÉES, appliquées sur le
    // thread natif : un geste ne redessine plus les 28 tables + l'image à chaque
    // frame, il ne fait que déplacer une couche déjà composée par le GPU.
    const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
    const zoomValue = useRef(new Animated.Value(1)).current;
    // Copies lisibles en JS : le test de survol pendant un glisser en a besoin.
    const live = useRef({ x: 0, y: 0, zoom: 1 });
    // Sert uniquement à afficher « Recentrer ». Passé par une ref pour ne
    // déclencher QU'UN SEUL rendu au premier geste — un setState par frame
    // réintroduirait exactement le coût qu'on vient de supprimer.
    const [transformed, setTransformed] = useState(false);
    const transformedRef = useRef(false);
    const markTransformed = () => {
        if (transformedRef.current) return;
        transformedRef.current = true;
        setTransformed(true);
    };
    // Table « soulevée » par un appui long, en attente d'être déposée.
    const [dragTableId, setDragTableId] = useState<number | null>(null);
    const [dropTargetId, setDropTargetId] = useState<number | null>(null);
    // Nommé `tr` et non `t` : les boucles de ce composant utilisent déjà `t`
    // pour la table courante, un même nom masquerait la traduction.
    const tr = useT();

    // Échelle de base : le plan entier tient dans la zone disponible, SANS
    // manipulation. C'est l'état normal — le zoom n'est qu'une échappatoire.
    const baseScale = useMemo(() => {
        if (!viewport.width || !viewport.height) return 0;
        return Math.min(viewport.width / room.plan_width, viewport.height / room.plan_height);
    }, [viewport, room.plan_width, room.plan_height]);

    // La mise en page est figée à l'échelle de base : le zoom ne provoque donc
    // aucun recalcul de largeurs/hauteurs, juste une mise à l'échelle GPU.
    const px = (units: number) => units * baseScale;

    useEffect(() => {
        const a = pan.x.addListener(({ value }) => { live.current.x = value; });
        const b = pan.y.addListener(({ value }) => { live.current.y = value; });
        const c = zoomValue.addListener(({ value }) => { live.current.zoom = value; });
        return () => { pan.x.removeListener(a); pan.y.removeListener(b); zoomValue.removeListener(c); };
    }, [pan, zoomValue]);

    // Le PanResponder est créé une seule fois : il lit l'état courant via des refs
    // pour ne pas travailler sur des valeurs figées à la création.
    const containerRef = useRef<View>(null);
    const originRef = useRef({ x: 0, y: 0 }); // position du conteneur dans la fenêtre
    const stateRef = useRef({ baseScale, tables, dragTableId });
    stateRef.current = { baseScale, tables, dragTableId };

    /**
     * Table située sous un point de l'écran. L'origine de la transformation est
     * fixée en haut à gauche (transformOrigin), la conversion reste donc une
     * simple soustraction puis division.
     */
    const tableAt = (pageX: number, pageY: number): Table | null => {
        const { baseScale: bs, tables: list } = stateRef.current;
        const sc = bs * live.current.zoom;
        if (!sc) return null;
        const x = (pageX - originRef.current.x - live.current.x) / sc;
        const y = (pageY - originRef.current.y - live.current.y) / sc;
        for (const t of list) {
            if (t.pos_x == null || t.pos_y == null) continue;
            if (x >= t.pos_x && x <= t.pos_x + t.width && y >= t.pos_y && y <= t.pos_y + t.height) {
                return t;
            }
        }
        return null;
    };

    const gesture = useRef({ startX: 0, startY: 0, startZoom: 1, startDistance: 0 });
    const panResponder = useMemo(
        () =>
            PanResponder.create({
                // Une table soulevée prend la main immédiatement, avant la table
                // elle-même : sinon le geste resterait piégé dans le Pressable.
                onStartShouldSetPanResponderCapture: () => stateRef.current.dragTableId != null,
                onMoveShouldSetPanResponderCapture: () => stateRef.current.dragTableId != null,
                // Sinon on ne capture qu'à partir d'un vrai mouvement : un simple
                // appui doit rester disponible pour la table en dessous.
                onMoveShouldSetPanResponder: (e, g) =>
                    Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6 || e.nativeEvent.touches.length > 1,
                onPanResponderGrant: () => {
                    gesture.current.startX = live.current.x;
                    gesture.current.startY = live.current.y;
                    gesture.current.startZoom = live.current.zoom;
                    gesture.current.startDistance = 0;
                },
                onPanResponderMove: (e, g) => {
                    // Mode déplacement de table : on surligne la cible survolée.
                    if (stateRef.current.dragTableId != null) {
                        const over = tableAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
                        setDropTargetId(over && over.id !== stateRef.current.dragTableId ? over.id : null);
                        return;
                    }

                    const touches = e.nativeEvent.touches;
                    if (touches.length >= 2) {
                        const [a, b] = touches;
                        const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
                        if (!gesture.current.startDistance) {
                            gesture.current.startDistance = distance;
                            return;
                        }
                        const next = gesture.current.startZoom * (distance / gesture.current.startDistance);
                        zoomValue.setValue(Math.min(Math.max(next, MIN_ZOOM), MAX_ZOOM));
                        markTransformed();
                        return;
                    }
                    pan.setValue({
                        x: gesture.current.startX + g.dx,
                        y: gesture.current.startY + g.dy,
                    });
                    markTransformed();
                },
                onPanResponderRelease: (e) => {
                    const sourceId = stateRef.current.dragTableId;
                    if (sourceId == null) return;
                    const source = stateRef.current.tables.find((t) => t.id === sourceId);
                    const target = tableAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
                    setDragTableId(null);
                    setDropTargetId(null);
                    if (source && target && target.id !== source.id) {
                        onDropTable?.(source, target);
                    }
                },
                onPanResponderTerminate: () => {
                    setDragTableId(null);
                    setDropTargetId(null);
                },
            }),
        [onDropTable],
    );

    const recenter = () => {
        Animated.parallel([
            Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true, friction: 9 }),
            Animated.spring(zoomValue, { toValue: 1, useNativeDriver: true, friction: 9 }),
        ]).start(() => { transformedRef.current = false; setTransformed(false); });
    };

    const planStyle = {
        width: px(room.plan_width),
        height: px(room.plan_height),
        // Origine en haut à gauche : le zoom ne décale pas le plan, et la
        // conversion écran -> plan reste triviale pour le test de survol.
        transformOrigin: 'top left' as const,
        transform: [
            { translateX: pan.x },
            { translateY: pan.y },
            { scale: zoomValue },
        ],
    };

    return (
        <View
            ref={containerRef}
            style={styles.viewport}
            onLayout={(e) => {
                setViewport({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
                // Origine dans la fenêtre : sert au test de survol pendant un déplacement.
                containerRef.current?.measureInWindow((x, y) => { originRef.current = { x, y }; });
            }}
            {...panResponder.panHandlers}
        >
            {baseScale > 0 && (
                <Animated.View style={[styles.plan, planStyle]}>
                    {room.background_image_url && (
                        <Image
                            source={{ uri: room.background_image_url }}
                            style={[StyleSheet.absoluteFill, { opacity: room.background_opacity / 100 }]}
                            // Jamais de recadrage : masquer une partie de la salle
                            // induirait le serveur en erreur.
                            resizeMode="contain"
                        />
                    )}

                    {/* Décor : purement visuel, non cliquable. */}
                    {decorations.map((d) => {
                        const Icon = DECOR_ICONS[d.kind];
                        const iconSize = Math.max(10, Math.min(px(d.width), px(d.height)) * 0.5);

                        return (
                            <View
                                key={`d${d.id}`}
                                pointerEvents="none"
                                style={[
                                    styles.decor,
                                    // Chaque type a sa signature visuelle : un mur plein, une
                                    // porte en pointillés, une plante ronde. Sans ça tout le
                                    // décor se ressemble et n'aide plus à se repérer.
                                    d.kind === 'wall' && styles.decorWall,
                                    d.kind === 'door' && styles.decorDoor,
                                    d.kind === 'plant' && styles.decorRound,
                                    d.kind === 'text' && styles.decorText,
                                    {
                                        left: px(d.pos_x),
                                        top: px(d.pos_y),
                                        width: px(d.width),
                                        height: px(d.height),
                                        transform: [{ rotate: `${d.rotation}deg` }],
                                    },
                                ]}
                            >
                                {d.kind === 'text' && !!d.label && (
                                    <Text style={[styles.decorLabel, { fontSize: Math.max(9, px(d.height) * 0.4) }]} numberOfLines={1}>
                                        {d.label}
                                    </Text>
                                )}
                                {!!Icon && <Icon color={theme.colors.textFaint} size={iconSize} />}
                            </View>
                        );
                    })}

                    {/* Chaises : posées SOUS les tables, sur un calque qui déborde de la
                        table de SEAT_PAD de chaque côté — un débordement d'enfant est
                        rogné sur Android, un calque plus grand ne l'est jamais. */}
                    {tables.map((t) => {
                        if (t.pos_x == null || t.pos_y == null) return null;
                        const dots = seatDots(t);
                        if (!dots.length) return null;

                        return (
                            <View
                                key={`s${t.id}`}
                                pointerEvents="none"
                                style={{
                                    position: 'absolute',
                                    // Inflation symétrique : le centre ne bouge pas, la
                                    // rotation de la table reste donc valable telle quelle.
                                    left: px(t.pos_x - SEAT_PAD),
                                    top: px(t.pos_y - SEAT_PAD),
                                    width: px(t.width + SEAT_PAD * 2),
                                    height: px(t.height + SEAT_PAD * 2),
                                    transform: [{ rotate: `${t.rotation}deg` }],
                                }}
                            >
                                {dots.map((dot, i) => (
                                    <View
                                        key={i}
                                        style={[
                                            styles.seat,
                                            {
                                                left: px(dot.x + SEAT_PAD - SEAT_SIZE / 2),
                                                top: px(dot.y + SEAT_PAD - SEAT_SIZE / 2),
                                                width: px(SEAT_SIZE),
                                                height: px(SEAT_SIZE),
                                                borderRadius: px(SEAT_SIZE) / 2,
                                            },
                                        ]}
                                    />
                                ))}
                            </View>
                        );
                    })}

                    {tables.map((t) => {
                        const posX = t.pos_x;
                        const posY = t.pos_y;
                        // Table jamais placée sur le plan : on ne l'affiche pas ici
                        // (elle reste accessible en vue liste).
                        if (posX == null || posY == null) return null;
                        const st = stateOf(t.id);
                        const occupied = st.status === 'occupied';
                        const slow = occupied && (st.minutes ?? 0) >= slowAfterMinutes;
                        const labelSize = Math.max(11, px(t.height) * 0.26);
                        const lifted = dragTableId === t.id;
                        const isDropTarget = dropTargetId === t.id;

                        return (
                            <Pressable
                                key={`t${t.id}`}
                                onPress={() => onPressTable(t)}
                                onLongPress={() => {
                                    // Table occupée + déplacement possible : appui long =
                                    // « soulever » pour transférer/fusionner. Sinon on
                                    // retombe sur l'action longue habituelle (libérer).
                                    if (occupied && onDropTable) setDragTableId(t.id);
                                    else onLongPressTable?.(t);
                                }}
                                delayLongPress={400}
                                style={({ pressed }) => [
                                    styles.table,
                                    isRound(t.shape) ? { borderRadius: px(Math.min(t.width, t.height)) / 2 } : styles.tableSquare,
                                    occupied ? styles.tableOccupied : styles.tableFree,
                                    slow && styles.tableSlow,
                                    lifted && styles.tableLifted,
                                    isDropTarget && styles.tableDropTarget,
                                    pressed && styles.tablePressed,
                                    {
                                        left: px(posX),
                                        top: px(posY),
                                        width: px(t.width),
                                        height: px(t.height),
                                        transform: [{ rotate: `${t.rotation}deg` }],
                                    },
                                ]}
                            >
                                <Text style={[styles.tableLabel, occupied && styles.tableLabelOccupied, { fontSize: labelSize }]} numberOfLines={1}>
                                    {t.label}
                                </Text>
                                {occupied && st.total != null && (
                                    <Text style={[styles.tableTotal, { fontSize: labelSize * 0.7 }]} numberOfLines={1}>
                                        {st.total.toFixed(2)}
                                    </Text>
                                )}

                                {/* Pastille du serveur affecté. */}
                                {occupied && !!st.serverColor && (
                                    <View style={[styles.serverDot, { backgroundColor: st.serverColor }]} />
                                )}
                                {/* Articles pas encore envoyés en cuisine. */}
                                {!!st.pending && (
                                    <View style={styles.pendingBadge}>
                                        <Text style={styles.pendingText}>{st.pending}</Text>
                                    </View>
                                )}
                            </Pressable>
                        );
                    })}
                </Animated.View>
            )}

            {/* Bandeau d'aide pendant un déplacement : on annonce l'action à venir. */}
            {dragTableId != null && (
                <View style={styles.dragHint} pointerEvents="none">
                    <Text style={styles.dragHintText}>
                        {dropTargetId == null
                            ? tr('Glissez sur une autre table…')
                            : stateOf(dropTargetId).status === 'occupied'
                                ? tr('Fusionner avec la table :label', { label: tables.find((x) => x.id === dropTargetId)?.label ?? '' })
                                : tr('Transférer vers la table :label', { label: tables.find((x) => x.id === dropTargetId)?.label ?? '' })}
                    </Text>
                </View>
            )}

            {dragTableId == null && transformed && (
                <Pressable style={styles.recenter} onPress={recenter}>
                    <Text style={styles.recenterText}>{tr('Recentrer')}</Text>
                </Pressable>
            )}
        </View>
    );
}

const isRound = (shape: Table['shape']) => shape === 'round' || shape === 'bar';

const styles = StyleSheet.create({
    viewport: { flex: 1, overflow: 'hidden' },
    plan: { position: 'relative' },
    decor: {
        position: 'absolute',
        backgroundColor: 'rgba(255,255,255,0.07)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.14)',
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    decorRound: { borderRadius: 999 },
    // Un mur est une masse pleine : c'est ce qui donne sa forme à la salle.
    decorWall: { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.24)', borderRadius: 2 },
    // Une porte est une ouverture : trait discontinu, presque pas de remplissage.
    decorDoor: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.35)' },
    // Un simple libellé (« Terrasse ») n'a pas à ressembler à un objet.
    decorText: { backgroundColor: 'transparent', borderWidth: 0 },
    decorLabel: { color: theme.colors.textFaint, fontWeight: '700' },
    // Chaise : repère de capacité, volontairement effacé face aux tables.
    seat: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.16)' },
    table: {
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
    },
    tableSquare: { borderRadius: theme.radius.md },
    tableFree: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
    tableOccupied: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    tableSlow: { borderColor: theme.colors.warning, borderWidth: 3 },
    // Table soulevée en vue d'un transfert/fusion.
    tableLifted: { opacity: 0.55, borderColor: theme.colors.warning, borderWidth: 3 },
    // Table survolée : c'est elle qui recevra la commande.
    tableDropTarget: { borderColor: theme.colors.warning, borderWidth: 4 },
    tablePressed: { opacity: 0.7 },
    tableLabel: { color: theme.colors.text, fontWeight: '800' },
    tableLabelOccupied: { color: theme.colors.onPrimary },
    tableTotal: { color: theme.colors.onPrimary, fontWeight: '700', marginTop: 1 },
    serverDot: {
        position: 'absolute', top: 4, left: 4, width: 10, height: 10, borderRadius: 5,
    },
    pendingBadge: {
        position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10,
        backgroundColor: theme.colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
    },
    pendingText: { color: '#fff', fontSize: 11, fontWeight: '800' },
    recenter: {
        position: 'absolute', right: theme.spacing(3), bottom: theme.spacing(3),
        backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.pill,
        paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2.5),
        borderWidth: 1, borderColor: theme.colors.border,
    },
    recenterText: { color: theme.colors.text, fontWeight: '700', fontSize: 13 },
    dragHint: {
        position: 'absolute', left: theme.spacing(3), right: theme.spacing(3), bottom: theme.spacing(3),
        backgroundColor: theme.colors.warning, borderRadius: theme.radius.md,
        paddingVertical: theme.spacing(3), paddingHorizontal: theme.spacing(4), alignItems: 'center',
    },
    dragHintText: { color: '#1a1200', fontWeight: '800', fontSize: 15 },
});
