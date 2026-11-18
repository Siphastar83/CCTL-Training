# CCTL Trainer

Mini plateforme de QCM responsive, réalisée en HTML / CSS / JavaScript vanilla. Elle est conçue pour être publiée gratuitement sur GitHub Pages.

## Contenu

- QCM rapide (10 questions), mode examen (20), révision complète
- Entraînement par matière et par thème
- Questions à réponse unique ou à réponses multiples
- Correction immédiate avec explication et référence au CCTL
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
2. Ajoute `index.html`, `style.css`, `app.js` et `questions.json` à la racine du dépôt.
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

- `type`: `single` ou `multiple`
- `a`: indices des bonnes réponses, en commençant à 0
- Pour plusieurs bonnes réponses, mets plusieurs indices dans `a`.

## Notes

Les questions initiales sont adaptées des quatre CCTL fournis dans la conversation. Les explications sont reformulées pour aider à comprendre. Les statistiques sont stockées localement dans le navigateur : elles ne sont pas synchronisées entre appareils.
