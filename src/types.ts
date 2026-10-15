/**
 * Types partagés. Reflètent les payloads de l'API (/api/v1/bootstrap) et le
 * modèle local. Les commandes/lignes utilisent des UUID générés côté client.
 */

export type Role = 'admin' | 'manager' | 'server';
export type ServiceType = 'dine_in' | 'takeaway';
/**
 * `closed` est un statut PUREMENT LOCAL : le serveur nous a dit que la commande
 * n'est plus ouverte sans préciser si elle a été encaissée ou annulée. Il n'est
 * jamais envoyé — le serveur ne connaît que les quatre autres.
 */
export type OrderStatus = 'open' | 'sent' | 'paid' | 'cancelled' | 'closed';
export type PaymentMethod = 'cash' | 'card';
export type PrinterRole = 'order' | 'receipt';

export interface User {
    id: number;
    name: string;
    role: Role;
    active: boolean;
    color: string | null;
    pin_hash?: string; // présent dans le payload bootstrap (vérif PIN hors-ligne)
    /**
     * Ouvre sa session sans taper de code. Distinct d'un `pin_hash` absent, qui
     * signifie « ne peut pas ouvrir de session sur la caisse » — le cas d'un
     * administrateur qui n'utilise que le back-office web.
     */
    no_pin?: boolean;
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
    /**
     * Type de service des commandes ouvertes dans cette salle — donc la TVA
     * appliquée. Une friterie tient une salle « Sur place » et une salle
     * « Emporter » : le taux ne doit pas dépendre d'un geste du serveur.
     */
    default_service_type: ServiceType;
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
    /** Poste de préparation destinataire (prioritaire sur printer_id). */
    station_id: number | null;
}

export type StationMode = 'paper' | 'screen' | 'both';

/**
 * Poste de préparation : destination d'envoi (cuisine, bar…) et mode de sortie.
 * `fallback_printer_id` sert de filet quand l'écran n'accuse pas réception.
 */
export interface PrepStation {
    id: number;
    name: string;
    mode: StationMode;
    printer_id: number | null;
    fallback_printer_id: number | null;
    sort_order: number;
}

/**
 * Note rapide : demande fréquente de la clientèle (« sans oignon »), réglée
 * dans l'admin et proposée en un tap au moment d'écrire la note d'un article.
 * Simple aide à la saisie — la note stockée sur la ligne reste du texte libre.
 */
export interface QuickNote {
    id: number;
    label: string;
    sort_order: number;
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
    /**
     * L'option arrive cochée ; le serveur la DÉCOCHE si le client n'en veut pas.
     * Pour les garnitures qui accompagnent le plat d'office.
     *
     * Facultatif : un serveur plus ancien que cette fonctionnalité ne renvoie pas
     * le champ, et l'absence doit se lire comme « non cochée ».
     */
    default_selected?: boolean;
    sort_order: number;
}

export interface OptionGroup {
    id: number;
    name: string;
    /**
     * Nombre d'options réellement FACTURÉES dans ce groupe.
     *
     * À 1 sur un groupe qui en autorise 2 : le client prend deux sauces, une
     * seule est comptée. C'est la « sauce mixte » de la friterie.
     *
     * Null ou absent — le défaut — facture tout, comportement d'origine.
     */
    paid_max?: number | null;
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
    prep_stations?: PrepStation[];
    quick_notes?: QuickNote[];
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
    /**
     * L'option accompagnait le plat d'office et le client l'a REFUSÉE.
     *
     * Figé sur la ligne comme le reste du snapshot, plutôt que recalculé à
     * l'impression en comparant au groupe : un groupe modifié dans l'admin
     * réécrirait sinon un ticket déjà parti en cuisine.
     *
     * Toujours à supplément nul — un retrait ne se facture pas.
     */
    excluded?: boolean;
    /**
     * Nom du groupe au moment du choix (« Sauce »), figé sur la ligne comme le
     * reste du snapshot : renommer le groupe dans l'admin ne doit pas réécrire
     * un ticket déjà imprimé. Absent des lignes créées avant cette version.
     */
    group?: string;
}

/** Ligne de commande locale (UUID client). */
export interface OrderLine {
    id: string;
    order_id: string;
    /**
     * Qui a SAISI cette ligne — pas forcément celui qui a ouvert la table.
     *
     * Une table servie à plusieurs créditait auparavant le seul serveur de la
     * commande. Chaque ligne porte désormais son auteur, et c'est lui qui est
     * compté dans le rapport de caisse.
     *
     * Facultatif : les lignes créées avant 09/2026 n'en ont pas, le serveur
     * retombe alors sur celui de la commande.
     */
    server_id?: number | null;
    /**
     * Rang de la ligne dans le ticket. Indispensable : l'identifiant est un
     * UUID, donc sans position le serveur renverrait les lignes dans un ordre
     * alphabétique d'UUID et l'article qu'on vient d'ajouter changerait de
     * place sous les yeux du serveur.
     */
    position: number;
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
    // Remise sur l'addition. `discount_amount` est le montant réellement déduit,
    // figé au moment du geste ; `total` est déjà net de remise.
    discount_type?: 'percent' | 'amount' | null;
    discount_value?: number | null;
    discount_amount?: number;
    discount_reason?: string | null;
    discount_by?: number | null;
    lines: OrderLine[];
    // `user_id` : qui a encaissé. Distinct du serveur qui a vendu — c'est ce qui
    // permet de rapprocher le tiroir-caisse sans fausser les ventes en salle.
    payments: { method: PaymentMethod; amount: number; user_id?: number | null }[];
    /** Fusion : commande dans laquelle celle-ci a été absorbée (traçabilité). */
    merged_into?: string | null;
}
