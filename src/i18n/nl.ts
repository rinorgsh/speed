/** Dictionnaire néerlandais. Clé = texte français de l'interface. */
export const nl: Record<string, string> = {
    // --- Enrôlement / profil / verrouillage ---
    'Enrôler': 'Registreren',
    'Adresse du serveur': 'Serveradres',
    "Secret d'enrôlement": 'Registratiesleutel',
    "Nom de l'appareil": 'Naam van het toestel',
    'Choix du profil': 'Profielkeuze',
    "Sélectionnez le mode d'utilisation": 'Kies de gebruiksmodus',
    'Événement': 'Evenement',
    'Restaurant': 'Restaurant',
    'Aucun profil disponible sur ce serveur.': 'Geen profiel beschikbaar op deze server.',
    'Réessayer': 'Opnieuw proberen',
    'Réinitialiser le serveur (URL)': 'Server opnieuw instellen (URL)',
    "Réinitialiser l'appareil": 'Toestel opnieuw instellen',
    "Effacer l'enrôlement ?": 'Registratie wissen?',
    "Effacer l'enrôlement actuel ?": 'Huidige registratie wissen?',
    'Réinitialiser': 'Opnieuw instellen',
    'Annuler': 'Annuleren',
    'Choisir un serveur': 'Kies een kelner',
    'Point de vente': 'Kassa',
    'Synchronisation…': 'Synchroniseren…',
    'Profil': 'Profiel',
    'Configuration non chargée': 'Configuratie niet geladen',
    'Chargement de la configuration…': 'Configuratie laden…',
    'Aucun utilisateur reçu du serveur.': 'Geen gebruikers ontvangen van de server.',
    'Changer de serveur': 'Van server wisselen',
    'Utilisateur introuvable': 'Gebruiker niet gevonden',
    'La configuration a changé. Revenez et choisissez à nouveau.':
        'De configuratie is gewijzigd. Ga terug en kies opnieuw.',
    'Code PIN': 'Pincode',
    'Saisissez votre code PIN': 'Voer je pincode in',
    'Vérification…': 'Controleren…',
    'PIN incorrect': 'Verkeerde pincode',
    'Réessayez.': 'Probeer opnieuw.',
    'Caisse fermée': 'Kassa gesloten',
    "Aucune session ouverte. Demandez à un administrateur d'ouvrir la caisse.":
        'Geen open sessie. Vraag een beheerder om de kassa te openen.',

    // --- Caisse ---
    'Ouverture de caisse': 'Kassa openen',
    'Fermeture de caisse': 'Kassa sluiten',
    'Fond de caisse': 'Startgeld',
    'Ouvrir la caisse': 'Kassa openen',
    'Fermer la caisse': 'Kassa sluiten',
    'Verrouiller': 'Vergrendelen',
    'Changer de profil': 'Van profiel wisselen',

    // --- Salle ---
    'Salles': 'Zalen',
    'Aucune table dans cette salle.': 'Geen tafels in deze zaal.',
    'Aucune table.': 'Geen tafels.',
    'Vue étage': 'Verdiepingsweergave',
    'Vue par salle': 'Weergave per zaal',
    'Vue plan': 'Planweergave',
    'Vue liste': 'Lijstweergave',
    'Comptoir': 'Toog',
    'Table': 'Tafel',
    'Recentrer': 'Centreren',
    'Glissez sur une autre table…': 'Sleep naar een andere tafel…',
    'Que voulez-vous faire ?': 'Wat wil je doen?',
    'Déplacer / fusionner': 'Verplaatsen / samenvoegen',
    'Libérer la table': 'Tafel vrijgeven',
    'Aucune autre table': 'Geen andere tafel',
    "Cette salle ne contient qu'une table.": 'Deze zaal heeft maar één tafel.',
    'Une table libre = transfert. Une table occupée = fusion.':
        'Vrije tafel = verplaatsen. Bezette tafel = samenvoegen.',
    'Déplacement impossible': 'Verplaatsen niet mogelijk',
    'Transférer': 'Verplaatsen',
    'Fusionner': 'Samenvoegen',
    'Libérer': 'Vrijgeven',
    'Table :label': 'Tafel :label',
    'Libérer la table :label ?': 'Tafel :label vrijgeven?',
    'La/les commande(s) en cours sur cette table seront annulées.':
        'De lopende bestelling(en) op deze tafel worden geannuleerd.',
    'Fusionner avec la table :label': 'Samenvoegen met tafel :label',
    'Transférer vers la table :label': 'Verplaatsen naar tafel :label',
    'Fusionner :from → :to ?': ':from samenvoegen met :to?',
    'Les articles de la table :from rejoignent la table :to. La table :from sera libérée.':
        'De artikelen van tafel :from gaan naar tafel :to. Tafel :from wordt vrijgegeven.',
    'Transférer :from → :to ?': ':from verplaatsen naar :to?',
    'La commande de la table :from passe sur la table :to.':
        'De bestelling van tafel :from gaat naar tafel :to.',
    'Aucune commande ouverte sur cette table.': 'Geen lopende bestelling op deze tafel.',
    'La table de destination est occupée.': 'De doeltafel is bezet.',
    'Même table.': 'Zelfde tafel.',
    'Aucune commande ouverte sur la table à fusionner.':
        'Geen lopende bestelling op de samen te voegen tafel.',
    'Aucune commande ouverte sur la table de destination.':
        'Geen lopende bestelling op de doeltafel.',

    // --- Actions sur une ligne du panier ---
    "Retirer l'article": 'Artikel verwijderen',
    'Retirer': 'Verwijderen',
    'Enregistrer': 'Opslaan',
    'ex. sans oignon': 'bv. zonder ui',
    'Déjà envoyé en cuisine : prévenez-la de vive voix, le ticket est imprimé.':
        'Al naar de keuken gestuurd: verwittig hen mondeling, het ticket is afgedrukt.',
    'Retirer un article déjà envoyé ?': 'Een al verstuurd artikel verwijderen?',
    'La cuisine a déjà reçu cet article. Le retrait lui sera signalé au prochain envoi.':
        'De keuken heeft dit artikel al ontvangen. De verwijdering wordt bij de volgende zending gemeld.',

    // --- Commande / panier ---
    'Commande': 'Bestelling',
    'Panier': 'Winkelmandje',
    'Envoyer en cuisine': 'Naar de keuken sturen',
    'Sur place': 'Ter plaatse',
    'Emporter': 'Afhaal',
    'Quantité': 'Aantal',
    'Prix': 'Prijs',
    'Divers': 'Diversen',
    // Remarque portée par une ligne de commande (« sans oignon »).
    'Note': 'Opmerking',
    'Rechercher un produit': 'Zoek een product',
    'Couverts': 'Couverts',

    'Addition': 'Rekening',
    // Libellés courts des pastilles d'actions de l'écran de paiement.
    'Partager': 'Splitsen',
    'Modifier': 'Wijzigen',
    'Envoyé en cuisine': 'Naar de keuken gestuurd',

    "Touchez un produit pour commencer.": "Tik op een product om te beginnen.",
    "Aucun produit.": "Geen producten.",

    // --- Paiement ---
    'Reste': 'Rest',
    'Rendu monnaie': 'Wisselgeld',
    'Prix libre': 'Vrije prijs',

    'Paiement': 'Betaling',
    'Total': 'Totaal',
    'Soldé': 'Voldaan',
    'Espèces': 'Contant',
    'Carte': 'Kaart',
    'Valider le paiement': 'Betaling bevestigen',
    'Paiement incomplet': 'Betaling onvolledig',
    "Partager l'addition": 'Rekening splitsen',
    'Facture détaillée (ventilation TVA)': 'Gedetailleerde factuur (btw-uitsplitsing)',
    'Ticket non imprimé': 'Ticket niet afgedrukt',
    "L'imprimante caisse n'a pas répondu. Le paiement est bien enregistré.":
        'De kassaprinter reageerde niet. De betaling is wel geregistreerd.',
    'Réimprimer': 'Opnieuw afdrukken',
    'Continuer sans': 'Doorgaan zonder',

    // --- Remise ---
    "Remise sur l'addition": 'Korting op de rekening',
    'Appliquer une remise': 'Korting toepassen',
    'Modifier la remise': 'Korting aanpassen',
    'Retirer la remise': 'Korting verwijderen',
    'Appliquer': 'Toepassen',
    'Pourcentage': 'Percentage',
    'Montant': 'Bedrag',
    'Motif (facultatif)': 'Reden (optioneel)',
    'Geste commercial, erreur cuisine…': 'Commercieel gebaar, keukenfout…',
    'Remise': 'Korting',

    // --- Ticket client (langue de la clientèle) ---
    "Total avant remise": "Totaal voor korting",
    "Dont TVA": "Waarvan btw",
    "Sous-total": "Subtotaal",
    "TVA": "Btw",
    "TOTAL": "TOTAAL",
    "Especes": "Contant",
    "Merci !": "Bedankt!",

    // --- Addition (document non fiscal) ---
    "Imprimer l'addition": "Rekening afdrukken",
    "L'imprimante caisse n'a pas répondu.": "De kassaprinter reageerde niet.",
    'Impression…': 'Afdrukken…',
    'Addition non imprimée': 'Rekening niet afgedrukt',
    'ADDITION': 'REKENING',
    'Document non fiscal': 'Geen fiscaal document',
    'Serveur': 'Kelner',
    'A PAYER': 'TE BETALEN',
    'Ticket de caisse remis apres paiement.': 'Kassaticket na betaling.',

    // --- Divers ---
    'Fermer': 'Sluiten',
    'Confirmer': 'Bevestigen',
    'Erreur': 'Fout',
    'Langue': 'Taal',
    "Langue de l'établissement": 'Taal van de zaak',
};
