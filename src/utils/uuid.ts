/**
 * UUID v4 généré côté client (pour orders/order_lines créés hors-ligne, sans
 * collision à la synchro). RNG suffisant pour des identifiants d'application.
 */
export function uuidv4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
