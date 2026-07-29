import * as SQLite from 'expo-sqlite';
import type {
    BootstrapPayload,
    Category,
    OptionGroup,
    Order,
    OrderLine,
    PosSession,
    PrepStation,
    Printer,
    Product,
    RealtimeConfig,
    Room,
    RoomDecoration,
    Table,
    TableSummary,
    Tax,
    User,
} from '../types';

// Clé interne (dans cache_settings) pour la config temps réel du serveur.
const REALTIME_KEY = '__realtime';

/**
 * Cache local SQLite (offline-first). La config (menu, salles, TVA, options,
 * imprimantes) est mise en cache via importBootstrap. Les commandes/lignes sont
 * persistées localement et rejouées vers l'API (outbox, colonne synced).
 */
let db: SQLite.SQLiteDatabase | null = null;

export async function openDb(): Promise<SQLite.SQLiteDatabase> {
    if (db) return db;
    db = await SQLite.openDatabaseAsync('pos.db');
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    await migrate(db);
    return db;
}

function getDb(): SQLite.SQLiteDatabase {
    if (!db) throw new Error('DB non ouverte : appeler openDb() au démarrage.');
    return db;
}

async function migrate(d: SQLite.SQLiteDatabase): Promise<void> {
    await d.execAsync(`
    CREATE TABLE IF NOT EXISTS cache_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, role TEXT, active INTEGER, color TEXT, pin_hash TEXT);
    CREATE TABLE IF NOT EXISTS taxes (id INTEGER PRIMARY KEY, name TEXT, rate REAL);
    CREATE TABLE IF NOT EXISTS printers (id INTEGER PRIMARY KEY, name TEXT, ip_address TEXT, port INTEGER, role TEXT, active INTEGER);
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY, name TEXT, sort_order INTEGER, background_image_url TEXT,
      plan_enabled INTEGER DEFAULT 0, plan_width INTEGER DEFAULT 1000, plan_height INTEGER DEFAULT 700,
      background_opacity INTEGER DEFAULT 35
    );
    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY, room_id INTEGER, label TEXT, sort_order INTEGER,
      pos_x INTEGER, pos_y INTEGER, width INTEGER DEFAULT 90, height INTEGER DEFAULT 90,
      rotation INTEGER DEFAULT 0, shape TEXT DEFAULT 'round', seats INTEGER DEFAULT 4
    );
    CREATE TABLE IF NOT EXISTS room_decorations (
      id INTEGER PRIMARY KEY, room_id INTEGER, kind TEXT, label TEXT,
      pos_x INTEGER, pos_y INTEGER, width INTEGER, height INTEGER, rotation INTEGER
    );
    CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, parent_id INTEGER, name TEXT, color TEXT, sort_order INTEGER, printer_id INTEGER, station_id INTEGER);
    CREATE TABLE IF NOT EXISTS prep_stations (
      id INTEGER PRIMARY KEY, name TEXT, mode TEXT, printer_id INTEGER, fallback_printer_id INTEGER, sort_order INTEGER
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY, category_id INTEGER, name TEXT, price REAL, tax_id INTEGER, tax_takeaway_id INTEGER,
      price_includes_tax INTEGER, color TEXT, available INTEGER, is_open_price INTEGER, sort_order INTEGER,
      image_url TEXT, option_group_ids TEXT
    );
    CREATE TABLE IF NOT EXISTS option_groups (id INTEGER PRIMARY KEY, name TEXT, min_select INTEGER, max_select INTEGER, required INTEGER, options TEXT);
    CREATE TABLE IF NOT EXISTS pos_session (id INTEGER PRIMARY KEY, status TEXT, opened_by INTEGER, opened_at TEXT, opening_cash REAL, closed_by INTEGER, closed_at TEXT, closing_cash REAL);
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, profile_id INTEGER, ticket_number INTEGER, version INTEGER DEFAULT 0, session_id INTEGER, room_id INTEGER, table_id INTEGER, server_id INTEGER,
      status TEXT, merged_into TEXT, service_type TEXT, covers INTEGER, subtotal REAL, tax_total REAL, total REAL,
      discount_type TEXT, discount_value REAL, discount_amount REAL DEFAULT 0, discount_reason TEXT, discount_by INTEGER,
      opened_at TEXT, paid_at TEXT, payments TEXT, synced INTEGER DEFAULT 0, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS order_lines (
      id TEXT PRIMARY KEY, order_id TEXT, product_id INTEGER, name_snapshot TEXT, qty REAL,
      unit_price_snapshot REAL, tax_rate_snapshot REAL, price_includes_tax_snapshot INTEGER,
      options_snapshot TEXT, note TEXT, line_total REAL, sent_at TEXT, sent_qty REAL DEFAULT 0,
      voided INTEGER DEFAULT 0, void_reason TEXT, voided_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    -- Préférences LOCALES à l'appareil (jamais vidées par la synchro).
    CREATE TABLE IF NOT EXISTS device_prefs (key TEXT PRIMARY KEY, value TEXT);
  `);
    // Colonnes ajoutées après coup : ignore l'erreur si elles existent déjà.
    await d.execAsync('ALTER TABLE order_lines ADD COLUMN sent_qty REAL DEFAULT 0').catch(() => {});
    await d.execAsync('ALTER TABLE orders ADD COLUMN profile_id INTEGER').catch(() => {});
    await d.execAsync('ALTER TABLE orders ADD COLUMN ticket_number INTEGER').catch(() => {});
    await d.execAsync('ALTER TABLE orders ADD COLUMN version INTEGER DEFAULT 0').catch(() => {});
    // Plan de salle : colonnes ajoutées aux installations existantes.
    for (const sql of [
        'ALTER TABLE rooms ADD COLUMN plan_enabled INTEGER DEFAULT 0',
        'ALTER TABLE rooms ADD COLUMN plan_width INTEGER DEFAULT 1000',
        'ALTER TABLE rooms ADD COLUMN plan_height INTEGER DEFAULT 700',
        'ALTER TABLE rooms ADD COLUMN background_opacity INTEGER DEFAULT 35',
        'ALTER TABLE tables ADD COLUMN pos_x INTEGER',
        'ALTER TABLE tables ADD COLUMN pos_y INTEGER',
        'ALTER TABLE tables ADD COLUMN width INTEGER DEFAULT 90',
        'ALTER TABLE tables ADD COLUMN height INTEGER DEFAULT 90',
        'ALTER TABLE tables ADD COLUMN rotation INTEGER DEFAULT 0',
        "ALTER TABLE tables ADD COLUMN shape TEXT DEFAULT 'round'",
        'ALTER TABLE tables ADD COLUMN seats INTEGER DEFAULT 4',
        // Fusion de tables : sans cette colonne, l'outbox perdrait le lien avant l'envoi.
        'ALTER TABLE orders ADD COLUMN merged_into TEXT',
        // Remise sur l'addition.
        'ALTER TABLE orders ADD COLUMN discount_type TEXT',
        'ALTER TABLE orders ADD COLUMN discount_value REAL',
        'ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0',
        'ALTER TABLE orders ADD COLUMN discount_reason TEXT',
        'ALTER TABLE orders ADD COLUMN discount_by INTEGER',
        // Postes de préparation (routage cuisine papier/écran).
        'ALTER TABLE categories ADD COLUMN station_id INTEGER',
    ]) {
        await d.execAsync(sql).catch(() => {});
    }
}

