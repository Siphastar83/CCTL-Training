# CCTL Trainer

Plateforme d'entraînement aux CCTL, **sur invitation**. Les QCM sont générés automatiquement à partir des PDF de correction ; la progression est enregistrée par utilisateur.
Le site est statique (GitHub Pages) et la base de données est sur Supabase (gratuit).

## Ce que voit un membre

| Page | Contenu |
|---|---|
| **Accueil** | Bonjour + chiffres clés, les CCTL de **son année**, « Reprendre » le dernier CCTL, questions ratées à revoir en priorité |
| **CCTL** | Organisés par **année → bloc → CCTL**, avec un onglet par année (la sienne par défaut). Une carte par CCTL avec sa barre de maîtrise. Dans un CCTL : 3 modes et la carte des questions (vert = réussie, rouge = ratée, gris = jamais vue) |
| **Ma progression** | Maîtrise par CCTL, taux de réussite, historique des sessions |
| **Mes CCTL** | Import de PDF perso (visibles par soi seul) ; l'admin peut aussi partager avec tout le monde |
| **Profil** | Pseudo, **année**, changement de mot de passe, déconnexion. Pour l'admin : invitations, signalements, membres |

### Les 3 modes d'entraînement
- **QCM rapide** : 10 questions tirées au hasard, correction après chaque question.
- **Examen** : toutes les questions dans un ordre aléatoire, correction après chaque question.
- **Révision** : seulement les questions pas encore réussies. Une réponse fausse revient plus loin dans la session, jusqu'à ce que toutes soient validées. La progression est conservée d'une session à l'autre (« Remettre à zéro » sur la page du CCTL pour repartir de rien).

Chaque question a un bouton **⚑ Signaler** : le signalement arrive dans le Profil de l'admin, avec un bouton « Voir la question ».

## Années et blocs

- Chaque CCTL a une **année** (A1…A5), un **bloc** (ex. *Sciences fondamentales*), une matière et un nom.
  À l'import, le bloc est détecté depuis le titre du PDF (« **Sciences fondamentales** - Mathématiques (CCTL) ») et l'année quand elle y figure (« FISA **A3** »). Sinon, l'année de la personne qui importe est proposée. Tout se corrige dans la fenêtre d'import.
- **Renommer / reclasser** : bouton **✎ Modifier** sur la page d'un CCTL ou dans *Mes CCTL* (l'admin pour les CCTL partagés, chacun pour ses CCTL perso).
- Chaque utilisateur choisit **son année** à l'inscription. Elle **avance seule le 1er septembre** (A3 → A4…) jusqu'à la dernière année ; on peut la corriger dans le Profil (redoublement).
  Techniquement : on stocke l'année choisie et la rentrée où elle a été choisie, et l'année actuelle est calculée, sans aucune tâche planifiée.
- La liste des années se modifie dans `config.js` (`YEAR_LABELS`).

## Comptes et invitations

- **Connexion obligatoire.** Sans compte, on ne voit que l'écran de connexion, et la base refuse toute lecture.
- **Inscription uniquement avec un lien d'invitation** (`…/?invite=CODE`) : pseudo + mot de passe, **sans e-mail**.
  En interne, chaque pseudo est associé à une adresse fictive `pseudo@users.cctl-trainer.app` (aucun e-mail n'est envoyé).
- Le contrôle est fait **dans la base** : un déclencheur refuse toute création de compte sans invitation valide, même par un appel direct à l'API.
- Profil → **Liens d'invitation** : un lien pour 1, 5, 20 personnes ou illimité ; expiration à 7 jours, 30 jours ou jamais ; révocable à tout moment.
- Profil → **Membres** : « Retirer l'accès » bloque immédiatement un membre.

## Installation / mise à jour de Supabase

1. **SQL Editor → New query** : colle `supabase.sql`, puis **Run**. Le script se relance sans risque et migre une base de la version précédente : ton compte admin existant est repris automatiquement, avec pour pseudo la partie de ton e-mail avant « @ ».
2. **Authentication → Sign In / Providers → Email** :
   - **Confirm email : désactivé** (sinon les inscriptions sans e-mail ne peuvent pas aboutir) ;
   - **Allow new users to sign up : activé** (les inscriptions restent bloquées sans invitation valide grâce au script).
3. Dans **`config.js`**, renseigne l'URL du projet et la **Publishable key** (`sb_publishable_…`, Project Settings → API Keys). Ne mets **jamais** la Secret key : ce fichier est public, comme tout le site.
4. Connecte-toi sur le site avec ton **e-mail** admin (ou ton pseudo si tu t'es inscrit par invitation) et ton mot de passe.

**Nouveau projet, sans compte admin ?** Après avoir exécuté le script :
```sql
insert into public.cctl_invites (code, note, max_uses) values ('premier-admin-XXXX', 'admin', 1);
```
Ouvre `https://ton-site/?invite=premier-admin-XXXX`, crée ton compte, puis :
```sql
update public.cctl_profiles set role = 'admin' where username = 'tonpseudo';
```

⚠️ Une fois le script en place, le bouton **Add user** du tableau de bord Supabase est refusé (pas d'invitation). Passe par les liens d'invitation.

Un projet Supabase gratuit se met en pause après 7 jours sans visite. Le site affiche alors un message ; il suffit de cliquer sur **Restore project** dans le tableau de bord.

## Ajouter un CCTL

**Mes CCTL** → glisse le PDF de correction. Le site :
1. vérifie s'il est **déjà importé** (même fichier) ou **déjà présent** (même sujet dans un autre fichier, par exemple le PDF d'un camarade) ;
2. crée les questions (texte, code, schémas, tableaux, formules, bonnes réponses, explications) ;
3. les enregistre : en **perso** (visible par soi seul) ou, pour l'admin, en **partagé avec tout le monde**.

Le PDF lui-même, avec le nom et les notes de l'élève, n'est jamais envoyé : seulement les questions.

## Publier sur GitHub Pages

À la racine du dépôt : `index.html`, `style.css`, `config.js`, `app.js`, `pdf-import.js` et le dossier `lib/`. `supabase.sql` et `README.md` peuvent y rester (ils ne contiennent rien de secret).
**Settings → Pages → Deploy from a branch → main / (root)**.

## Fichiers

| Fichier | Rôle |
|---|---|
| `config.js` | **Ta configuration** : URL Supabase, clé publishable, liste des années |
| `app.js` | Application : connexion, pages, modes, progression, administration |
| `pdf-import.js` | Convertisseur PDF → questions (PDF.js, dans le navigateur) |
| `supabase.sql` | Tables, règles d'accès (RLS), invitations |
| `lib/` | PDF.js (Mozilla, licence Apache 2.0) |

## Limites

- Le convertisseur est fait pour le format de correction des CCTL. Un sujet sans corrigé ou un scan ne donnera pas de questions.
- La bonne réponse est celle cochée dans le PDF : si le corrigé officiel se trompe, le site aussi. C'est à ça que sert le bouton **Signaler**.
- Si tu modifies `pdf-import.js`, augmente `PARSER_VERSION`.
