-- Tabela de dias (calendário do app)
-- Existe um único registro por data. Quando o app abre no dia, ele tenta gravar a data atual;
-- se já existir, apenas atualiza updated_at para confirmar a iteração do dia.

create table if not exists public.dia (
  data_leitura date primary key,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists dia_data_leitura_idx on public.dia (data_leitura);

-- Trigger para atualizar updated_at automaticamente
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_dia_touch_updated_at on public.dia;
create trigger trg_dia_touch_updated_at
before update on public.dia
for each row
execute function public.touch_updated_at();

-- RLS desativado por padrão (mesmo comportamento do restante do app, sem login de usuário)
alter table public.dia enable row level security;

drop policy if exists "dia permitido anonimo" on public.dia;
create policy "dia permitido anonimo"
  on public.dia
  for all
  to anon, authenticated
  using (true)
  with check (true);