// --- Import de la config (bootstrap) ---

/**
 * Refuse un payload inexploitable AVANT de toucher au cache. L'import commence
 * par un DELETE de toutes les tables de config : sans ce garde-fou, une réponse
 * tronquée/inattendue vide le cache et l'appareil se retrouve sans carte ni
 * serveurs (écran « Aucun serveur »), y compris hors-ligne.
 */
function assertUsableBootstrap(payload: BootstrapPayload): void {
    const lists: (keyof BootstrapPayload)[] = ['users', 'taxes', 'printers', 'rooms', 'categories', 'products', 'option_groups'];
    for (const key of lists) {
        if (!Array.isArray(payload[key])) {
            throw new Error(`Réponse serveur incomplète (« ${String(key)} » manquant).`);
        }
    }
    if (!payload.settings || typeof payload.settings !== 'object') {
        throw new Error('Réponse serveur incomplète (« settings » manquant).');
    }
    if (!payload.users.length) {
        throw new Error('Le serveur n\'a renvoyé aucun utilisateur actif.');
    }
}

export async function importBootstrap(payload: BootstrapPayload): Promise<void> {
    assertUsableBootstrap(payload);

    const d = getDb();
    // Transaction EXCLUSIVE : `withTransactionAsync` laisse les requêtes émises
    // ailleurs pendant l'await s'intercaler dans la transaction (cf. docs SDK 56).
    // Deux synchros simultanées pouvaient alors s'entremêler et laisser le cache
    // vide. Toutes les requêtes passent par `txn` pour rester dans la transaction.
    await d.withExclusiveTransactionAsync(async (txn) => {
        // On vide puis ré-insère la config (les commandes locales ne sont pas touchées).
        for (const t of ['cache_settings', 'users', 'taxes', 'printers', 'rooms', 'tables', 'room_decorations', 'prep_stations', 'categories', 'products', 'option_groups', 'pos_session']) {
            await txn.execAsync(`DELETE FROM ${t};`);
        }

        for (const [key, value] of Object.entries(payload.settings)) {
            await txn.runAsync('INSERT INTO cache_settings (key, value) VALUES (?, ?)', key, value ?? null);
        }
        // Config temps réel (serveur) stockée à part pour survivre hors-ligne.
        await txn.runAsync('INSERT INTO cache_settings (key, value) VALUES (?, ?)', REALTIME_KEY, payload.realtime ? JSON.stringify(payload.realtime) : null);
        for (const u of payload.users) {
            await txn.runAsync('INSERT INTO users (id, name, role, active, color, pin_hash) VALUES (?,?,?,?,?,?)',
                u.id, u.name, u.role, u.active ? 1 : 0, u.color, u.pin_hash ?? null);
        }
        for (const t of payload.taxes) {
            await txn.runAsync('INSERT INTO taxes (id, name, rate) VALUES (?,?,?)', t.id, t.name, t.rate);
        }
        for (const p of payload.printers) {
            await txn.runAsync('INSERT INTO printers (id, name, ip_address, port, role, active) VALUES (?,?,?,?,?,?)',
                p.id, p.name, p.ip_address, p.port, p.role, p.active ? 1 : 0);
        }
        for (const r of payload.rooms) {
            await txn.runAsync(
                'INSERT INTO rooms (id, name, sort_order, background_image_url, plan_enabled, plan_width, plan_height, background_opacity) VALUES (?,?,?,?,?,?,?,?)',
                r.id, r.name, r.sort_order, r.background_image_url,
                r.plan_enabled ? 1 : 0, r.plan_width ?? 1000, r.plan_height ?? 700, r.background_opacity ?? 35);
            for (const tb of r.tables ?? []) {
                await txn.runAsync(
                    'INSERT INTO tables (id, room_id, label, sort_order, pos_x, pos_y, width, height, rotation, shape, seats) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                    tb.id, tb.room_id, tb.label, tb.sort_order,
                    tb.pos_x ?? null, tb.pos_y ?? null, tb.width ?? 90, tb.height ?? 90,
                    tb.rotation ?? 0, tb.shape ?? 'round', tb.seats ?? 4);
            }
            for (const dec of r.decorations ?? []) {
                await txn.runAsync(
                    'INSERT INTO room_decorations (id, room_id, kind, label, pos_x, pos_y, width, height, rotation) VALUES (?,?,?,?,?,?,?,?,?)',
                    dec.id, r.id, dec.kind, dec.label ?? null, dec.pos_x, dec.pos_y, dec.width, dec.height, dec.rotation);
            }
        }
        for (const st of payload.prep_stations ?? []) {
            await txn.runAsync(
                'INSERT INTO prep_stations (id, name, mode, printer_id, fallback_printer_id, sort_order) VALUES (?,?,?,?,?,?)',
                st.id, st.name, st.mode, st.printer_id, st.fallback_printer_id, st.sort_order);
        }
        for (const c of payload.categories) {
            await txn.runAsync('INSERT INTO categories (id, parent_id, name, color, sort_order, printer_id, station_id) VALUES (?,?,?,?,?,?,?)',
                c.id, c.parent_id, c.name, c.color, c.sort_order, c.printer_id, c.station_id ?? null);
        }
        for (const p of payload.products) {
            await txn.runAsync(
                'INSERT INTO products (id, category_id, name, price, tax_id, tax_takeaway_id, price_includes_tax, color, available, is_open_price, sort_order, image_url, option_group_ids) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                p.id, p.category_id, p.name, p.price, p.tax_id, p.tax_takeaway_id,
                p.price_includes_tax ? 1 : 0, p.color, p.available ? 1 : 0, p.is_open_price ? 1 : 0,
                p.sort_order, p.image_url, JSON.stringify(p.option_group_ids ?? []));
        }
        for (const g of payload.option_groups) {
            await txn.runAsync('INSERT INTO option_groups (id, name, min_select, max_select, required, options) VALUES (?,?,?,?,?,?)',
                g.id, g.name, g.min_select, g.max_select, g.required ? 1 : 0, JSON.stringify(g.options ?? []));
        }
        if (payload.session) {
            const s = payload.session;
            await txn.runAsync('INSERT INTO pos_session (id, status, opened_by, opened_at, opening_cash, closed_by, closed_at, closing_cash) VALUES (?,?,?,?,?,?,?,?)',
                s.id, s.status, s.opened_by, s.opened_at, s.opening_cash, s.closed_by, s.closed_at, s.closing_cash);
        }
    });
}

