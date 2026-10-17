<div align="center">

<img src="media/icon.png" width="88" alt="Logo Agora">

# Agora pour VS Code et Cursor

**Un agent de code dans ton éditeur, avec toutes les IA gratuites.**

[**⬇ Télécharger agora-vscode.vsix**](https://github.com/rvm-lua/Agora/releases/latest/download/agora-vscode.vsix) · [Site Agora](https://rvm-lua.github.io/Agora/) · [Tous les projets](https://github.com/rvm-lua/Agora) · [Signaler un bug](https://github.com/rvm-lua/Agora-vscode-extention/issues)

</div>

---

## Installer
1. Télécharge [**agora-vscode.vsix**](https://github.com/rvm-lua/Agora/releases/latest/download/agora-vscode.vsix).
2. Dans VS Code ou Cursor : `Ctrl+Maj+P` → **Extensions: Install from VSIX…** → choisis le fichier.
3. Clique sur l'icône **Agora** dans la barre de gauche.

## Ce que ça fait
- **Agora modifie tes fichiers directement**, comme l'extension Claude Code : il lit le projet ouvert, cherche le code concerné, puis propose chaque modification avec un diff rouge / vert dans le chat.
  - **Accepter** : le fichier est enregistré tout de suite.
  - **Toujours accepter** : plus de question jusqu'à la prochaine discussion.
  - **Refuser** : rien ne change, l'IA propose autre chose.
  - **Annuler** remet les fichiers comme avant.
- **Clic droit sur du code → Agora** : Expliquer, Corriger, Refactoriser, Commenter, Écrire des tests, ou poser ta question (`Ctrl+Alt+A`).
- Le **fichier ouvert ou la sélection** est envoyé comme contexte (désactivable d'un clic).
- **Codes secrets** : tape `/` dans le chat (`/debug`, `/review`, `/refactor`, `/security`, `/fxmanifest`…).
- IA : **Agora Gratuit** (sans clé), Groq, Gemini, OpenRouter, Mistral, Cerebras, ChatGPT, Claude, Grok.

## Lier une IA plus rapide (gratuit)
`Ctrl+Maj+P` → **Agora : Lier une IA** → choisis **Groq** ou **Gemini** → crée ta clé sur leur site → colle-la.
Pour modifier des fichiers, ces deux-là sont bien plus fiables qu'Agora Gratuit.
Les clés sont rangées dans le coffre sécurisé de l'éditeur, jamais dans tes fichiers.

## Réglages
| Réglage | Rôle |
|---|---|
| `agora.provider` / `agora.model` | IA et modèle utilisés |
| `agora.autoApply` | Appliquer les modifications sans demander |
| `agora.includeFile` | Envoyer le fichier ouvert comme contexte |
| `agora.instructions` | Instructions ajoutées à chaque demande |

## Développer
```
npx @vscode/vsce package      # crée agora-x.y.z.vsix
```
Pour tester : ouvre ce dossier dans VS Code et appuie sur `F5`.

## Confidentialité
Le code part directement de ton éditeur vers l'IA choisie, sans passer par un serveur Agora. Détails : [politique de confidentialité](https://rvm-lua.github.io/Agora/confidentialite.html).

Orbes animées : [thinking-orbs](https://github.com/Jakubantalik/thinking-orbs) (Jakub Antalik, MIT).
