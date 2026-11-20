# CCTL Trainer

Plateforme de QCM responsive en HTML / CSS / JavaScript, publiable gratuitement sur GitHub Pages.
**Il n'y a plus de liste de questions à maintenir** : le site lit directement les PDF de correction des CCTL et en fait des QCM.

## Fonctionnement

1. Tu fournis un PDF de correction de CCTL (le format « Question N · Réponse attendue · Réponse saisie · Commentaire de correction »).
2. Le site le lit dans le navigateur avec [PDF.js](https://mozilla.github.io/pdf.js/) et crée pour chaque question :
   - l'énoncé (texte et blocs de code avec leur indentation) ;
   - les propositions et la ou les bonnes réponses, reprises de la colonne « Réponse attendue » ;
   - l'explication, reprise du « Commentaire de correction » ;
   - les schémas, graphes, tableaux et formules mathématiques, découpés automatiquement en images ;
   - un thème (Probabilités, Graphes, Python…), deviné à partir des mots-clés.
3. Le résultat est mis en cache dans le navigateur (IndexedDB) : les visites suivantes sont instantanées.

## Deux façons d'ajouter des PDF

### Pour tout le monde : le dossier `pdf/` du dépôt
Dépose les PDF dans le dossier `pdf/` du dépôt GitHub (**Add file → Upload files**). Tous les visiteurs voient les nouvelles questions automatiquement, sans autre modification.

Le site trouve les fichiers de trois façons, dans cet ordre :
1. `pdf/index.json`, s'il existe : une liste de noms de fichiers, ex. `["CCTL maths.pdf", "CCTL numérique.pdf"]` ;
2. sur GitHub Pages, l'API GitHub, qui liste le dossier `pdf/` (dépôt **public**) ;
3. en local, la liste du dossier fournie par `python -m http.server`.

⚠️ Les PDF de correction contiennent le **nom et les notes de l'élève**. Sur un dépôt public, ils sont visibles par tout le monde.

### Pour soi : la page « Mes CCTL (PDF) »
Glisse un PDF sur la page (ou clique sur la zone d'import). Il est analysé et conservé **uniquement sur cet appareil** : rien n'est envoyé sur Internet.
Sur cette page, on peut aussi corriger la matière d'un PDF ou supprimer un PDF importé.

## Contenu

- QCM rapide (10 questions), mode examen (20), révision complète
- Entraînement par matière, par thème ou par CCTL (dans l'ordre du sujet)
- Questions à réponse unique ou à réponses multiples, correction immédiate avec explication
- Bouton **⚑ Signaler** sur chaque question
- Statistiques et historique dans `localStorage`, PDF analysés dans IndexedDB
- Responsive PC / tablette / mobile, aucun serveur ni base de données

## Lancer en local

```bash
python -m http.server 8000
```

Puis ouvre http://localhost:8000. Un serveur est nécessaire : ouvrir `index.html` en double-cliquant ne fonctionne pas.

## Publier sur GitHub Pages

1. Crée un dépôt **public**, par exemple `cctl-trainer`.
2. Ajoute à la racine `index.html`, `style.css`, `app.js`, `pdf-import.js`, le dossier `lib/` et le dossier `pdf/` avec tes PDF.
3. Dans **Settings → Pages**, choisis **Deploy from a branch**, branche `main`, dossier `/ (root)`.
4. Attends le déploiement : GitHub affiche l'URL publique du site.

Si tu avais l'ancienne version, tu peux supprimer `questions.json` et le dossier `img/` : ils ne servent plus.

## Signalements

L'élève choisit un motif et peut ajouter un commentaire, puis :

- **Ouvrir sur GitHub** : ouvre une *issue* pré-remplie (CCTL, numéro de question, énoncé, propositions, réponse attendue, réponse choisie, commentaire). Le dépôt est détecté depuis l'adresse `pseudo.github.io/depot`. Il faut un compte GitHub pour valider.
- **Copier le signalement** : copie le texte, à envoyer par n'importe quel moyen.

Pour forcer un dépôt, un e-mail de secours ou un autre dossier de PDF, modifie le haut de `app.js` :

```js
const REPORT_CONFIG = { repo: "pseudo/cctl-trainer", email: "" };
const PDF_FOLDER = "pdf";
```

Vérifie que les *Issues* sont activées : **Settings → General → Features → Issues**.

## Limites

- Le convertisseur est fait pour le format de correction des CCTL. Un autre type de PDF (sujet sans corrigé, scan) ne donnera pas de questions.
- La bonne réponse est celle cochée dans le PDF. Si le corrigé officiel se trompe, le site se trompe aussi : c'est à ça que sert le bouton **Signaler**.
- Une question sans réponse attendue cochée est ignorée ; c'est indiqué sur la page « Mes CCTL ».
- Si tu modifies le convertisseur (`pdf-import.js`), augmente `PARSER_VERSION` pour que les PDF du site soient ré-analysés.

## Licence des bibliothèques

`lib/` contient PDF.js (Mozilla, licence Apache 2.0, voir `lib/LICENSE-pdfjs.txt`).
