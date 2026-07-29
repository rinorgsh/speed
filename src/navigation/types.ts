/** Param list de la navigation stack. */
export type RootStackParamList = {
    Enrollment: undefined;
    ProfileSelect: undefined;
    Unlock: undefined;
    Pin: { userId: number };
    OpenSession: undefined;
    CloseSession: undefined;
    Rooms: undefined;
    // Sans paramètre = caisse comptoir (vente directe). Avec une table =
    // même disposition en deux colonnes, mais pour le service en salle.
    Comptoir: { tableId: number; tableLabel: string; roomId: number | null } | undefined;
    Pos: undefined;
    Cart: undefined;
    Payment: undefined;
    Split: undefined;
};
