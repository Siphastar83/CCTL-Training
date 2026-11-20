/* =====================================================================
   CCTL Trainer — configuration
   Supabase → Project Settings → API Keys :
   - SUPABASE_URL      : l'URL du projet
   - SUPABASE_ANON_KEY : la « Publishable key » (sb_publishable_…)
   Ne mets JAMAIS la « Secret key » (sb_secret_…) ici : ce fichier est public.
   La clé publishable est faite pour être publique, la sécurité vient des règles de supabase.sql.
   ===================================================================== */
export const SUPABASE_URL = "https://cazmobhudpayopjoxcfv.supabase.co"; // ex. "https://abcdefgh.supabase.co"
export const SUPABASE_ANON_KEY =
	"sb_publishable_ZXR_z3ar0GCQ_6FLeYbNEA_2b9Vz8Fh"; // Publishable key, ex. "sb_publishable_…"
/* Années de la formation (1 = première année). L'année de chaque utilisateur
   avance toute seule le 1er septembre, jusqu'à la dernière de la liste. */
export const YEAR_LABELS = ["A1", "A2", "A3", "A4", "A5"];

/* Adresse fictive associée à chaque pseudo (aucun e-mail n'est envoyé). Ne plus la changer une fois des comptes créés. */
export const USER_EMAIL_DOMAIN = "users.cctl-trainer.app";
