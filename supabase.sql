-- =====================================================================
-- CCTL Trainer : base partagée Supabase
-- À exécuter une fois dans Supabase : SQL Editor → New query → coller → Run
-- =====================================================================

-- 1. CCTL partagés (questions déjà converties depuis les PDF ; les PDF ne sont jamais stockés)
create table if not exists public.cctl_docs (
  id             uuid primary key default gen_random_uuid(),
  sha            text not null unique,            -- empreinte du PDF : empêche les doublons
  title          text not null,
  subject        text not null default '',
  file_name      text not null default '',
  pages          int  not null default 0,
  questions      jsonb not null,
  parser_version int  not null default 1,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 2. Administrateurs autorisés à partager / retirer des CCTL
create table if not exists public.cctl_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- met à jour updated_at à chaque modification (les visiteurs rechargent alors le CCTL)
create or replace function public.cctl_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists cctl_docs_touch on public.cctl_docs;
create trigger cctl_docs_touch before update on public.cctl_docs
  for each row execute function public.cctl_touch();

-- 3. Règles d'accès (RLS)
alter table public.cctl_docs   enable row level security;
alter table public.cctl_admins enable row level security;

create or replace function public.cctl_is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cctl_admins where user_id = auth.uid());
$$;

drop policy if exists "lecture publique"   on public.cctl_docs;
drop policy if exists "ajout admin"        on public.cctl_docs;
drop policy if exists "modification admin" on public.cctl_docs;
drop policy if exists "suppression admin"  on public.cctl_docs;
drop policy if exists "voir son statut"    on public.cctl_admins;

create policy "lecture publique"   on public.cctl_docs for select using (true);
create policy "ajout admin"        on public.cctl_docs for insert with check (public.cctl_is_admin());
create policy "modification admin" on public.cctl_docs for update using (public.cctl_is_admin()) with check (public.cctl_is_admin());
create policy "suppression admin"  on public.cctl_docs for delete using (public.cctl_is_admin());
create policy "voir son statut"    on public.cctl_admins for select using (user_id = auth.uid());

-- 4. Déclare ton compte administrateur
--    a) Authentication → Users → Add user → Create new user (ton e-mail + un mot de passe, coche « Auto Confirm User »)
--    b) remplace l'e-mail ci-dessous puis exécute cette ligne :
-- insert into public.cctl_admins (user_id) select id from auth.users where email = 'ton.email@exemple.fr';