// --- Lectures (repository) ---

export async function getSettings(): Promise<Record<string, string | null>> {
    const rows = await getDb().getAllAsync<{ key: string; value: string | null }>(
        'SELECT key, value FROM cache_settings WHERE key != ?', REALTIME_KEY,
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getRealtimeConfig(): Promise<RealtimeConfig | null> {
    const row = await getDb().getFirstAsync<{ value: string | null }>(
        'SELECT value FROM cache_settings WHERE key = ?', REALTIME_KEY,
    );
    if (!row?.value) return null;
    try {
        return JSON.parse(row.value) as RealtimeConfig;
    } catch {
        return null;
    }
}

export async function getUsers(): Promise<User[]> {
    const rows = await getDb().getAllAsync<any>('SELECT * FROM users WHERE active = 1 ORDER BY name');
    return rows.map((r) => ({ ...r, active: !!r.active }));
}

export async function getTaxes(): Promise<Tax[]> {
    return getDb().getAllAsync<Tax>('SELECT * FROM taxes');
}

export async function getPrinters(): Promise<Printer[]> {
    const rows = await getDb().getAllAsync<any>('SELECT * FROM printers WHERE active = 1');
    return rows.map((r) => ({ ...r, active: !!r.active }));
}

export async function getRooms(): Promise<Room[]> {
    const rows = await getDb().getAllAsync<any>('SELECT * FROM rooms ORDER BY sort_order');
    return rows.map((r) => ({ ...r, plan_enabled: !!r.plan_enabled }));
}

/** Calque décor d'une salle (rendu du mode plan). */
export async function getDecorations(roomId: number): Promise<RoomDecoration[]> {
    return getDb().getAllAsync<RoomDecoration>('SELECT * FROM room_decorations WHERE room_id = ?', roomId);
}

export async function getTables(roomId: number): Promise<Table[]> {
    return getDb().getAllAsync<Table>('SELECT * FROM tables WHERE room_id = ? ORDER BY sort_order', roomId);
}

export async function getAllTables(): Promise<Table[]> {
    return getDb().getAllAsync<Table>('SELECT * FROM tables ORDER BY sort_order');
}

export async function getPrepStations(): Promise<PrepStation[]> {
    return getDb().getAllAsync<PrepStation>('SELECT * FROM prep_stations ORDER BY sort_order');
}

export async function getCategories(): Promise<Category[]> {
    return getDb().getAllAsync<Category>('SELECT * FROM categories ORDER BY sort_order');
}

export async function getProducts(): Promise<Product[]> {
    const rows = await getDb().getAllAsync<any>('SELECT * FROM products ORDER BY sort_order');
    return rows.map((r) => ({
        ...r,
        price_includes_tax: !!r.price_includes_tax,
        available: !!r.available,
        is_open_price: !!r.is_open_price,
        option_group_ids: JSON.parse(r.option_group_ids || '[]'),
    }));
}

export async function getOptionGroups(): Promise<OptionGroup[]> {
    const rows = await getDb().getAllAsync<any>('SELECT * FROM option_groups');
    return rows.map((r) => ({ ...r, required: !!r.required, options: JSON.parse(r.options || '[]') }));
}

export async function getCurrentSession(): Promise<PosSession | null> {
    const row = await getDb().getFirstAsync<any>("SELECT * FROM pos_session WHERE status = 'open' LIMIT 1");
    return row ?? null;
}

// --- Préférences locales (favoris serveurs, etc.) ---

export async function getFavoriteUserIds(): Promise<number[]> {
    const row = await getDb().getFirstAsync<{ value: string | null }>(
        "SELECT value FROM device_prefs WHERE key = 'favorite_users'",
    );
    if (!row?.value) return [];
    try {
        const ids = JSON.parse(row.value);
        return Array.isArray(ids) ? ids : [];
    } catch {
        return [];
    }
}

/** Préférence locale générique (jamais écrasée par la synchro de config). */
export async function getPref(key: string): Promise<string | null> {
    const row = await getDb().getFirstAsync<{ value: string | null }>(
        'SELECT value FROM device_prefs WHERE key = ?', key,
    );
    return row?.value ?? null;
}

export async function setPref(key: string, value: string): Promise<void> {
    await getDb().runAsync('INSERT OR REPLACE INTO device_prefs (key, value) VALUES (?, ?)', key, value);
}

export async function setFavoriteUserIds(ids: number[]): Promise<void> {
    await getDb().runAsync(
        'INSERT OR REPLACE INTO device_prefs (key, value) VALUES (?, ?)',
        'favorite_users',
        JSON.stringify(ids),
    );
}

// --- Mises à jour unitaires (temps réel) ---

export async function upsertProduct(p: Product): Promise<void> {
    await getDb().runAsync(
        `INSERT OR REPLACE INTO products
     (id, category_id, name, price, tax_id, tax_takeaway_id, price_includes_tax, color, available, is_open_price, sort_order, image_url, option_group_ids)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        p.id, p.category_id, p.name, p.price, p.tax_id, p.tax_takeaway_id,
        p.price_includes_tax ? 1 : 0, p.color, p.available ? 1 : 0, p.is_open_price ? 1 : 0,
        p.sort_order, p.image_url, JSON.stringify(p.option_group_ids ?? []),
    );
}

export async function setProductAvailability(id: number, available: boolean): Promise<void> {
    await getDb().runAsync('UPDATE products SET available = ? WHERE id = ?', available ? 1 : 0, id);
}

export async function upsertCategory(c: Category): Promise<void> {
    await getDb().runAsync(
        'INSERT OR REPLACE INTO categories (id, parent_id, name, color, sort_order, printer_id) VALUES (?,?,?,?,?,?)',
        c.id, c.parent_id, c.name, c.color, c.sort_order, c.printer_id,
    );
}

// --- Commandes (persistance locale + outbox) ---

// synced=false (défaut) : édition locale -> à pousser (outbox). synced=true : ordre
// reçu du serveur (temps réel / pull) -> déjà à jour, ne pas re-pousser.
export async function saveOrder(order: Order, synced = false): Promise<void> {
    const d = getDb();
    // Exclusive : plusieurs sauvegardes (panier + temps réel + pull) peuvent se
    // chevaucher ; sans isolation elles s'entremêlent dans la même transaction.
    await d.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync(
            `INSERT OR REPLACE INTO orders
       (id, profile_id, ticket_number, version, session_id, room_id, table_id, server_id, status, merged_into, service_type, covers, subtotal, tax_total, total,
        discount_type, discount_value, discount_amount, discount_reason, discount_by, opened_at, paid_at, payments, synced, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            order.id, order.profile_id ?? null, order.ticket_number ?? null, order.version ?? 0, order.session_id, order.room_id, order.table_id, order.server_id, order.status,
            order.merged_into ?? null, order.service_type, order.covers, order.subtotal, order.tax_total, order.total,
            order.discount_type ?? null, order.discount_value ?? null, order.discount_amount ?? 0, order.discount_reason ?? null, order.discount_by ?? null,
            order.opened_at, order.paid_at, JSON.stringify(order.payments ?? []), synced ? 1 : 0, new Date().toISOString(),
        );
        await txn.runAsync('DELETE FROM order_lines WHERE order_id = ?', order.id);
        for (const l of order.lines) {
            await txn.runAsync(
                `INSERT INTO order_lines
         (id, order_id, product_id, name_snapshot, qty, unit_price_snapshot, tax_rate_snapshot, price_includes_tax_snapshot, options_snapshot, note, line_total, sent_at, sent_qty, voided, void_reason, voided_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                l.id, l.order_id, l.product_id, l.name_snapshot, l.qty, l.unit_price_snapshot,
                l.tax_rate_snapshot, l.price_includes_tax_snapshot ? 1 : 0, JSON.stringify(l.options_snapshot ?? []),
                l.note, l.line_total, l.sent_at, l.sent_qty ?? 0, l.voided ? 1 : 0, l.void_reason, l.voided_by,
            );
        }
    });
}

function rowToOrder(o: any, lines: any[]): Order {
    return {
        ...o,
        payments: JSON.parse(o.payments || '[]'),
        lines: lines.map((l) => ({
            ...l,
            price_includes_tax_snapshot: !!l.price_includes_tax_snapshot,
            sent_qty: l.sent_qty ?? 0,
            voided: !!l.voided,
            options_snapshot: JSON.parse(l.options_snapshot || '[]'),
        })),
    };
}

export async function getOrder(id: string): Promise<Order | null> {
    const o = await getDb().getFirstAsync<any>('SELECT * FROM orders WHERE id = ?', id);
    if (!o) return null;
    const lines = await getDb().getAllAsync<any>('SELECT * FROM order_lines WHERE order_id = ?', id);
    return rowToOrder(o, lines);
}

/** Commande ouverte sur une table (tables partagées : n'importe quel serveur la reprend). */
export async function getOpenOrderForTable(tableId: number): Promise<Order | null> {
    const o = await getDb().getFirstAsync<any>(
        "SELECT * FROM orders WHERE table_id = ? AND status IN ('open','sent') ORDER BY opened_at DESC LIMIT 1",
        tableId,
    );
    if (!o) return null;
    const lines = await getDb().getAllAsync<any>('SELECT * FROM order_lines WHERE order_id = ?', o.id);
    return rowToOrder(o, lines);
}

/**
 * Vente COMPTOIR en cours (sans table) de la session. Une commande walk-in n'a
 * pas de table sur laquelle retaper pour la retrouver : sans cette reprise, un
 * aller-retour vers la salle la rendrait inaccessible à jamais.
 */
export async function getOpenCounterOrder(sessionId: number, profileId: number | null): Promise<Order | null> {
    const o = await getDb().getFirstAsync<any>(
        `SELECT * FROM orders
         WHERE table_id IS NULL AND session_id = ? AND status IN ('open','sent')
           AND (? IS NULL OR profile_id = ?)
         ORDER BY opened_at DESC LIMIT 1`,
        sessionId, profileId, profileId,
    );
    if (!o) return null;
    const lines = await getDb().getAllAsync<any>('SELECT * FROM order_lines WHERE order_id = ?', o.id);
    const order = rowToOrder(o, lines);

    // Une commande vide n'a rien à reprendre : autant en ouvrir une neuve.
    return order.lines.some((l) => !l.voided && l.qty > 0) ? order : null;
}

/**
 * Ids des tables « occupées » : commande ouverte AVEC au moins un article actif
 * (qty > 0) OU une action cuisine encore en attente (sent_qty > 0 → une annulation
 * pas encore envoyée). Ainsi une table dont on a supprimé le dernier produit envoyé
 * (−1 à envoyer) reste occupée tant que l'annulation n'est pas partie en cuisine.
 */
export async function getOpenTableIds(): Promise<number[]> {
    const rows = await getDb().getAllAsync<{ table_id: number }>(
        `SELECT DISTINCT o.table_id FROM orders o
         WHERE o.status IN ('open','sent') AND o.table_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.id AND l.voided = 0 AND (l.qty > 0 OR l.sent_qty > 0))`,
    );
    return rows.map((r) => r.table_id);
}

/**
 * Par table ouverte : nombre d'actions cuisine EN ATTENTE = articles à préparer
 * (qty > sent_qty, un « +1 ») + annulations à envoyer (qty < sent_qty, un « −1 »).
 * On compte donc |qty - sent_qty|. Dès que tout est synchronisé avec la cuisine
 * (pending = 0), la table n'a plus de badge.
 */
export async function getTablePendingCounts(): Promise<Record<number, number>> {
    const rows = await getDb().getAllAsync<{ table_id: number; pending: number }>(
        `SELECT o.table_id AS table_id,
                SUM(ABS(l.qty - l.sent_qty)) AS pending
         FROM orders o
         JOIN order_lines l ON l.order_id = o.id
         WHERE o.status IN ('open','sent') AND o.table_id IS NOT NULL AND l.voided = 0
         GROUP BY o.table_id`,
    );
    const map: Record<number, number> = {};
    for (const r of rows) {
        const n = Math.round(r.pending ?? 0);
        if (n > 0) map[r.table_id] = n;
    }
    return map;
}

/**
 * Résumé par table ouverte pour le mode plan : montant en cours, couverts,
 * serveur affecté et heure d'ouverture (durée d'occupation).
 */
export async function getTableSummaries(): Promise<Record<number, TableSummary>> {
    const rows = await getDb().getAllAsync<any>(
        `SELECT o.table_id AS table_id, o.total AS total, o.covers AS covers,
                o.server_id AS server_id, o.opened_at AS opened_at
         FROM orders o
         WHERE o.status IN ('open','sent') AND o.table_id IS NOT NULL`,
    );
    const map: Record<number, TableSummary> = {};
    for (const r of rows) {
        // Plusieurs commandes sur une même table (rare) : on cumule les montants.
        const current = map[r.table_id];
        map[r.table_id] = {
            total: (current?.total ?? 0) + Number(r.total ?? 0),
            covers: current?.covers ?? (r.covers != null ? Number(r.covers) : null),
            serverId: current?.serverId ?? (r.server_id != null ? Number(r.server_id) : null),
            openedAt: current?.openedAt ?? r.opened_at ?? null,
        };
    }
    return map;
}

/**
 * Réconciliation : ferme localement les commandes issues du serveur (synced=1) qui
 * ne figurent plus parmi les commandes ouvertes renvoyées par le serveur. Évite les
 * tables « fantômes » quand un paiement/annulation a eu lieu sur un autre appareil
 * pendant une coupure. On ne touche JAMAIS aux commandes locales non poussées (synced=0).
 */
export async function reconcileClosedOrders(openIds: string[], profileId: number | null = null): Promise<void> {
    // Scopé au profil : on ne ferme JAMAIS les commandes d'un autre profil
    // (l'endpoint /orders/open est lui aussi scopé sur le profil actif).
    const rows = await getDb().getAllAsync<{ id: string }>(
        "SELECT id FROM orders WHERE status IN ('open','sent') AND synced = 1 AND (? IS NULL OR profile_id = ?)",
        profileId, profileId,
    );
    const stale = rows.map((r) => r.id).filter((id) => !openIds.includes(id));
    for (const id of stale) {
        await getDb().runAsync("UPDATE orders SET status = 'paid' WHERE id = ?", id);
    }
}

/** Outbox : commandes non encore synchronisées. */
export async function getOutbox(): Promise<Order[]> {
    const orders = await getDb().getAllAsync<any>('SELECT * FROM orders WHERE synced = 0');
    const result: Order[] = [];
    for (const o of orders) {
        const lines = await getDb().getAllAsync<any>('SELECT * FROM order_lines WHERE order_id = ?', o.id);
        result.push(rowToOrder(o, lines));
    }
    return result;
}

/** Retire les lignes d'une commande (fusion : elles ont été réaffectées ailleurs). */
export async function deleteOrderLines(orderId: string): Promise<void> {
    await getDb().runAsync('DELETE FROM order_lines WHERE order_id = ?', orderId);
}

/** Libère une table : annule sa/ses commande(s) ouverte(s). */
export async function releaseTable(tableId: number): Promise<void> {
    await getDb().runAsync(
        "UPDATE orders SET status = 'cancelled', synced = 0, updated_at = ? WHERE table_id = ? AND status IN ('open','sent')",
        new Date().toISOString(),
        tableId,
    );
}

/** true si la commande a des modifications locales non encore poussées. */
export async function isOrderDirty(id: string): Promise<boolean> {
    const row = await getDb().getFirstAsync<{ synced: number }>('SELECT synced FROM orders WHERE id = ?', id);
    return !!row && row.synced === 0;
}

/**
 * Enregistre une commande reçue du serveur (temps réel / pull). On n'écrase PAS
 * une commande ayant des éditions locales en attente (synced=0) : le prochain push
 * fera foi. Sinon on l'écrit comme synchronisée (synced=1).
 */
export async function saveRemoteOrder(order: Order): Promise<'applied' | 'skipped'> {
    const local = await getDb().getFirstAsync<{ synced: number; version: number }>(
        'SELECT synced, version FROM orders WHERE id = ?', order.id,
    );
    if (local) {
        if (local.synced === 0) return 'skipped'; // édition locale non poussée -> local gagne
        if ((order.version ?? 0) < (local.version ?? 0)) return 'skipped'; // STRICTEMENT plus ancien -> ignoré
    }
    await saveOrder(order, true);
    return 'applied';
}

export async function markOrdersSynced(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    await getDb().runAsync(`UPDATE orders SET synced = 1 WHERE id IN (${placeholders})`, ...ids);
}

/**
 * Après un push accepté : on ADOPTE la version serveur (pour ignorer les échos plus
 * anciens), et on marque synced=1 UNIQUEMENT si la commande n'a pas été ré-éditée
 * entre-temps (updated_at inchangé) — sinon elle reste à repousser.
 */
export async function markOrderSynced(id: string, version: number, pushedUpdatedAt: string | null): Promise<void> {
    await getDb().runAsync(
        'UPDATE orders SET version = ?, synced = CASE WHEN updated_at = ? THEN 1 ELSE synced END WHERE id = ?',
        version, pushedUpdatedAt, id,
    );
}
