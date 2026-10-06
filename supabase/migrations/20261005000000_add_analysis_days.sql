alter table public.germinacao_counts
  add column if not exists analysis_days integer not null default 5 check (analysis_days > 0);

alter table public.germinacao_counts
  drop constraint if exists germinacao_counts_unique_v2;

alter table public.germinacao_counts
  add constraint germinacao_counts_unique_v3 unique (device_id, trial_code, kind, mounting_id, dat, analysis_days);

create index if not exists germinacao_counts_device_mounting_dat_analysis_idx
  on public.germinacao_counts (device_id, mounting_id, dat, analysis_days);
