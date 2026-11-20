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
4. Un administrateur peut partager les questions avec tous les visiteurs via une base Supabase gratuite (voir plus bas).

## Ajouter un CCTL

Va sur la page **Mes CCTL (PDF)** et glisse le PDF dessus. Le site te prévient s'il est **déjà importé** :
- même fichier : il le dit et n'importe rien ;
- même sujet dans un autre fichier (par exemple le PDF d'un autre élève) : il indique combien de questions sont identiques et te demande si tu veux quand même l'importer.

Ensuite :
- **visiteur** : le CCTL reste uniquement sur son appareil ;
- **administrateur connecté** : il choisit **Partager avec tout le monde**. Les questions (texte et images) sont enregistrées dans la base Supabase et tous les visiteurs les ont immédiatement. **Le PDF lui-même, avec le nom et les notes de l'élève, n'est jamais envoyé.**

L'administrateur peut aussi retirer un CCTL partagé et corriger sa matière pour tout le monde.

## Mettre en place la base partagée (Supabase, gratuit)

1. Crée un compte sur [supabase.com](https://supabase.com), puis **New project** (choisis une région en Europe, par exemple Paris ou Francfort).
2. **SQL Editor → New query** : colle le contenu de `supabase.sql`, puis **Run**.
3. **Authentication → Users → Add user → Create new user** : ton e-mail et un mot de passe, coche *Auto Confirm User*.
4. Dans le SQL Editor, déclare-toi administrateur (remplace l'e-mail) :
   ```sql
   insert into public.cctl_admins (user_id) select id from auth.users where email = 'ton.email@exemple.fr';
   ```
5. Conseillé : **Authentication → Sign In / Providers**, désactive *Allow new users to sign up*. Même activé, un inconnu qui créerait un compte ne pourrait rien modifier.
6. **Project Settings → API** : copie *Project URL* et la clé *anon public*, puis colle-les en haut de `app.js` :
   ```js
   const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```
   La clé *anon* est faite pour être publique : ce sont les règles du script SQL qui protègent la base (lecture pour tous, écriture réservée aux administrateurs). Ne mets **jamais** la clé *service_role* dans le site.
7. Sur le site, page **Mes CCTL**, bloc **Administrateur** : connecte-toi avec l'e-mail et le mot de passe de l'étape 3.

Bon à savoir : un projet Supabase gratuit se met **en pause après 7 jours sans visite**. Le site l'indique alors (les CCTL déjà chargés restent disponibles sur chaque appareil) ; il suffit de cliquer sur *Restore project* dans le tableau de bord Supabase.

Le dossier `pdf/` du dépôt fonctionne toujours en complément : tout PDF qui y est déposé est chargé pour tout le monde. Mais il rend le PDF public, avec le nom et les notes de l'élève.

## Contenu

- QCM rapide (10 questions), mode examen (20), révision complète
- Entraînement par matière, par thème ou par CCTL (dans l'ordre du sujet)
- Questions à réponse unique ou à réponses multiples, correction immédiate avec explication
- Bouton **⚑ Signaler** sur chaque question
- CCTL partagés dans Supabase, statistiques dans `localStorage`, PDF analysés gardés en cache dans IndexedDB
- Responsive PC / tablette / mobile, sans serveur à gérer

## Lancer en local

```bash
python -m http.server 8000
```

Puis ouvre http://localhost:8000. Un serveur est nécessaire : ouvrir `index.html` en double-cliquant ne fonctionne pas.

## Publier sur GitHub Pages

1. Crée un dépôt, par exemple `cctl-trainer`.
2. Ajoute à la racine `index.html`, `style.css`, `app.js`, `pdf-import.js` et le dossier `lib/` (`supabase.sql` et `pdf/` sont facultatifs).
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
