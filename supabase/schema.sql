-- Unser Kühlschrank: gemeinsame, private Daten pro Haushalt.
-- Einmal im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Jede Zeile gehört einem Haushalt. Row Level Security sorgt dafür, dass nur
-- angemeldete Mitglieder dieses Haushalts sie lesen oder ändern können.

create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Unser Haushalt',
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6)),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Alle App-Daten in einer Tabelle: kind = item | list | product | shop | dismissed | never
create table if not exists public.entries (
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (household_id, kind, id)
);

-- Hilfsfunktion: ist der angemeldete Nutzer Mitglied dieses Haushalts?
create or replace function public.is_member(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from household_members where household_id = hid and user_id = auth.uid());
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.entries enable row level security;

drop policy if exists "Mitglieder sehen ihren Haushalt" on public.households;
create policy "Mitglieder sehen ihren Haushalt" on public.households
  for select to authenticated using (public.is_member(id));

drop policy if exists "Mitglieder sehen Mitglieder" on public.household_members;
create policy "Mitglieder sehen Mitglieder" on public.household_members
  for select to authenticated using (public.is_member(household_id));

drop policy if exists "Mitglieder lesen" on public.entries;
create policy "Mitglieder lesen" on public.entries
  for select to authenticated using (public.is_member(household_id));
drop policy if exists "Mitglieder schreiben" on public.entries;
create policy "Mitglieder schreiben" on public.entries
  for insert to authenticated with check (public.is_member(household_id));
drop policy if exists "Mitglieder ändern" on public.entries;
create policy "Mitglieder ändern" on public.entries
  for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));
-- Bewusst keine Lösch-Erlaubnis: Die App markiert Gelöschtes nur (data.deleted = true).
-- So verschickt der Live-Abgleich keine Lösch-Meldungen, die RLS nicht filtern kann.
drop policy if exists "Mitglieder löschen" on public.entries;

-- Haushalt anlegen (der Ersteller wird automatisch Mitglied)
create or replace function public.create_household(hname text default 'Unser Haushalt')
returns public.households language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  insert into households(name, created_by) values (coalesce(nullif(trim(hname), ''), 'Unser Haushalt'), auth.uid()) returning * into h;
  insert into household_members(household_id, user_id) values (h.id, auth.uid());
  return h;
end $$;

-- Mit Einladungscode beitreten
create or replace function public.join_household(code text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  select * into h from households where invite_code = upper(trim(code));
  if h.id is null then raise exception 'Einladungscode unbekannt'; end if;
  insert into household_members(household_id, user_id) values (h.id, auth.uid()) on conflict do nothing;
  return h;
end $$;

revoke all on function public.create_household(text) from public, anon;
revoke all on function public.join_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;

-- Live-Abgleich zwischen den Handys
do $$ begin
  alter publication supabase_realtime add table public.entries;
exception when duplicate_object then null; end $$;
