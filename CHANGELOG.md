# Changelog
## 0.4.0
- Validation comme Claude Code : chaque modification s'affiche dans le chat (lignes rouges et vertes) avec Accepter, Toujours accepter et Refuser, et le diff s'ouvre dans l'éditeur.
- La modification acceptée est écrite tout de suite sur le disque (bouton Annuler pour revenir en arrière).
- Si le modèle s'arrête après avoir lu les fichiers (réponse vide), Agora le relance puis passe en mode simplifié.
## 0.3.0
- Agora agit vraiment sur les fichiers : outils lister, chercher, lire, modifier un passage, écrire un fichier.
- Les actions s'affichent dans la réponse (Lecture, Modification, Écriture).
- Repli automatique pour les modèles qui ne gèrent pas les outils.
## 0.2.0
- Agora peut lire et modifier les fichiers du projet : propositions avec diff, mode Demander ou Auto, annulation.
- Correction : « Insérer » et « Remplacer la sélection » visent bien le dernier fichier utilisé.
## 0.1.0
- Première version : chat latéral, 9 IA, commandes clic droit, insertion de code, codes secrets.
