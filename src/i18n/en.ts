/** Dictionnaire anglais. Clé = texte français de l'interface. */
export const en: Record<string, string> = {
    // --- Enrôlement / profil / verrouillage ---
    'Enrôler': 'Enrol',
    'Adresse du serveur': 'Server address',
    "Secret d'enrôlement": 'Enrolment secret',
    "Nom de l'appareil": 'Device name',
    'Choix du profil': 'Choose a profile',
    "Sélectionnez le mode d'utilisation": 'Select the usage mode',
    'Événement': 'Event',
    'Restaurant': 'Restaurant',
    'Aucun profil disponible sur ce serveur.': 'No profile available on this server.',
    'Réessayer': 'Try again',
    'Réinitialiser le serveur (URL)': 'Reset server (URL)',
    "Réinitialiser l'appareil": 'Reset device',
    "Effacer l'enrôlement ?": 'Erase enrolment?',
    "Effacer l'enrôlement actuel ?": 'Erase the current enrolment?',
    'Réinitialiser': 'Reset',
    'Annuler': 'Cancel',
    'Choisir un serveur': 'Choose a server',
    'Point de vente': 'Point of sale',
    'Synchronisation…': 'Syncing…',
    'Profil': 'Profile',
    'Configuration non chargée': 'Configuration not loaded',
    'Chargement de la configuration…': 'Loading configuration…',
    'Aucun utilisateur reçu du serveur.': 'No users received from the server.',
    'Changer de serveur': 'Change server',
    'Utilisateur introuvable': 'User not found',
    'La configuration a changé. Revenez et choisissez à nouveau.':
        'The configuration changed. Go back and choose again.',
    'Code PIN': 'PIN code',
    'Saisissez votre code PIN': 'Enter your PIN code',
    'Vérification…': 'Checking…',
    'PIN incorrect': 'Wrong PIN',
    'Réessayez.': 'Try again.',
    'Caisse fermée': 'Register closed',
    "Aucune session ouverte. Demandez à un administrateur d'ouvrir la caisse.":
        'No open session. Ask an administrator to open the register.',

    // --- Caisse ---
    'Ouverture de caisse': 'Open register',
    'Fermeture de caisse': 'Close register',
    'Fond de caisse': 'Opening float',
    'Ouvrir la caisse': 'Open register',
    'Fermer la caisse': 'Close register',
    'Verrouiller': 'Lock',
    'Changer de profil': 'Switch profile',

    // --- Salle ---
    'Salles': 'Rooms',
    'Aucune table dans cette salle.': 'No tables in this room.',
    'Aucune table.': 'No tables.',
    'Vue étage': 'Floor view',
    'Vue par salle': 'Room view',
    'Vue plan': 'Plan view',
    'Vue liste': 'List view',
    'Comptoir': 'Counter',
    'Table': 'Table',
    'Recentrer': 'Recentre',
    'Glissez sur une autre table…': 'Drag onto another table…',
    'Que voulez-vous faire ?': 'What would you like to do?',
    'Déplacer / fusionner': 'Move / merge',
    'Libérer la table': 'Free the table',
    'Aucune autre table': 'No other table',
    "Cette salle ne contient qu'une table.": 'This room has only one table.',
    'Une table libre = transfert. Une table occupée = fusion.':
        'A free table = transfer. An occupied table = merge.',
    'Déplacement impossible': 'Move not possible',
    'Transférer': 'Transfer',
    'Fusionner': 'Merge',
    'Libérer': 'Free',
    'Table :label': 'Table :label',
    'Libérer la table :label ?': 'Free table :label?',
    'La/les commande(s) en cours sur cette table seront annulées.':
        'The open order(s) on this table will be cancelled.',
    'Fusionner avec la table :label': 'Merge with table :label',
    'Transférer vers la table :label': 'Transfer to table :label',
    'Fusionner :from → :to ?': 'Merge :from into :to?',
    'Les articles de la table :from rejoignent la table :to. La table :from sera libérée.':
        'The items from table :from move to table :to. Table :from will be freed.',
    'Transférer :from → :to ?': 'Transfer :from to :to?',
    'La commande de la table :from passe sur la table :to.':
        'The order on table :from moves to table :to.',
    'Aucune commande ouverte sur cette table.': 'No open order on this table.',
    'La table de destination est occupée.': 'The destination table is occupied.',
    'Même table.': 'Same table.',
    'Aucune commande ouverte sur la table à fusionner.':
        'No open order on the table to merge.',
    'Aucune commande ouverte sur la table de destination.':
        'No open order on the destination table.',

    // --- Actions sur une ligne du panier ---
    "Retirer l'article": 'Remove item',
    'Retirer': 'Remove',
    'Enregistrer': 'Save',
    'ex. sans oignon': 'e.g. no onion',
    'Déjà envoyé en cuisine : prévenez-la de vive voix, le ticket est imprimé.':
        'Already sent to the kitchen: tell them in person, the ticket is printed.',
    'Retirer un article déjà envoyé ?': 'Remove an item already sent?',
    'La cuisine a déjà reçu cet article. Le retrait lui sera signalé au prochain envoi.':
        'The kitchen already received this item. The removal will be reported on the next send.',

    // --- Commande / panier ---
    'Commande': 'Order',
    'Panier': 'Cart',
    'Envoyer en cuisine': 'Send to kitchen',
    'Sur place': 'Eat in',
    'Emporter': 'Takeaway',
    'Quantité': 'Quantity',
    'Prix': 'Price',
    'Divers': 'Misc',
    'Note': 'Note',
    'Rechercher un produit': 'Search a product',
    'Couverts': 'Covers',

    // Encaissement détaillé (remise, partage, addition) depuis le comptoir iPad.
    'Détail': 'Details',
    'Addition': 'Bill',
    // Libellés courts des pastilles d'actions de l'écran de paiement.
    'Partager': 'Split',
    'Modifier': 'Edit',
    'Envoyé en cuisine': 'Sent to kitchen',

    "Touchez un produit pour commencer.": "Tap a product to start.",
    "Aucun produit.": "No products.",

    // --- Paiement ---
    'Reste': 'Left',
    'Rendu monnaie': 'Change',
    'Prix libre': 'Open price',

    'Paiement': 'Payment',
    'Total': 'Total',
    'Soldé': 'Settled',
    'Espèces': 'Cash',
    'Carte': 'Card',
    'Valider le paiement': 'Confirm payment',
    'Paiement incomplet': 'Incomplete payment',
    "Partager l'addition": 'Split the bill',
    'Facture détaillée (ventilation TVA)': 'Detailed invoice (VAT breakdown)',
    'Ticket non imprimé': 'Receipt not printed',
    "L'imprimante caisse n'a pas répondu. Le paiement est bien enregistré.":
        'The register printer did not respond. The payment is recorded.',
    'Réimprimer': 'Print again',
    'Continuer sans': 'Continue without',

    // --- Remise ---
    "Remise sur l'addition": 'Discount on the bill',
    'Appliquer une remise': 'Apply a discount',
    'Modifier la remise': 'Edit the discount',
    'Retirer la remise': 'Remove the discount',
    'Appliquer': 'Apply',
    'Pourcentage': 'Percentage',
    'Montant': 'Amount',
    'Motif (facultatif)': 'Reason (optional)',
    'Geste commercial, erreur cuisine…': 'Goodwill gesture, kitchen error…',
    'Remise': 'Discount',

    // --- Ticket client (langue de la clientèle) ---
    "Total avant remise": "Total before discount",
    "Dont TVA": "Incl. VAT",
    "Sous-total": "Subtotal",
    "TVA": "VAT",
    "TOTAL": "TOTAL",
    "Especes": "Cash",
    "Merci !": "Thank you!",

    // --- Addition (document non fiscal) ---
    "Imprimer l'addition": "Print the bill",
    "L'imprimante caisse n'a pas répondu.": "The register printer did not respond.",
    'Impression…': 'Printing…',
    'Addition non imprimée': 'Bill not printed',
    'ADDITION': 'BILL',
    'Document non fiscal': 'Not a fiscal document',
    'Serveur': 'Server',
    'A PAYER': 'TO PAY',
    'Ticket de caisse remis apres paiement.': 'Receipt issued after payment.',

    // --- Divers ---
    'Fermer': 'Close',
    'Confirmer': 'Confirm',
    'Erreur': 'Error',
    'Langue': 'Language',
    "Langue de l'établissement": 'Establishment language',
};
