-- =====================================================================
-- CCTL Trainer v4 : comptes sur invitation, CCTL partagés / privés,
-- progression par utilisateur.
-- À exécuter dans Supabase : SQL Editor → New query → coller → Run.
-- Le script peut être relancé sans risque, y compris sur une base v3.
-- =====================================================================

-- ---------- 1. Tables ----------

-- CCTL convertis depuis les PDF (les PDF ne sont jamais stockés)
create table if not exists public.cctl_docs (
  id             uuid primary key default gen_random_uuid(),
  sha            text not null,
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
alter table public.cctl_docs add column if not exists visibility text not null default 'shared';
alter table public.cctl_docs add column if not exists owner uuid default auth.uid() references auth.users(id) on delete cascade;
alter table public.cctl_docs drop constraint if exists cctl_docs_sha_key;
alter table public.cctl_docs drop constraint if exists cctl_docs_visibility_check;
alter table public.cctl_docs add constraint cctl_docs_visibility_check check (visibility in ('shared','private'));
alter table public.cctl_docs add column if not exists year int;            -- 1 = A1, 2 = A2…
alter table public.cctl_docs add column if not exists bloc text not null default '';
create unique index if not exists cctl_docs_shared_sha  on public.cctl_docs (sha) where visibility = 'shared';
create unique index if not exists cctl_docs_private_sha on public.cctl_docs (owner, sha) where visibility = 'private';

-- Profils : un profil = un membre autorisé (créé uniquement via une invitation valide)
create table if not exists public.cctl_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  role        text not null default 'user' check (role in ('user','admin')),
  invite_code text,
  created_at  timestamptz not null default now()
);
-- année de l'utilisateur : year = année choisie, year_set_at = rentrée (ex. 2026 pour 2026-2027) où elle a été choisie.
-- L'année actuelle = year + (rentrée actuelle - year_set_at) : elle augmente seule chaque 1er septembre.
alter table public.cctl_profiles add column if not exists year int;
alter table public.cctl_profiles add column if not exists year_set_at int;

-- Liens d'invitation
create table if not exists public.cctl_invites (
  code       text primary key,
  note       text not null default '',
  max_uses   int,                                   -- null = illimité
  uses       int not null default 0,
  revoked    boolean not null default false,
  expires_at timestamptz,                           -- null = jamais
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Progression : dernier résultat par question et par utilisateur
create table if not exists public.cctl_progress (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc_id       uuid not null references public.cctl_docs(id) on delete cascade,
  qnum         int  not null,
  seen         int  not null default 0,
  correct      int  not null default 0,
  last_correct boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (user_id, doc_id, qnum)
);

-- Historique des sessions
create table if not exists public.cctl_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc_id     uuid references public.cctl_docs(id) on delete cascade,
  mode       text not null,
  score      int  not null,
  total      int  not null,
  created_at timestamptz not null default now()
);
create index if not exists cctl_sessions_user on public.cctl_sessions (user_id, created_at desc);

-- Signalements de questions
create table if not exists public.cctl_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc_id     uuid references public.cctl_docs(id) on delete cascade,
  qnum       int  not null,
  reason     text not null,
  comment    text not null default '',
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- 2. Fonctions ----------

create or replace function public.cctl_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists cctl_docs_touch on public.cctl_docs;
create trigger cctl_docs_touch before update on public.cctl_docs
  for each row execute function public.cctl_touch();

create or replace function public.cctl_is_member() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cctl_profiles where id = auth.uid());
$$;

create or replace function public.cctl_is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cctl_profiles where id = auth.uid() and role = 'admin');
$$;

-- rentrée universitaire en cours (bascule le 1er septembre)
create or replace function public.cctl_academic_year() returns int
  language sql stable as $$ select extract(year from (now() at time zone 'Europe/Paris') - interval '8 months')::int $$;

-- chacun peut changer SON année (pas son rôle)
create or replace function public.cctl_set_my_year(p_year int) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if p_year is not null and (p_year < 1 or p_year > 10) then raise exception 'année invalide'; end if;
  update public.cctl_profiles set year = p_year, year_set_at = public.cctl_academic_year() where id = auth.uid();
end $$;
grant execute on function public.cctl_set_my_year(int) to authenticated;

-- Vérifications accessibles avant connexion (écran d'inscription)
create or replace function public.cctl_check_invite(p_code text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cctl_invites
    where code = p_code and not revoked
      and (max_uses is null or uses < max_uses)
      and (expires_at is null or expires_at > now()));
$$;
create or replace function public.cctl_username_free(p_username text) returns boolean
  language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.cctl_profiles where username = lower(p_username));
$$;
grant execute on function public.cctl_check_invite(text)  to anon, authenticated;
grant execute on function public.cctl_username_free(text) to anon, authenticated;

