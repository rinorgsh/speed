import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import type { Room, RoomDecoration, Table } from '../types';

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
                            resizeMode="cover"
                        />
                    )}

                    {/* Décor : purement visuel, non cliquable. */}
                    {decorations.map((d) => (
                        <View
                            key={`d${d.id}`}
                            pointerEvents="none"
                            style={[
                                styles.decor,
                                d.kind === 'plant' && styles.decorRound,
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
                        </View>
                    ))}

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
                            ? 'Glissez sur une autre table…'
                            : stateOf(dropTargetId).status === 'occupied'
                                ? `Fusionner avec la table ${tables.find((t) => t.id === dropTargetId)?.label}`
                                : `Transférer vers la table ${tables.find((t) => t.id === dropTargetId)?.label}`}
                    </Text>
                </View>
            )}

            {dragTableId == null && transformed && (
                <Pressable style={styles.recenter} onPress={recenter}>
                    <Text style={styles.recenterText}>Recentrer</Text>
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
    decorLabel: { color: theme.colors.textFaint, fontWeight: '700' },
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
