create extension if not exists pgcrypto;

create table if not exists public.germinacao_meta (
  device_id text primary key,
  day0 date,
  updated_at timestamptz not null default now()
);

create table if not exists public.germinacao_counts (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  trial_code text not null default 'principal',
  kind text not null check (kind in ('vigor', 'germinacao')),
  dat integer not null check (dat >= 0),
  count_date date,
  rolos_count integer not null check (rolos_count > 0),
  seeds_per_rolo integer not null check (seeds_per_rolo > 0),
  grid jsonb not null,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, trial_code, kind, dat)
);

create index if not exists germinacao_counts_device_dat_idx
  on public.germinacao_counts (device_id, dat);

create table if not exists public.germinacao_moisture (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  trial_code text not null default 'principal',
  rep_label text not null,
  m1 numeric,
  m2 numeric,
  m3 numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, trial_code, rep_label)
);

create index if not exists germinacao_moisture_device_idx
  on public.germinacao_moisture (device_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_germinacao_meta on public.germinacao_meta;
create trigger set_updated_at_germinacao_meta
before update on public.germinacao_meta
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_germinacao_counts on public.germinacao_counts;
create trigger set_updated_at_germinacao_counts
before update on public.germinacao_counts
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_germinacao_moisture on public.germinacao_moisture;
create trigger set_updated_at_germinacao_moisture
before update on public.germinacao_moisture
for each row
execute function public.set_updated_at();