-- Toute création de compte DOIT porter une invitation valide, sinon elle est refusée.
create or replace function public.cctl_handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_code text := new.raw_user_meta_data ->> 'invite';
  v_user text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_year int  := nullif(new.raw_user_meta_data ->> 'year', '')::int;
begin
  if v_code is null or v_code = '' then
    raise exception 'CCTL: invitation requise';
  end if;
  if v_user !~ '^[a-z0-9_.-]{3,20}$' then
    raise exception 'CCTL: pseudo invalide';
  end if;
  update public.cctl_invites set uses = uses + 1
   where code = v_code and not revoked
     and (max_uses is null or uses < max_uses)
     and (expires_at is null or expires_at > now());
  if not found then
    raise exception 'CCTL: invitation invalide ou expirée';
  end if;
  insert into public.cctl_profiles (id, username, role, invite_code, year, year_set_at)
    values (new.id, v_user, 'user', v_code, v_year, public.cctl_academic_year());
  return new;
end $$;
drop trigger if exists cctl_on_auth_user_created on auth.users;
create trigger cctl_on_auth_user_created after insert on auth.users
  for each row execute function public.cctl_handle_new_user();

-- ---------- 3. Migration depuis la v3 (anciens administrateurs) ----------
do $$ begin
  if to_regclass('public.cctl_admins') is not null then
    insert into public.cctl_profiles (id, username, role)
      select a.user_id, lower(split_part(u.email, '@', 1)), 'admin'
      from public.cctl_admins a join auth.users u on u.id = a.user_id
    on conflict (id) do update set role = 'admin';
  end if;
end $$;

-- ---------- 4. Règles d'accès (RLS) ----------
alter table public.cctl_docs     enable row level security;
alter table public.cctl_profiles enable row level security;
alter table public.cctl_invites  enable row level security;
alter table public.cctl_progress enable row level security;
alter table public.cctl_sessions enable row level security;
alter table public.cctl_reports  enable row level security;

-- supprime toutes les anciennes règles cctl_* avant de recréer
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename like 'cctl\_%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- CCTL : réservés aux membres ; partagés = tous les membres, privés = leur propriétaire
create policy docs_select on public.cctl_docs for select
  using (public.cctl_is_member() and (visibility = 'shared' or owner = auth.uid()));
create policy docs_insert on public.cctl_docs for insert
  with check ((visibility = 'private' and owner = auth.uid() and public.cctl_is_member())
           or (visibility = 'shared' and public.cctl_is_admin()));
create policy docs_update on public.cctl_docs for update
  using ((visibility = 'shared' and public.cctl_is_admin()) or owner = auth.uid())
  with check ((visibility = 'private' and owner = auth.uid()) or public.cctl_is_admin());
create policy docs_delete on public.cctl_docs for delete
  using ((visibility = 'shared' and public.cctl_is_admin()) or owner = auth.uid());

-- Profils : chacun voit le sien, l'admin voit et gère tout le monde
create policy profiles_select on public.cctl_profiles for select
  using (id = auth.uid() or public.cctl_is_admin());
create policy profiles_update on public.cctl_profiles for update
  using (public.cctl_is_admin()) with check (public.cctl_is_admin());
create policy profiles_delete on public.cctl_profiles for delete
  using (public.cctl_is_admin() and id <> auth.uid());

-- Invitations : admin uniquement
create policy invites_admin on public.cctl_invites for all
  using (public.cctl_is_admin()) with check (public.cctl_is_admin());

-- Progression et sessions : chacun les siennes
create policy progress_own on public.cctl_progress for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.cctl_is_member());
create policy sessions_own on public.cctl_sessions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.cctl_is_member());

-- Signalements : les membres en créent, l'admin les lit et les traite
create policy reports_insert on public.cctl_reports for insert
  with check (user_id = auth.uid() and public.cctl_is_member());
create policy reports_select on public.cctl_reports for select
  using (user_id = auth.uid() or public.cctl_is_admin());
create policy reports_admin_update on public.cctl_reports for update
  using (public.cctl_is_admin()) with check (public.cctl_is_admin());
create policy reports_admin_delete on public.cctl_reports for delete
  using (public.cctl_is_admin());

-- ---------- 5. Ton compte administrateur ----------
-- Si tu avais déjà exécuté la v3, ton compte est migré automatiquement (rien à faire).
-- Sinon : crée ton compte (Authentication → Users) AVANT d'exécuter ce script…
-- … ou, après coup, exécute (en remplaçant l'e-mail et le pseudo) :
-- insert into public.cctl_profiles (id, username, role)
--   select id, 'tonpseudo', 'admin' from auth.users where email = 'ton.email@exemple.fr'
--   on conflict (id) do update set role = 'admin';
