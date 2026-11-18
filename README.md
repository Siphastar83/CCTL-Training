# CCTL Trainer

Mini plateforme de QCM responsive, réalisée en HTML / CSS / JavaScript vanilla. Elle est conçue pour être publiée gratuitement sur GitHub Pages.

## Contenu

- QCM rapide (10 questions), mode examen (20), révision complète
- Entraînement par matière et par thème
- Questions à réponse unique ou à réponses multiples
- Correction immédiate avec explication et référence au CCTL
- Schémas (graphes), tableaux et extraits de code affichés dans les questions
- Entraînement par CCTL (dans l'ordre du sujet) ou par thème
- Bouton **⚑ Signaler** sur chaque question pour remonter un bug ou une erreur
- Statistiques, historique et progression sauvegardés dans `localStorage`
- Responsive PC / tablette / mobile
- Aucun serveur, aucune base de données, aucun framework requis

## Lancer en local

Lance un petit serveur local (recommandé, car la banque de questions est chargée depuis `questions.json`) :

```bash
python -m http.server 8000
```

Puis ouvre http://localhost:8000.

## Publier sur GitHub Pages

1. Crée un dépôt GitHub, par exemple `cctl-trainer`.
2. Ajoute `index.html`, `style.css`, `app.js`, `questions.json` et le dossier `img/` à la racine du dépôt.
3. Dans **Settings → Pages**, choisis **Deploy from a branch**.
4. Sélectionne la branche `main` et le dossier `/ (root)`, puis valide.
5. Attends le déploiement : GitHub affichera l'URL publique du site.

## Ajouter des questions

Modifie `questions.json`. Chaque question suit ce format :

```json
{
	"id": "exemple-01",
	"subject": "Mathématiques",
	"topic": "Probabilités",
	"type": "single",
	"q": "Texte de la question",
	"o": ["Réponse A", "Réponse B", "Réponse C"],
	"a": [1],
	"e": "Explication de la bonne réponse.",
	"src": "Nom du document, question n°"
}
```

Champs facultatifs :

- `code` : extrait de code affiché sous l'énoncé (les retours à la ligne `\n` sont conservés)
- `table` : tableau de données, première ligne = en-têtes (ex. `[["x","y"],["1","2"]]`)
- `img` : chemin d'un schéma, ex. `img/graphe-pondere.png`
- Une proposition contenant `\n` est affichée comme du code.

- `type`: `single` ou `multiple`
- `a`: indices des bonnes réponses, en commençant à 0
- Pour plusieurs bonnes réponses, mets plusieurs indices dans `a`.

## Signalements

Chaque question a un bouton **⚑ Signaler**. L'élève choisit un motif, ajoute un commentaire, puis :

- **Ouvrir sur GitHub** : ouvre une _issue_ pré-remplie (ID, source, énoncé, propositions, réponse attendue, réponse choisie, commentaire) sur le dépôt du site. Le dépôt est détecté automatiquement depuis l'adresse `pseudo.github.io/depot`. Il faut un compte GitHub pour valider l'issue.
- **Copier le signalement** : copie le texte, à envoyer par n'importe quel moyen.

Pour forcer un dépôt ou ajouter un e-mail de secours, modifie en haut de `app.js` :

```js
const REPORT_CONFIG = { repo: "pseudo/cctl-trainer", email: "" };
```

Vérifie que les _Issues_ sont activées : **Settings → General → Features → Issues**.

## Notes

La banque contient les 110 questions des quatre CCTL (CCTL Sciences du numérique : 30, CCTL Mathématiques : 45, Initial numériques : 15, Initial mathématiques : 20), doublons compris, avec leurs schémas. Les commentaires de correction officiels sont repris quand ils existent ; sinon une explication est ajoutée. Deux corrigés officiels manifestement faux ont été rectifiés (CCTL Sciences du numérique Q3 et CCTL Mathématiques Q26) : c'est signalé dans l'explication. Les statistiques sont stockées localement dans le navigateur : elles ne sont pas synchronisées entre appareils.
