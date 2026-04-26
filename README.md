# Ensaio de Germinação — BI Dashboard

Aplicação web (React + Vite) para registrar contagens de **Vigor** e **Germinação** por tratamento, calcular indicadores e visualizar gráficos/tabelas.

## Sumário

- [Visão geral](#visão-geral)
- [Tecnologias](#tecnologias)
- [Como iniciar o servidor](#como-iniciar-o-servidor)
- [Regras de negócio](#regras-de-negócio)
- [Requisitos funcionais](#requisitos-funcionais)
- [Requisitos não funcionais](#requisitos-não-funcionais)
- [Persistência e arquivos gerados](#persistência-e-arquivos-gerados)
- [Problemas comuns](#problemas-comuns)

## Visão geral

O sistema registra contagens de plântulas por:

- **Tratamentos**: T0 (Testemunha), T1 (Rancona), T2 (Avicts), T3 (Cropstar)
- **Rolos**: R1...Rn (quantidade varia conforme o tipo de contagem e o ensaio)
- **Tipos de plântula**:
  - **N** = Normal
  - **A** = Anormal
  - **M** = Morta
- **DAT**: Dias Após o Tratamento (calculado a partir do “Dia 0” e da data da contagem)
- **Tipo de contagem**: **Vigor** ou **Germinação**
- **Ensaio**: **Principal** ou **Sem vermiculita**

O Dashboard mostra KPIs e gráficos (evolução, distribuição, variação por rolo) e permite exportar em PNG e JSON.

## Tecnologias

- Node.js + npm
- Vite 5
- React 18
- Recharts (gráficos)
- Vite PWA (service worker / cache)

## Como iniciar o servidor

### Pré-requisitos

- Node.js (recomendado: versão 18+)
- npm

### Instalação

```bash
npm install
```

### Subir em modo desenvolvimento

```bash
npm run dev
```

O Vite tenta abrir por padrão em `http://localhost:5173/`. Se a porta estiver ocupada, ele escolhe outra (ex.: 5174).

Para forçar uma porta específica:

```bash
npx vite --host --port 5181 --strictPort
```

### Build (produção)

```bash
npm run build
```

### Preview do build

```bash
npm run preview
```

## Regras de negócio

### 1) DAT (Dias Após o Tratamento)

- O usuário informa:
  - **Dia 0** (data em que os tratamentos foram aplicados)
  - **Data da contagem**
- O sistema calcula:
  - `DAT = (data_contagem - dia0) em dias`
- Regras:
  - A data da contagem não pode ser anterior ao Dia 0
  - O DAT é recalculado automaticamente quando Dia 0 e/ou data da contagem mudam

### 2) Identificação de uma contagem (pode existir no mesmo dia)

Uma contagem é identificada por:

- **DAT**
- **Tipo**: Vigor ou Germinação
- **Ensaio**: Principal ou Sem vermiculita

Regra:

- Pode existir **Vigor e Germinação no mesmo DAT** (e até no mesmo dia), desde que tenham Tipo diferente.
- Se tentar salvar um registro com o mesmo **DAT + Tipo + Ensaio**, o sistema pergunta se deseja **substituir**.

### 3) Estrutura de rolos e sementes por rolo (por ensaio)

O sistema trabalha com a regra “plântulas por rolo”, onde cada rolo possui `sementesPorRolo` sementes.

Presets atuais:

- **Ensaio Principal**
  - **Vigor**: 24 rolos (R1…R24), **25 sementes/rolo**
  - **Germinação**: 12 rolos (R1…R12), **25 sementes/rolo**
- **Ensaio Sem vermiculita**
  - Vigor/Germinação: 5 rolos (R1…R5), **20 sementes/rolo**

### 4) Validação e preenchimento automático

- Cada célula aceita apenas números.
- Limites:
  - `0 <= valor <= sementesPorRolo`
- Atalho:
  - O botão **auto M** calcula `M = sementesPorRolo - N - A`.
  - Se `N + A` ultrapassar `sementesPorRolo`, o sistema sinaliza (e o auto M não preenche com valor negativo).

### 5) Indicadores e gráficos

- **Melhor tratamento**: maior percentual de **N** na contagem “mais recente”.
- **Evolução % Normais por DAT**: linha com `N%` por tratamento ao longo dos DATs.
- **Distribuição (N/A/M) da última contagem**: barras por tratamento com percentuais.
- **Variação por rolo**: barras empilhadas N/A/M por rolo do tratamento selecionado.
- **IVG (Índice de Velocidade de Germinação)**:
  - Fórmula: `IVG = Σ (Ni / DATi)` por tratamento (Ni = total de N do tratamento naquela contagem).
  - Para evitar duplicidade quando existir Vigor e Germinação no mesmo DAT, para KPIs/gráficos o sistema prioriza a contagem de **Germinação** no mesmo DAT.

### 6) Umidade (RAS) — método de estufa

Campos:

- `M1` = recipiente+tampa (tara)
- `M2` = recipiente+amostra úmida
- `M3` = recipiente+amostra seca

Cálculo:

- `Umidade% = ((M2 - M3) / (M2 - M1)) * 100`

Regras:

- `M2 > M1`, `M3 >= M1`, `M3 <= M2`
- Mostra média e amplitude (máx–mín) quando houver replicatas válidas.

## Requisitos funcionais

- RF01: Cadastrar/definir **Dia 0** do ensaio.
- RF02: Criar **Nova Contagem** com data, DAT calculado, tipo (Vigor/Germinação) e ensaio.
- RF03: Registrar valores **N/A/M** por tratamento e por rolo.
- RF04: Preencher automaticamente **M** por rolo (auto M).
- RF05: Salvar contagens permitindo coexistência de Vigor e Germinação no mesmo DAT.
- RF06: Listar histórico de contagens com identificação por DAT/Data/Tipo e percentuais N/A/M por tratamento.
- RF07: Editar uma contagem existente (abrindo no próximo ponto não preenchido).
- RF08: Excluir uma contagem.
- RF09: Exibir KPIs (melhor tratamento, última contagem, total de contagens, IVG).
- RF10: Exibir gráficos (evolução, distribuição, variação por rolo).
- RF11: Registrar cálculo de **umidade** por replicata.
- RF12: Exportar gráficos em **PNG**.
- RF13: Exportar/Importar dados completos em **JSON**.
- RF14: Calendário do ensaio (lista de eventos e atalho para abrir nova contagem numa data).

## Requisitos não funcionais

- RNF01: Interface responsiva (desktop/tablet/celular).
- RNF02: Funcionamento offline parcial (fallback para `localStorage` + PWA).
- RNF03: Persistência local sem exigir banco de dados/servidor de backend para uso básico.
- RNF04: Dados exportáveis (JSON/PNG) para auditoria e backup.
- RNF05: Segurança: não armazenar segredos/credenciais; tudo local.
- RNF06: Robustez: falhas em APIs de storage não podem impedir o uso (uso de fallback).
- RNF07: Usabilidade: navegação por teclado na grade (Enter/Tab) e foco automático no ponto pendente ao editar.

## Persistência e arquivos gerados

### 1) Persistência local

- As contagens são persistidas de forma resiliente:
  - Tenta `window.storage` (quando disponível)
  - Fallback para `localStorage`

### 2) Autosave na raiz do projeto (desenvolvimento)

Quando o servidor de desenvolvimento está rodando, o app envia autosaves para o endpoint interno:

- `POST /__autosave`

O Vite grava/atualiza o arquivo na raiz do projeto:

- `germinacao_bi_autosave.json`

### 3) Export/Import JSON (download/upload)

- Botão **⬇️ JSON**: baixa um arquivo `germinacao_bi_YYYY-MM-DD.json`
- Botão **⬆️ Importar**: carrega um JSON e substitui os dados atuais (com confirmação)

### 4) Export PNG

Nos cards de gráfico do Dashboard há botão **📷 PNG** para baixar a imagem.

## Problemas comuns

### Porta em uso

Se `5173` estiver ocupada:

- o Vite escolhe outra automaticamente, ou
- use uma porta fixa:

```bash
npx vite --host --port 5181 --strictPort
```

### Preview/HTTPS

Este projeto está configurado para rodar com **HTTP** no dev (para compatibilidade com preview local).
Se você ativar HTTPS, alguns ambientes podem acusar erro de SSL.

