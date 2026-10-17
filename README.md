# Agora pour VS Code et Cursor

Toutes les IA dans ton éditeur, avec **Agora Gratuit** qui marche sans clé ni compte.

## Ce que ça fait
- **Chat Agora** dans la barre latérale (icône Agora à gauche).
- **Agora lit et modifie les fichiers de ton projet** (dossier ouvert) : il lit ce dont il a besoin, puis propose ses modifications fichier par fichier.
  - Mode **Demander** : tu vois les changements (+/−), tu cliques **Voir** pour le diff, puis **Appliquer** ou **Tout appliquer**.
  - Mode **Auto** : les modifications sont appliquées directement.
  - Dans les deux cas, **Annuler** remet tes fichiers comme avant.
- **Clic droit sur du code sélectionné → Agora** : Expliquer, Corriger, Refactoriser, Commenter, Tests, ou poser ta question (`Ctrl+Alt+A`).
- Le **fichier ouvert ou la sélection** est envoyé automatiquement comme contexte (désactivable d'un clic).
- Sur chaque bloc de code de la réponse : **Copier**, **Insérer**, **Remplacer la sélection**, **Nouveau fichier**.
- **Codes secrets** : tape `/` dans le chat (`/debug`, `/review`, `/refactor`, `/security`, `/fxmanifest`…).
- IA disponibles : Agora Gratuit, Groq, Gemini, OpenRouter, Mistral, Cerebras, ChatGPT, Claude, Grok.

## Lier une IA plus rapide (gratuit)
Palette de commandes (`Ctrl+Maj+P`) → **Agora : Lier une IA** → choisis Groq, Gemini ou OpenRouter → crée ta clé sur leur site → colle-la.
Les clés sont rangées dans le coffre sécurisé de l'éditeur, jamais dans tes fichiers.

## Confidentialité
Le code que tu envoies part directement de ton éditeur vers l'IA choisie. Rien ne passe par un serveur Agora.

Site web : https://rvm-lua.github.io/Agora/ · Orbes : thinking-orbs (Jakub Antalik, MIT).
