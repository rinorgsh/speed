/**
 * Types partagés. Reflètent les payloads de l'API (/api/v1/bootstrap) et le
 * modèle local. Les commandes/lignes utilisent des UUID générés côté client.
 */

export type Role = 'admin' | 'manager' | 'server';
export type ServiceType = 'dine_in' | 'takeaway';
export type OrderStatus = 'open' | 'sent' | 'paid' | 'cancelled';
export type PaymentMethod = 'cash' | 'card';
export type PrinterRole = 'order' | 'receipt';

export interface User {
    id: number;
    name: string;
    role: Role;
    active: boolean;
    color: string | null;
    pin_hash?: string; // présent dans le payload bootstrap (vérif PIN hors-ligne)
}

export interface Tax {
    id: number;
    name: string;
    rate: number;
}

export interface Printer {
    id: number;
    name: string;
    ip_address: string;
    port: number;
    role: PrinterRole;
    active: boolean;
}

export type TableShape = 'round' | 'square' | 'rect' | 'bar';
export type DecorationKind = 'wall' | 'bar' | 'door' | 'plant' | 'stairs' | 'text';

export interface Room {
    id: number;
    name: string;
    sort_order: number;
    background_image_url: string | null;
    /** Plan dessiné dans l'admin : conditionne l'accès au mode « plan ». */
    plan_enabled: boolean;
    plan_width: number;
    plan_height: number;
    background_opacity: number;
    tables?: Table[];
    decorations?: RoomDecoration[];
}

export interface Table {
    id: number;
    room_id: number;
    label: string;
    sort_order: number;
    // Géométrie sur le canevas de la salle (unités de grille). null = jamais placée.
    pos_x: number | null;
    pos_y: number | null;
    width: number;
    height: number;
    rotation: number;
    shape: TableShape;
    seats: number;
}

/** Résumé d'une table occupée, affiché sur le plan. */
export interface TableSummary {
    total: number;
    covers: number | null;
    serverId: number | null;
    openedAt: string | null;
}

/** Élément purement décoratif du plan : jamais cliquable. */
export interface RoomDecoration {
    id: number;
    room_id: number;
    kind: DecorationKind;
    label: string | null;
    pos_x: number;
    pos_y: number;
    width: number;
    height: number;
    rotation: number;
}

export interface Category {
    id: number;
    parent_id: number | null;
    name: string;
    color: string | null;
    sort_order: number;
    printer_id: number | null;
}

export interface Product {
    id: number;
    category_id: number;
    name: string;
    price: number;
    tax_id: number;
    tax_takeaway_id: number | null;
    price_includes_tax: boolean;
    color: string | null;
    available: boolean;
    is_open_price: boolean;
    sort_order: number;
    image_url: string | null;
    option_group_ids: number[];
}

export interface OptionItem {
    id: number;
    option_group_id: number;
    name: string;
    price_delta: number;
    sort_order: number;
}

export interface OptionGroup {
    id: number;
    name: string;
    min_select: number;
    max_select: number;
    required: boolean;
    options: OptionItem[];
}

export interface PosSession {
    id: number;
    status: 'open' | 'closed';
    opened_by: number;
    opened_at: string;
    opening_cash: number;
    closed_by: number | null;
    closed_at: string | null;
    closing_cash: number | null;
}

/** Config temps réel fournie par le serveur (s'adapte local/prod). */
export interface RealtimeConfig {
    key: string;
    host: string;
    port: number;
    scheme: 'http' | 'https';
}

/** Profil d'utilisation (« instance ») : Restaurant, Event… */
export interface Profile {
    id: number;
    name: string;
    type: string;
}

export interface BootstrapPayload {
    server_time: string;
    profile_id: number | null;
    settings: Record<string, string | null>;
    users: User[];
    rooms: Room[];
    taxes: Tax[];
    printers: Printer[];
    categories: Category[];
    products: Product[];
    option_groups: OptionGroup[];
    session: PosSession | null;
    realtime: RealtimeConfig | null;
}

/** Choix d'options figé sur une ligne de commande (snapshot JSON). */
export interface SelectedOption {
    option_id: number;
    name: string;
    price_delta: number;
}

/** Ligne de commande locale (UUID client). */
export interface OrderLine {
    id: string;
    order_id: string;
    product_id: number | null;
    name_snapshot: string;
    qty: number;
    unit_price_snapshot: number;
    tax_rate_snapshot: number;
    price_includes_tax_snapshot: boolean;
    options_snapshot: SelectedOption[];
    note: string | null;
    line_total: number;
    sent_at: string | null;
    sent_qty: number; // quantité déjà envoyée en cuisine (pour les envois/annulations partiels)
    voided: boolean;
    void_reason: string | null;
    voided_by: number | null;
}

/** Commande locale (UUID client). */
export interface Order {
    id: string;
    profile_id: number | null;
    ticket_number: number | null;
    version: number; // version serveur monotone (ignore les échos périmés)
    session_id: number;
    room_id: number | null;
    table_id: number | null;
    server_id: number;
    status: OrderStatus;
    service_type: ServiceType;
    covers: number | null;
    subtotal: number;
    tax_total: number;
    total: number;
    opened_at: string;
    paid_at: string | null;
    lines: OrderLine[];
    payments: { method: PaymentMethod; amount: number }[];
}
