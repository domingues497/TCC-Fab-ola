alter table public.germinacao_meta
  add column if not exists mountings jsonb;

alter table public.germinacao_counts
  add column if not exists mounting_id text not null default 'default';

alter table public.germinacao_counts
  drop constraint if exists germinacao_counts_device_id_trial_code_kind_dat_key;

alter table public.germinacao_counts
  drop constraint if exists germinacao_counts_unique;

alter table public.germinacao_counts
  add constraint germinacao_counts_unique_v2 unique (device_id, trial_code, kind, mounting_id, dat);

create index if not exists germinacao_counts_device_mounting_dat_idx
  on public.germinacao_counts (device_id, mounting_id, dat);
