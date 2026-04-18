// ╔══════════════════════════════════════════════════════════════╗
// ║         SISTEMA DE GERMINAÇÃO — BI DASHBOARD                 ║
// ║  Objetivo: registrar múltiplas contagens de germinação       ║
// ║  (N=Normal, A=Anormal, M=Morta) por tratamento e rolo,      ║
// ║  calcular KPIs agronômicos e exibir evolução ao longo        ║
// ║  dos DATs (Dias Após o Tratamento).                          ║
// ╚══════════════════════════════════════════════════════════════╝

// ─── IMPORTS ─────────────────────────────────────────────────────
// useState, useEffect, useCallback são "hooks" do React.
// Hooks são funções especiais que permitem guardar estado e
// executar efeitos colaterais dentro de componentes funcionais.
import { useState, useEffect, useCallback, useRef } from "react";

// Recharts é a biblioteca de gráficos que usamos.
// Cada nome importado é um componente de gráfico diferente.
import {
  LineChart, Line,         // Gráfico de linha (evolução no tempo)
  BarChart, Bar,           // Gráfico de barras (comparação)
  XAxis, YAxis,            // Eixos X e Y dos gráficos
  CartesianGrid,           // Grade de fundo do gráfico
  Tooltip, Legend,         // Dica ao passar o mouse + legenda
  ResponsiveContainer,     // Faz o gráfico se adaptar ao tamanho da tela
  ReferenceLine            // Linha de referência (ex: 50%)
} from "recharts";

// ─── CONSTANTES GLOBAIS ──────────────────────────────────────────
// Ficam fora dos componentes para evitar recriação a cada render.

// Os 4 tratamentos do ensaio, cada um com ID, nome e cor
const TREATMENTS = [
  { id: "T0", name: "Testemunha", color: "#c47b6a" }, // Controle sem fungicida
  { id: "T1", name: "Rancona",    color: "#6fa58b" }, // Fungicida Rancona
  { id: "T2", name: "Avicts",     color: "#6f93b5" }, // Fungicida Avicts
  { id: "T3", name: "Cropstar",   color: "#b69b6a" }, // Fungicida Cropstar
];

// Array com os 12 rolos: ["R1", "R2", ..., "R12"]
// Array.from cria um array; o segundo argumento (_, i) ignora o valor
// e usa o índice i para gerar o nome do rolo
const ROLOS = Array.from({ length: 12 }, (_, i) => `R${i + 1}`);

// Os 3 tipos de plântula contados em cada rolo
const TIPOS = ["N", "A", "M"];

// Nomes completos para exibição na interface
const TIPO_LABELS = { N: "Normal", A: "Anormal", M: "Morta" };

// Cores semânticas: verde = saudável, amarelo = atenção, vermelho = problema
const TIPO_COLORS = { N: "#6fa58b", A: "#b69b6a", M: "#c47b6a" };

// Chave usada para identificar os dados no storage persistente
const STORAGE_KEY = "germination_counts_v2";
const LOCAL_FALLBACK_KEY = `${STORAGE_KEY}_offline_backup`;
const META_KEY = "germination_trial_meta_v1";
const LOCAL_META_FALLBACK_KEY = `${META_KEY}_offline_backup`;

function readLocalBackup() {
  try {
    const raw = localStorage.getItem(LOCAL_FALLBACK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalBackup(data) {
  try {
    localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(data));
  } catch {}
}

function readLocalMeta() {
  try {
    const raw = localStorage.getItem(LOCAL_META_FALLBACK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalMeta(data) {
  try {
    localStorage.setItem(LOCAL_META_FALLBACK_KEY, JSON.stringify(data));
  } catch {}
}

function parseDateInput(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function formatPtBrDate(value) {
  if (!value) return "—";
  const d = value.length === 10 ? parseDateInput(value) : new Date(value);
  if (!d || !Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function calcDat(day0, countDate) {
  const d0 = parseDateInput(day0);
  const cd = parseDateInput(countDate);
  if (!d0 || !cd) return null;
  const diffDays = Math.round((cd.getTime() - d0.getTime()) / 86400000);
  return diffDays;
}

const CALENDAR_EVENTS = [
  { dm: "11/04", title: "Início dos testes", detail: "Montagem dos rolos de germinação e caixas gerbox (08:00–12:00)." },
  { dm: "13/04", title: "Montagem (gerbox)", detail: "Montagem dos rolos a partir das sementes das gerbox (19:00–21:30)." },
  { dm: "15/04", title: "Análise + estufa", detail: "Análise dos rolos do dia 11/04 e pacotes na estufa (20:30–21:30)." },
  { dm: "16/04", title: "Triturar e pesar", detail: "Triturar e pesar as sementes dos pacotes." },
  { dm: "18/04", title: "Análise", detail: "Análise dos rolos montados no dia 13/04 (08:00–12:00)." },
  { dm: "25/04", title: "Montagem", detail: "Montagem dos rolos de germinação e gerbox (08:00–12:00)." },
  { dm: "27/04", title: "Montagem (gerbox)", detail: "Montagem de rolos com as sementes da gerbox (19:00–21:00)." },
  { dm: "29/04", title: "Análise + estufa", detail: "Análise dos rolos do dia 25/04 e pacotes na estufa (20:30–…)." },
  { dm: "30/04", title: "Triturar e pesar", detail: "Triturar e pesar as sementes dos pacotes (20:30–…)." },
  { dm: "02/05", title: "Análise", detail: "Análise dos rolos montados no dia 27/04 (08:00–12:00)." },
  { dm: "09/05", title: "Montagem", detail: "Montagem dos rolos de germinação e gerbox (08:00–12:00)." },
  { dm: "11/05", title: "Montagem (gerbox)", detail: "Montagem de rolos com as sementes da gerbox (19:00–21:00)." },
  { dm: "13/05", title: "Análise + estufa", detail: "Análise dos rolos do dia 09/05 e pacotes na estufa (20:30–…)." },
  { dm: "14/05", title: "Triturar e pesar", detail: "Triturar e pesar as sementes dos pacotes (20:30–…)." },
  { dm: "16/05", title: "Análise", detail: "Análise dos rolos montados no dia 11/05 (08:00–12:00)." },
  { dm: "23/05", title: "Montagem", detail: "Montagem dos rolos de germinação e gerbox (08:00–12:00)." },
  { dm: "25/05", title: "Montagem (gerbox)", detail: "Montagem de rolos com as sementes da gerbox (19:00–21:00)." },
  { dm: "27/05", title: "Análise + estufa", detail: "Análise dos rolos do dia 23/05 e pacotes na estufa (20:30–…)." },
  { dm: "28/05", title: "Triturar e pesar", detail: "Triturar e pesar as sementes dos pacotes (20:30–…)." },
  { dm: "30/05", title: "Análise", detail: "Análise dos rolos montados no dia 25/05 (08:00–12:00)." },
  { dm: "06/06", title: "Montagem", detail: "Montagem dos rolos de germinação e gerbox (08:00–12:00)." },
  { dm: "08/06", title: "Montagem (gerbox)", detail: "Montagem de rolos com as sementes da gerbox (19:00–21:00)." },
  { dm: "10/06", title: "Análise + estufa", detail: "Análise dos rolos do dia 06/06 e pacotes na estufa (20:30–…)." },
  { dm: "11/06", title: "Triturar e pesar", detail: "Triturar e pesar as sementes dos pacotes (20:30–…)." },
  { dm: "13/06", title: "Análise", detail: "Análise dos rolos montados no dia 08/06 (08:00–12:00)." },
  { dm: "20/06", title: "Montagem", detail: "Montagem dos rolos de germinação e gerbox (08:00–12:00)." },
  { dm: "22/06", title: "Montagem (gerbox)", detail: "Montagem de rolos com as sementes da gerbox (19:00–21:00)." },
  { dm: "24/06", title: "Análise + estufa", detail: "Análise dos rolos do dia 20/06 e pacotes na estufa (20:30–…)." },
  { dm: "25/06", title: "Triturar e pesar", detail: "Triturar e pesar as sementes dos pacotes (20:30–…)." },
  { dm: "27/06", title: "Análise", detail: "Análise dos rolos montados no dia 22/06 (08:00–12:00)." },
  { dm: "04/07", title: "Montagem", detail: "Montagem dos rolos de germinação e gerbox (08:00–12:00)." },
  { dm: "06/07", title: "Montagem (gerbox)", detail: "Montagem de rolos com as sementes da gerbox (19:00–21:00)." },
  { dm: "08/07", title: "Análise + estufa", detail: "Análise dos rolos do dia 04/07 e pacotes na estufa (20:30–…)." },
  { dm: "11/07", title: "Análise", detail: "Análise dos rolos montados no dia 08/06 (08:00–12:00)." }
];

function dmToIso(dm, baseIsoDate) {
  const m = /^(\d{2})\/(\d{2})$/.exec(dm);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (!day || !month) return null;
  const base = parseDateInput(baseIsoDate);
  const baseYear = base ? base.getFullYear() : new Date().getFullYear();
  let year = baseYear;
  let iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (base) {
    const isoDate = parseDateInput(iso);
    if (isoDate && isoDate.getTime() < base.getTime() && month < base.getMonth() + 1) {
      year += 1;
      iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return iso;
}
const UI = {
  bg: "#f4f6f8",
  surface: "#ffffff",
  surfaceSoft: "#f8fafc",
  border: "#d8e0e8",
  text: "#243447",
  textSoft: "#6b7280",
  accent: "#6f93b5",
};
const FONT_SANS = "'Inter', 'Segoe UI', sans-serif";

// ─── DADOS INICIAIS (DAT 5) ───────────────────────────────────────
// A primeira contagem já inserida (5 dias após o tratamento).
// Estrutura: INITIAL_DAT5[tratamento][rolo] = { N, A, M }
// Cada rolo tem 25 sementes → N + A + M deve ser ≤ 25
const INITIAL_DAT5 = {
  T0: { R1:{N:9,A:8,M:8},R2:{N:12,A:6,M:7},R3:{N:11,A:4,M:10},R4:{N:10,A:8,M:7},
        R5:{N:13,A:5,M:7},R6:{N:9,A:11,M:5},R7:{N:11,A:8,M:6},R8:{N:13,A:8,M:4},
        R9:{N:8,A:11,M:6},R10:{N:6,A:9,M:11},R11:{N:10,A:2,M:13},R12:{N:13,A:3,M:9} },
  T1: { R1:{N:16,A:8,M:1},R2:{N:14,A:8,M:3},R3:{N:14,A:11,M:0},R4:{N:15,A:9,M:1},
        R5:{N:15,A:9,M:1},R6:{N:15,A:9,M:1},R7:{N:16,A:8,M:1},R8:{N:13,A:11,M:1},
        R9:{N:15,A:8,M:2},R10:{N:15,A:9,M:1},R11:{N:13,A:10,M:2},R12:{N:13,A:9,M:3} },
  T2: { R1:{N:8,A:14,M:3},R2:{N:14,A:9,M:2},R3:{N:13,A:9,M:3},R4:{N:15,A:6,M:4},
        R5:{N:12,A:11,M:2},R6:{N:15,A:8,M:2},R7:{N:14,A:7,M:4},R8:{N:13,A:9,M:3},
        R9:{N:17,A:6,M:2},R10:{N:19,A:5,M:1},R11:{N:14,A:7,M:4},R12:{N:17,A:8,M:0} },
  T3: { R1:{N:11,A:12,M:2},R2:{N:14,A:10,M:1},R3:{N:12,A:12,M:1},R4:{N:14,A:10,M:1},
        R5:{N:12,A:11,M:2},R6:{N:14,A:10,M:4},R7:{N:11,A:14,M:0},R8:{N:13,A:11,M:1},
        R9:{N:13,A:8,M:4},R10:{N:18,A:6,M:1},R11:{N:14,A:8,M:3},R12:{N:14,A:8,M:3} },
};

// ─── TEXTOS EXPLICATIVOS DOS CARDS ───────────────────────────────
// Centralizados aqui para facilitar edição sem mexer no JSX.
// Cada chave corresponde a um card/gráfico do dashboard.
const INFO_TEXTS = {
  melhorTratamento:
    "O tratamento com maior percentual de plântulas NORMAIS na contagem mais recente. " +
    "Indica qual fungicida/tratamento promove melhor germinação e vigor de sementes.",

  ultimaContagem:
    "DAT = Dias Após o Tratamento. Indica quantos dias se passaram desde a aplicação " +
    "do tratamento até esta contagem. Contagens típicas: DAT 5 (1ª contagem / vigor), " +
    "DAT 8-10 (contagem final / germinação total). Seguindo normas ISTA.",

  totalContagens:
    "Número de contagens realizadas neste ensaio. Cada contagem é feita " +
    "em um DAT diferente para acompanhar a EVOLUÇÃO da germinação ao longo do tempo. " +
    "Mínimo recomendado: 2 contagens (primeira = vigor, segunda = germinação final).",

  ivg:
    "IVG = Índice de Velocidade de Germinação. Fórmula: Σ(Ni ÷ DATi). " +
    "Ni = plântulas normais na contagem i. DATi = dias após tratamento. " +
    "Quanto MAIOR o IVG, mais rápida e vigorosa é a germinação. " +
    "Sementes de alta qualidade germinam cedo → valor dividido por DAT pequeno → IVG alto.",

  evolucao:
    "Mostra como o % de plântulas normais EVOLUI ao longo dos DATs para cada tratamento. " +
    "Curva crescente = germinação gradual e saudável. " +
    "Curva que estabiliza cedo = sementes de alto vigor. " +
    "A linha pontilhada em 50% representa o padrão mínimo para sementes comerciais (MAPA/ISTA).",

  distribuicao:
    "Distribuição percentual (Normal / Anormal / Morta) por tratamento na ÚLTIMA contagem. " +
    "Permite comparação visual rápida entre T0, T1, T2 e T3. " +
    "Verde (Normais) alto = bom tratamento. Vermelho (Mortas) alto = possível fitotoxicidade ou " +
    "baixa qualidade fisiológica do lote.",

  variacaoRolo:
    "Cada barra representa UM rolo (25 sementes) do tratamento selecionado. " +
    "As barras são EMPILHADAS: verde (N) + amarelo (A) + vermelho (M) = 25. " +
    "Alta variação entre rolos indica inconsistência no umedecimento do papel ou " +
    "na distribuição das sementes. Ideal: barras de altura similar com máximo de verde.",

  historico:
    "Lista de todas as contagens em ordem cronológica de DAT. " +
    "As mini-barras coloridas mostram o % de normais de cada tratamento naquela data. " +
    "Use ✏️ Editar para corrigir valores já salvos. " +
    "Use 🗑 para remover uma contagem permanentemente.",
};

// ─── FUNÇÕES UTILITÁRIAS ─────────────────────────────────────────

/**
 * emptyGrid()
 * Cria uma grade vazia para o formulário de entrada de dados.
 * Usa string vazia "" em vez de 0 para distinguir "não preenchido" de "zero sementes".
 * Retorna: { T0: { R1: { N:"", A:"", M:"" }, R2: {...}, ... }, T1: {...}, ... }
 */
function emptyGrid() {
  const g = {};
  TREATMENTS.forEach(t => {
    g[t.id] = {};
    ROLOS.forEach(r => {
      g[t.id][r] = { N: "", A: "", M: "" };
    });
  });
  return g;
}

/**
 * sumTreatment(grid, tid)
 * Soma N, A, M de todos os 12 rolos de um tratamento.
 * O operador ?. evita erros se o rolo ainda não existir.
 * @returns {{ N, A, M, total }}
 */
function sumTreatment(grid, tid) {
  let N = 0, A = 0, M = 0;
  ROLOS.forEach(r => {
    N += Number(grid[tid]?.[r]?.N || 0);
    A += Number(grid[tid]?.[r]?.A || 0);
    M += Number(grid[tid]?.[r]?.M || 0);
  });
  return { N, A, M, total: N + A + M };
}

/**
 * calcIVG(counts)
 * IVG = Σ (Ni / DATi) — Índice de Velocidade de Germinação.
 * Quanto maior, mais rápido e vigoroso é o tratamento.
 * @param {Array} counts - [{ dat, grid, savedAt }, ...]
 * @returns {{ T0: "12.34", T1: "20.56", ... }}
 */
function calcIVG(counts) {
  const ivg = {};
  TREATMENTS.forEach(t => {
    let sum = 0;
    counts.forEach(c => {
      const { N } = sumTreatment(c.grid, t.id);
      if (c.dat > 0) sum += N / c.dat; // Normais dividido pelo DAT
    });
    ivg[t.id] = sum.toFixed(2); // 2 casas decimais
  });
  return ivg;
}

// ─── ESTILOS REUTILIZÁVEIS ────────────────────────────────────────
// No React, estilos inline são objetos JavaScript.

// card() retorna estilo base dos painéis; "extra" sobrescreve propriedades
const card = (extra = {}) => ({
  background: UI.surface,
  border: `1px solid ${UI.border}`,
  borderRadius: 10,
  padding: "18px 20px",
  ...extra,
});

// Estilo padrão dos títulos de seção
const secTitle = {
  fontFamily: FONT_SANS,
  fontSize: 10, color: UI.textSoft,
  letterSpacing: 1, marginBottom: 0,
};

// Estilo para campos de texto/número
const inputStyle = {
  background: UI.surface, border: `1px solid ${UI.border}`, borderRadius: 6,
  color: UI.text, fontFamily: FONT_SANS,
  fontSize: 13, padding: "6px 10px", outline: "none",
};

// ─── COMPONENTE: InfoTooltip ──────────────────────────────────────
/**
 * Ícone "?" que ao ser hover/clicado exibe uma explicação em balão.
 * Props: text {string} — texto a ser exibido
 */
function InfoTooltip({ text }) {
  // "open" controla visibilidade do balão
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {/* Ícone clicável */}
      <span
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 16, height: 16, borderRadius: "50%",
          background: open ? UI.accent : "#e2e8f0",
          color: open ? "#fff" : UI.textSoft,
          fontSize: 10, fontFamily: FONT_SANS,
          cursor: "pointer", userSelect: "none", flexShrink: 0, marginLeft: 6,
          transition: "all 0.15s",
        }}
      >?</span>

      {/* Balão de explicação — só renderizado quando open === true */}
      {open && (
        <span style={{
          position: "absolute", top: 22, left: "50%",
          transform: "translateX(-50%)",   // Centraliza horizontalmente
          background: UI.surface,
          border: `1px solid ${UI.border}`,
          borderRadius: 8, padding: "10px 14px",
          fontSize: 11, color: UI.textSoft, lineHeight: 1.6,
          width: 270, zIndex: 1000,         // zIndex alto = fica acima de tudo
          boxShadow: "0 10px 24px rgba(15, 23, 42, 0.12)",
          fontFamily: FONT_SANS,
          pointerEvents: "none",            // Não bloqueia cliques abaixo
        }}>
          {/* Triângulo decorativo no topo */}
          <span style={{
            position: "absolute", top: -6, left: "50%",
            transform: "translateX(-50%)",
            width: 0, height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderBottom: `6px solid ${UI.border}`,
          }} />
          {text}
        </span>
      )}
    </span>
  );
}

// ─── COMPONENTE: CardTitle ────────────────────────────────────────
/**
 * Título padronizado para cards com emoji + texto + tooltip.
 * Props: emoji, title, infoKey (chave em INFO_TEXTS), extra (estilos extras)
 */
function CardTitle({ emoji, title, infoKey, extra = {} }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 14, ...extra }}>
      <h3 style={{ ...secTitle, flex: 1 }}>{emoji} {title}</h3>
      {infoKey && <InfoTooltip text={INFO_TEXTS[infoKey]} />}
    </div>
  );
}

// ─── COMPONENTE: ChartTip ─────────────────────────────────────────
/**
 * Tooltip customizado para gráficos Recharts.
 * O Recharts injeta automaticamente: active, payload, label.
 */
const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: UI.surface, border: `1px solid ${UI.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 11, fontFamily: FONT_SANS }}>
      <p style={{ color: UI.textSoft, marginBottom: 5 }}>{label} DAT</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, margin: "2px 0" }}>
          {p.name}: {typeof p.value === "number" ? p.value.toFixed(1) : p.value}{p.unit || "%"}
        </p>
      ))}
    </div>
  );
};

// ─── COMPONENTE: KPIBlock ─────────────────────────────────────────
/**
 * Card de KPI — número importante com contexto visual.
 * Props: label, val, sub, color, tag (badge), small (versão compacta), infoKey
 */
function KPIBlock({ label, val, sub, color, tag, small, infoKey }) {
  return (
    <div style={{
      background: UI.surface,
      border: `1px solid ${color}33`,    // Cor com 20% de opacidade
      borderLeft: `3px solid ${color}`,  // Destaque lateral colorido
      borderRadius: 8,
      padding: small ? "10px 14px" : "13px 18px",
      flex: 1, minWidth: small ? 90 : 130,
      position: "relative",
    }}>
      {/* Badge de destaque (ex: "LÍDER") */}
      {tag && (
        <span style={{
          position: "absolute", top: 7, right: 8,
          fontSize: 9, fontFamily: FONT_SANS,
          color, background: `${color}22`,
          padding: "1px 6px", borderRadius: 4,
        }}>{tag}</span>
      )}
      {/* Label + tooltip lado a lado */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 3 }}>
        <div style={{ color: UI.textSoft, fontSize: 9, fontFamily: FONT_SANS, letterSpacing: 0.4, flex: 1 }}>
          {label}
        </div>
        {infoKey && <InfoTooltip text={INFO_TEXTS[infoKey]} />}
      </div>
      {/* Valor principal */}
      <div style={{ color, fontSize: small ? 20 : 26, fontFamily: FONT_SANS, fontWeight: 600, letterSpacing: 0.2 }}>
        {val}
      </div>
      {/* Subtexto descritivo */}
      {sub && <div style={{ color: UI.textSoft, fontSize: 10, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: App
// Controla navegação, estado global e persistência de dados.
// ══════════════════════════════════════════════════════════════════
export default function App() {

  // ── ESTADO ──────────────────────────────────────────────────────
  const [view, setView]               = useState("dashboard"); // Tela ativa
  const [counts, setCounts]           = useState([]);          // Array de contagens salvas
  const [loading, setLoading]         = useState(true);        // Carregamento inicial
  const [dat, setDat]                 = useState("");          // DAT do formulário
  const [day0, setDay0]               = useState("");          // Dia 0 do ensaio (data do tratamento)
  const [countDate, setCountDate]     = useState("");          // Data da contagem (yyyy-mm-dd)
  const [grid, setGrid]               = useState(emptyGrid()); // Dados N/A/M do formulário
  const [activeTreat, setActiveTreat] = useState("T0");        // Aba ativa no formulário
  const [saved, setSaved]             = useState(false);       // Animação de confirmação
  const [editIdx, setEditIdx]         = useState(null);        // null = novo, número = edição
  const [showTrial, setShowTrial]     = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const countsRef                     = useRef([]);

  // ── PERSISTIR DADOS ──────────────────────────────────────────────
  // useCallback evita recriar a função a cada render
  const persist = useCallback(async (next) => {
    setCounts(next); // Atualiza UI imediatamente
    writeLocalBackup(next); // Mantém últimos dados disponíveis offline
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(next)); } catch {}
  }, []);

  // ── CARREGAR DADOS AO INICIAR ────────────────────────────────────
  // useEffect com [] executa UMA vez ao montar o componente
  useEffect(() => {
    (async () => {
      try {
        try {
          const metaRes = await window.storage.get(META_KEY);
          if (metaRes?.value) {
            const meta = JSON.parse(metaRes.value);
            if (meta?.day0) setDay0(meta.day0);
            writeLocalMeta(meta);
          } else {
            const localMeta = readLocalMeta();
            if (localMeta?.day0) setDay0(localMeta.day0);
          }
        } catch {
          const localMeta = readLocalMeta();
          if (localMeta?.day0) setDay0(localMeta.day0);
        }

        const res = await window.storage.get(STORAGE_KEY);
        if (res?.value) {
          const parsed = JSON.parse(res.value);
          setCounts(parsed); // Restaura dados salvos
          writeLocalBackup(parsed);
        } else {
          const local = readLocalBackup();
          if (local?.length) {
            setCounts(local);
          } else {
            // Sem dados: usa DAT 5 como ponto de partida
            const seed = [{ dat: 5, grid: INITIAL_DAT5, savedAt: new Date().toISOString() }];
            setCounts(seed);
            writeLocalBackup(seed);
            await window.storage.set(STORAGE_KEY, JSON.stringify(seed));
          }
        }
      } catch {
        // Se storage remoto falhar (offline), tenta backup local recente
        const local = readLocalBackup();
        if (local?.length) {
          setCounts(local);
        } else {
          // Sem backup local, mantém seed inicial
          const seed = [{ dat: 5, grid: INITIAL_DAT5, savedAt: new Date().toISOString() }];
          setCounts(seed);
          writeLocalBackup(seed);
        }
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const meta = { day0 };
    writeLocalMeta(meta);
    (async () => {
      try {
        await window.storage.set(META_KEY, JSON.stringify(meta));
      } catch {}
    })();
  }, [day0]);

  useEffect(() => {
    if (!day0 || !countDate) return;
    const d = calcDat(day0, countDate);
    if (d === null || d < 0) return;
    setDat(String(d));
  }, [day0, countDate]);

  useEffect(() => {
    countsRef.current = counts;
  }, [counts]);

  useEffect(() => {
    if (!day0) return;
    const current = countsRef.current || [];
    if (!current.length) return;
    let changed = false;
    const next = current
      .map(c => {
        if (!c.countDate) return c;
        const d = calcDat(day0, c.countDate);
        if (d === null || d < 0) return c;
        if (c.dat !== d) changed = true;
        return { ...c, dat: d };
      })
      .sort((a, b) => a.dat - b.dat);
    if (changed) persist(next);
  }, [day0, persist]);

  useEffect(() => {
    if (!loading && !day0) setShowTrial(true);
  }, [loading, day0]);

  // ── SALVAR CONTAGEM ──────────────────────────────────────────────
  const handleSave = async () => {
    if (!day0) return alert("Informe a data do Dia 0 (tratamento) para calcular o DAT.");
    if (!countDate) return alert("Informe a data da contagem.");
    const d = calcDat(day0, countDate);
    if (d === null) return alert("Informe datas válidas para Dia 0 e para a contagem.");
    if (d < 0) return alert("A data da contagem não pode ser anterior ao Dia 0.");
    const entry = { dat: d, grid, countDate, savedAt: new Date().toISOString() };
    let next;
    if (editIdx !== null) {
      // Edição: substitui o item no índice editIdx
      next = counts.map((c, i) => i === editIdx ? entry : c);
    } else {
      const exists = counts.findIndex(c => c.dat === d);
      if (exists >= 0 && !window.confirm(`Já existe contagem no DAT ${d}. Substituir?`)) return;
      next = exists >= 0
        ? counts.map((c, i) => i === exists ? entry : c)
        : [...counts, entry].sort((a, b) => a.dat - b.dat); // Mantém ordem crescente
    }
    await persist(next);
    setSaved(true);
    setTimeout(() => { setSaved(false); setView("dashboard"); setEditIdx(null); }, 1200);
  };

  // ── INICIAR EDIÇÃO ───────────────────────────────────────────────
  const startEdit = (idx) => {
    const c = counts[idx];
    setDat(String(c.dat));
    setCountDate(String((c.countDate || c.savedAt || "").slice(0, 10)));
    setGrid(JSON.parse(JSON.stringify(c.grid))); // Cópia profunda para não mutar o original
    setEditIdx(idx);
    setView("entry");
    setActiveTreat("T0");
  };

  // ── DELETAR CONTAGEM ─────────────────────────────────────────────
  const deleteCount = async (idx) => {
    if (!window.confirm("Remover esta contagem?")) return;
    await persist(counts.filter((_, i) => i !== idx));
  };

  // ── NOVA CONTAGEM ────────────────────────────────────────────────
  const startNew = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setCountDate(`${yyyy}-${mm}-${dd}`);
    setDat(""); setGrid(emptyGrid()); setEditIdx(null);
    setActiveTreat("T0"); setView("entry");
  };

  const startNewAtDate = (isoDate) => {
    setCountDate(isoDate);
    setDat(""); setGrid(emptyGrid()); setEditIdx(null);
    setActiveTreat("T0"); setView("entry");
  };

  // ── ATUALIZAR CÉLULA ─────────────────────────────────────────────
  // Spread operator (...) garante imutabilidade (não altera o estado diretamente)
  const setCell = (rolo, tipo, val) => {
    setGrid(prev => ({
      ...prev,
      [activeTreat]: {
        ...prev[activeTreat],
        [rolo]: { ...prev[activeTreat][rolo], [tipo]: val === "" ? "" : Number(val) }
      }
    }));
  };

  // ── PREENCHER MORTAS AUTOMATICAMENTE ────────────────────────────
  // M = 25 - N - A (cada rolo tem 25 sementes)
  const fillM = (rolo) => {
    const n = Number(grid[activeTreat][rolo].N || 0);
    const a = Number(grid[activeTreat][rolo].A || 0);
    const m = 25 - n - a;
    if (m >= 0) setCell(rolo, "M", m);
  };

  // ── TELA DE CARREGAMENTO ─────────────────────────────────────────
  if (loading) return (
    <div style={{ background: UI.bg, color: UI.accent, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_SANS, fontSize: 14 }}>
      Carregando dados...
    </div>
  );

  // ── RENDERIZAÇÃO PRINCIPAL ───────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: UI.bg, color: UI.text, fontFamily: FONT_SANS }}>

      {/* CSS global: fontes + utilitários de classe */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
        input[type=number] { -moz-appearance: textfield; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-thumb { background: #cdd7e1; border-radius: 4px; }
        .btn { cursor: pointer; transition: all 0.15s; border: none; }
        .btn:hover { filter: brightness(1.12); transform: translateY(-1px); }
        .btn:active { transform: translateY(0); }
        .cell-input {
          background: #ffffff; border: 1px solid #d8e0e8; border-radius: 5px;
          color: #243447; font-family: 'Inter', 'Segoe UI', sans-serif;
          font-size: 13px; text-align: center; width: 44px; height: 34px;
          padding: 0; transition: border-color 0.15s;
        }
        .cell-input:focus { outline: none; border-color: #6f93b5; }
        .tab-btn { cursor:pointer; padding:8px 20px; border-radius:8px; font-size:13px; font-family:'Inter', 'Segoe UI', sans-serif; transition:all 0.15s; border:none; }
        .app-header-nav { display: flex; gap: 8px; }
        .page-pad { padding: 24px; }
        .entry-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; gap: 12px; }
        .entry-grid-scroll { width: 100%; overflow-x: auto; overflow-y: hidden; padding-bottom: 4px; }
        .entry-grid-inner { min-width: 760px; }
        .entry-actions { display: flex; gap: 12px; justify-content: flex-end; }
        .dashboard-layout { padding: 24px; }
        .dashboard-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
        @media (max-width: 1100px) {
          .dashboard-charts { grid-template-columns: 1fr; }
        }
        @media (max-width: 900px) {
          .page-pad, .dashboard-layout { padding: 16px; }
          .app-header {
            padding: 12px 14px !important;
            flex-wrap: wrap;
            align-items: flex-start !important;
            gap: 10px;
          }
          .app-header-nav {
            width: 100%;
            flex-wrap: wrap;
          }
          .entry-head {
            flex-direction: column;
            align-items: flex-start;
          }
          .entry-actions {
            width: 100%;
          }
          .entry-actions .btn {
            flex: 1;
          }
          .tab-btn {
            padding: 8px 12px;
            font-size: 12px;
          }
        }
      `}</style>

      {/* ════ HEADER FIXO ════════════════════════════════════════════
          position: sticky + top: 0 = permanece visível ao rolar */}
      <div className="app-header" style={{
        background: UI.surface, borderBottom: `1px solid ${UI.border}`,
        padding: "14px 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🌾</span>
          <div>
            <h1 style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 20, letterSpacing: 0.4, color: UI.text, lineHeight: 1 }}>
              ENSAIO DE GERMINAÇÃO
            </h1>
            <p style={{ fontSize: 10, color: UI.textSoft, fontFamily: FONT_SANS, letterSpacing: 0.3 }}>
              Dia 0: {day0 ? formatPtBrDate(day0) : "—"} · {counts.length} CONTAGEM{counts.length !== 1 ? "S" : ""} · DATs: {counts.map(c => c.dat).join(", ") || "—"}
            </p>
          </div>
        </div>
        {/* Botões de navegação entre telas */}
        <div className="app-header-nav">
          {[["dashboard", "📊 Dashboard"], ["entry", "➕ Nova Contagem"]].map(([v, label]) => (
            <button key={v} className="tab-btn"
              onClick={() => v === "entry" ? startNew() : setView(v)}
              style={{ background: view === v ? UI.accent : "transparent", color: view === v ? "#fff" : UI.textSoft, border: `1px solid ${view === v ? UI.accent : UI.border}` }}
            >{label}</button>
          ))}
          <button
            className="tab-btn"
            onClick={() => setShowTrial(true)}
            style={{ background: "transparent", color: UI.textSoft, border: `1px solid ${UI.border}` }}
          >
            ⚙️ Ensaio
          </button>
        </div>
      </div>

      {/* ════ ROTEAMENTO DE TELAS ════════════════════════════════════
          Em vez de um router externo, usamos condicionais simples */}
      {view === "dashboard" && (
        <DashboardView counts={counts} startEdit={startEdit} deleteCount={deleteCount} openCalendar={() => setShowCalendar(true)} />
      )}
      {view === "entry" && (
        <EntryView
          dat={dat} setDat={setDat} day0={day0} openTrial={() => setShowTrial(true)} countDate={countDate} setCountDate={setCountDate} grid={grid}
          activeTreat={activeTreat} setActiveTreat={setActiveTreat}
          setCell={setCell} fillM={fillM}
          saved={saved} editIdx={editIdx}
          handleSave={handleSave}
          onCancel={() => setView("dashboard")}
        />
      )}
      {showTrial && (
        <TrialSetupModal
          day0={day0}
          setDay0={setDay0}
          onClose={() => setShowTrial(false)}
        />
      )}
      {showCalendar && (
        <CalendarModal
          day0={day0}
          onClose={() => setShowCalendar(false)}
          onCreateCount={(iso) => {
            setShowCalendar(false);
            startNewAtDate(iso);
          }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// COMPONENTE: EntryView — Formulário de entrada de dados
// Exibe grade N/A/M × R1-R12 por tratamento (selecionado via abas)
// ══════════════════════════════════════════════════════════════════
function EntryView({ dat, setDat, day0, openTrial, countDate, setCountDate, grid, activeTreat, setActiveTreat, setCell, fillM, saved, editIdx, handleSave, onCancel }) {
  const inputRefs = useRef({});
  const timersRef = useRef({});

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(t => clearTimeout(t));
      timersRef.current = {};
    };
  }, []);

  const keyFor = (rolo, tipo) => `${activeTreat}:${rolo}:${tipo}`;
  const setInputRef = (rolo, tipo) => (el) => {
    if (!el) return;
    inputRefs.current[keyFor(rolo, tipo)] = el;
  };

  const focusCell = (rolo, tipo) => {
    const el = inputRefs.current[keyFor(rolo, tipo)];
    if (!el) return false;
    el.focus();
    if (typeof el.select === "function") el.select();
    return true;
  };

  const nextCoords = (rolo, tipo) => {
    const roloIdx = ROLOS.indexOf(rolo);
    const tipoIdx = TIPOS.indexOf(tipo);
    if (roloIdx < 0 || tipoIdx < 0) return null;

    let nextRolo = rolo;
    let nextTipo = TIPOS[tipoIdx + 1];
    if (!nextTipo) {
      nextRolo = ROLOS[roloIdx + 1];
      nextTipo = TIPOS[0];
    }
    if (!nextRolo || !nextTipo) return null;
    return { rolo: nextRolo, tipo: nextTipo };
  };

  const prevCoords = (rolo, tipo) => {
    const roloIdx = ROLOS.indexOf(rolo);
    const tipoIdx = TIPOS.indexOf(tipo);
    if (roloIdx < 0 || tipoIdx < 0) return null;

    let prevRolo = rolo;
    let prevTipo = TIPOS[tipoIdx - 1];
    if (!prevTipo) {
      prevRolo = ROLOS[roloIdx - 1];
      prevTipo = TIPOS[TIPOS.length - 1];
    }
    if (!prevRolo || !prevTipo) return null;
    return { rolo: prevRolo, tipo: prevTipo };
  };

  const focusNext = (rolo, tipo) => {
    const next = nextCoords(rolo, tipo);
    if (!next) return false;
    return focusCell(next.rolo, next.tipo);
  };

  const focusPrev = (rolo, tipo) => {
    const prev = prevCoords(rolo, tipo);
    if (!prev) return false;
    return focusCell(prev.rolo, prev.tipo);
  };

  const handleCellKeyDown = (rolo, tipo, e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      focusNext(rolo, tipo);
      return;
    }
    if (e.key === "Tab") {
      const moved = e.shiftKey ? focusPrev(rolo, tipo) : focusNext(rolo, tipo);
      if (moved) e.preventDefault();
    }
  };

  const handleCellChange = (rolo, tipo, raw) => {
    const key = keyFor(rolo, tipo);
    if (timersRef.current[key]) {
      clearTimeout(timersRef.current[key]);
      delete timersRef.current[key];
    }

    const digits = String(raw ?? "").replace(/[^\d]/g, "");
    if (digits === "") {
      setCell(rolo, tipo, "");
      return;
    }

    let num = Number(digits);
    if (!Number.isFinite(num)) return;
    if (num < 0) num = 0;
    if (num > 25) num = 25;

    setCell(rolo, tipo, String(num));

    const shouldAdvanceNow = digits.length >= 2 || num >= 10;
    if (shouldAdvanceNow) {
      setTimeout(() => focusNext(rolo, tipo), 0);
      return;
    }

    timersRef.current[key] = setTimeout(() => focusNext(rolo, tipo), 650);
  };

  return (
    <div className="page-pad" style={{ maxWidth: 900, margin: "0 auto" }}>

      {/* Cabeçalho + campo DAT */}
      <div className="entry-head">
        <h2 style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 22, letterSpacing: 0.4, color: UI.text }}>
          {editIdx !== null ? `✏️ EDITAR DAT ${dat}` : "➕ NOVA CONTAGEM"}
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Dia 0:</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: UI.text, fontFamily: FONT_SANS }}>
              {day0 ? formatPtBrDate(day0) : "não definido"}
            </span>
            <button
              className="btn"
              onClick={openTrial}
              style={{
                background: "transparent",
                border: `1px solid ${UI.border}`,
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                fontFamily: FONT_SANS,
                color: UI.textSoft,
              }}
            >
              {day0 ? "Alterar" : "Definir"}
            </button>
          </div>
          <label style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Contagem:</label>
          <input
            type="date"
            value={countDate}
            onChange={e => setCountDate(e.target.value)}
            style={{ ...inputStyle, width: 160, textAlign: "center" }}
          />
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>DAT:</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: UI.text, fontFamily: FONT_SANS }}>{dat || "—"}</span>
          </div>
          <InfoTooltip text={INFO_TEXTS.ultimaContagem} />
        </div>
      </div>

      {/* Abas de tratamento com indicador de progresso */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TREATMENTS.map(t => {
          // Conta rolos que já têm algum valor digitado
          const filled = ROLOS.filter(r =>
            grid[t.id][r].N !== "" || grid[t.id][r].A !== "" || grid[t.id][r].M !== ""
          ).length;
          return (
            <button key={t.id} className="btn" onClick={() => setActiveTreat(t.id)} style={{
              background: activeTreat === t.id ? `${t.color}22` : UI.surfaceSoft,
              border: `1px solid ${activeTreat === t.id ? t.color : UI.border}`,
              color: activeTreat === t.id ? t.color : UI.textSoft,
              borderRadius: 8, padding: "8px 16px", fontSize: 12,
              fontFamily: FONT_SANS,
            }}>
              <span style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 16, letterSpacing: 0.2 }}>{t.id}</span>
              <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>{t.name}</span>
              {/* Verde = completo, amarelo = incompleto */}
              <span style={{ marginLeft: 8, fontSize: 10, color: filled === 12 ? "#6fa58b" : "#b69b6a" }}>
                {filled}/12 rolos
              </span>
            </button>
          );
        })}
      </div>

      {/* Grade de entrada para o tratamento ativo */}
      {(() => {
        const t = TREATMENTS.find(x => x.id === activeTreat);
        const sums = sumTreatment(grid, activeTreat);
        return (
          <div style={card({ marginBottom: 20 })}>
            {/* Cabeçalho com totais em tempo real */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 style={{ fontFamily: FONT_SANS, fontSize: 11, color: UI.textSoft, letterSpacing: 0.3 }}>
                ROLO-PAPEL · {t.name.toUpperCase()} · 25 sementes/rolo
              </h3>
              <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                {["N","A","M"].map(tp => (
                  <span key={tp} style={{ color: TIPO_COLORS[tp], fontFamily: FONT_SANS }}>
                    {tp}: {sums[tp]}
                  </span>
                ))}
                <span style={{ color: UI.textSoft }}>Total: {sums.total}/300</span>
              </div>
            </div>

            <div className="entry-grid-scroll">
              <div className="entry-grid-inner">
                {/* Linha de cabeçalho com nomes dos rolos */}
                <div style={{ display: "grid", gridTemplateColumns: "70px repeat(12, 1fr)", gap: 6, marginBottom: 6 }}>
                  <div />
                  {ROLOS.map(r => (
                    <div key={r} style={{ fontSize: 10, color: UI.textSoft, textAlign: "center", fontFamily: FONT_SANS }}>{r}</div>
                  ))}
                </div>

                {/* Uma linha por tipo: Normal, Anormal, Morta */}
                {TIPOS.map(tipo => (
                  <div key={tipo} style={{ display: "grid", gridTemplateColumns: "70px repeat(12, 1fr)", gap: 6, marginBottom: 6, alignItems: "center" }}>
                    <div style={{ fontSize: 14, color: TIPO_COLORS[tipo], fontFamily: FONT_SANS, fontWeight: 600, letterSpacing: 0.2, textAlign: "right", paddingRight: 8 }}>
                      {TIPO_LABELS[tipo]}
                    </div>
                    {/* Um input por rolo — borda colorida quando preenchido */}
                    {ROLOS.map(r => (
                      <input
                        key={r}
                        ref={setInputRef(r, tipo)}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={2}
                        className="cell-input"
                        value={grid[activeTreat][r][tipo]}
                        onChange={e => handleCellChange(r, tipo, e.target.value)}
                        onKeyDown={e => handleCellKeyDown(r, tipo, e)}
                        onFocus={(e) => e.target.select()}
                        style={{ borderColor: grid[activeTreat][r][tipo] !== "" ? `${TIPO_COLORS[tipo]}66` : UI.border }}
                      />
                    ))}
                  </div>
                ))}

                {/* Linha de preenchimento automático: M = 25 - N - A */}
                <div style={{ display: "grid", gridTemplateColumns: "70px repeat(12, 1fr)", gap: 6, marginTop: 4 }}>
                  <div style={{ fontSize: 9, color: UI.textSoft, textAlign: "right", paddingRight: 8, paddingTop: 6 }}>auto M ▼</div>
                  {ROLOS.map(r => {
                    const n = Number(grid[activeTreat][r].N || 0);
                    const a = Number(grid[activeTreat][r].A || 0);
                    const rem = 25 - n - a; // Quantas sementes sobram para Mortas
                    return (
                      <button key={r} className="btn" onClick={() => fillM(r)}
                        title="Preencher Mortas = 25 - N - A"
                        style={{
                          background: "transparent", border: `1px dashed ${UI.border}`,
                          borderRadius: 5,
                          color: rem < 0 ? "#c47b6a" : UI.textSoft, // Vermelho = ultrapassou 25
                          fontSize: 10, fontFamily: FONT_SANS, height: 24, cursor: "pointer",
                        }}
                      >{rem < 0 ? "⚠" : rem}</button>
                    );
                  })}
                </div>
              </div>
            </div>
            <p style={{ fontSize: 10, color: UI.textSoft, marginTop: 8, fontFamily: FONT_SANS }}>
              💡 Clique nos números "auto M" para preencher Mortas = 25 − N − A automaticamente
            </p>
          </div>
        );
      })()}

      {/* Botões de ação */}
      <div className="entry-actions">
        <button className="btn" onClick={onCancel} style={{
          background: "transparent", border: `1px solid ${UI.border}`, color: UI.textSoft,
          borderRadius: 8, padding: "10px 20px", fontSize: 13, fontFamily: FONT_SANS,
        }}>Cancelar</button>
        <button className="btn" onClick={handleSave} style={{
          background: saved ? "#6fa58b" : "linear-gradient(135deg, #8ca8bf, #6f93b5)",
          color: "#fff", border: "none", borderRadius: 8, padding: "10px 28px",
          fontSize: 13, fontFamily: FONT_SANS, fontWeight: 600,
        }}>
          {saved ? "✓ Salvo!" : `💾 Salvar DAT ${dat || "?"}`}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// COMPONENTE: DashboardView — Painel analítico principal
// ══════════════════════════════════════════════════════════════════
function DashboardView({ counts, startEdit, deleteCount, openCalendar }) {

  // Tratamento selecionado para o gráfico de rolos
  const [selT, setSelT] = useState("T1");

  // Ordena por DAT crescente para os gráficos de linha
  const sorted = [...counts].sort((a, b) => a.dat - b.dat);
  const latest = sorted[sorted.length - 1]; // Contagem mais recente
  const ivg = calcIVG(sorted);              // IVG calculado para todos os tratamentos

  // ── PREPARAÇÃO DOS DADOS DOS GRÁFICOS ─────────────────────────

  // LineChart: [{ dat:5, T0:41.7, T1:58.0, ... }, { dat:8, ... }]
  const trendData = sorted.map(c => {
    const row = { dat: c.dat };
    TREATMENTS.forEach(t => {
      const s = sumTreatment(c.grid, t.id);
      row[t.id] = s.total > 0 ? +((s.N / s.total) * 100).toFixed(1) : 0;
    });
    return row;
  });

  // BarChart comparativo da última contagem
  const latestBar = latest ? TREATMENTS.map(t => {
    const s = sumTreatment(latest.grid, t.id);
    return {
      name: t.id,
      Normais:  s.total > 0 ? +((s.N / s.total) * 100).toFixed(1) : 0,
      Anormais: s.total > 0 ? +((s.A / s.total) * 100).toFixed(1) : 0,
      Mortas:   s.total > 0 ? +((s.M / s.total) * 100).toFixed(1) : 0,
    };
  }) : [];

  // BarChart empilhado por rolo do tratamento selecionado
  const roloData = latest ? ROLOS.map(r => ({
    name: r,
    N: Number(latest.grid[selT]?.[r]?.N || 0),
    A: Number(latest.grid[selT]?.[r]?.A || 0),
    M: Number(latest.grid[selT]?.[r]?.M || 0),
  })) : [];

  // Determina qual tratamento tem maior % de normais na última contagem
  const bestT = latest ? TREATMENTS.reduce((best, t) => {
    const s    = sumTreatment(latest.grid, t.id);
    const pct  = s.total > 0 ? s.N / s.total : 0;
    const bs   = sumTreatment(latest.grid, best.id);
    const bpct = bs.total > 0 ? bs.N / bs.total : 0;
    return pct > bpct ? t : best;
  }, TREATMENTS[0]) : null;

  // Estado vazio
  if (!counts.length) return (
    <div style={{ textAlign: "center", padding: "80px 24px", color: UI.textSoft }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🌾</div>
      <p style={{ fontFamily: FONT_SANS, fontSize: 13 }}>Nenhuma contagem registrada ainda.</p>
      <p style={{ fontSize: 12, marginTop: 8 }}>Clique em "Nova Contagem" para começar.</p>
    </div>
  );

  return (
    <div className="dashboard-layout">
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>
          Planejamento do ensaio e datas sugeridas
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={openCalendar}
            style={{
              background: "transparent",
              border: `1px solid ${UI.border}`,
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
              fontFamily: FONT_SANS,
              color: UI.textSoft,
            }}
          >
            📅 Calendário
          </button>
          <a
            href="https://wikisda.agricultura.gov.br/pt-br/Laborat%C3%B3rios/Metodologia/Sementes/RAS_2025/ras_2024_umidade"
            target="_blank"
            rel="noreferrer"
            className="btn"
            style={{
              textDecoration: "none",
              background: "transparent",
              border: `1px solid ${UI.border}`,
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
              fontFamily: FONT_SANS,
              color: UI.textSoft,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            📘 RAS Umidade
          </a>
        </div>
      </div>

      {/* ── FAIXA DE KPIs ──────────────────────────────────────────
          Cards com os indicadores mais importantes.
          Cada card tem um "?" com explicação ao passar o mouse. */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>

        {bestT && (() => {
          const s = sumTreatment(latest.grid, bestT.id);
          const pct = s.total > 0 ? ((s.N / s.total) * 100).toFixed(1) : 0;
          return <KPIBlock label="MELHOR TRATAMENTO" val={bestT.id} sub={`${bestT.name} · ${pct}% normais`} color={bestT.color} tag="LÍDER" infoKey="melhorTratamento" />;
        })()}

        <KPIBlock label="ÚLTIMA CONTAGEM" val={`DAT ${latest.dat}`}
          sub={formatPtBrDate(latest.countDate || latest.savedAt)}
          color="#6f93b5" infoKey="ultimaContagem" />

        <KPIBlock label="TOTAL DE CONTAGENS" val={counts.length}
          sub={`DATs: ${sorted.map(c => c.dat).join(", ")}`}
          color="#a78bfa" infoKey="totalContagens" />

        {/* IVG de cada tratamento — versão compacta */}
        {TREATMENTS.map(t => (
          <KPIBlock key={t.id} label={`IVG — ${t.id}`} val={ivg[t.id]}
            sub={t.name} color={t.color} small infoKey="ivg" />
        ))}
      </div>

      {/* ── LINHA 2: EVOLUÇÃO + DISTRIBUIÇÃO ─────────────────────
          Grid CSS de 2 colunas iguais lado a lado */}
      <div className="dashboard-charts">

        {/* Card: Gráfico de evolução por DAT */}
        <div style={card()}>
          <CardTitle emoji="📈" title="EVOLUÇÃO % NORMAIS POR DAT" infoKey="evolucao" />
          {trendData.length < 2
            ? <p style={{ color: "#475569", fontSize: 12 }}>Adicione mais contagens para ver a evolução.</p>
            : <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="dat" tick={{ fill: "#6b7280", fontSize: 10, fontFamily: FONT_SANS }}
                    label={{ value: "DAT", position: "insideBottom", offset: -2, fill: "#6b7280", fontSize: 10 }}
                    axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} domain={[0, 100]} unit="%" axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: FONT_SANS }} />
                  {/* Linha de referência: 50% = padrão mínimo comercial */}
                  <ReferenceLine y={50} stroke="#94a3b8" strokeDasharray="4 4"
                    label={{ value: "50%", fill: "#6b7280", fontSize: 9 }} />
                  {TREATMENTS.map(t => (
                    <Line key={t.id} type="monotone" dataKey={t.id} stroke={t.color}
                      strokeWidth={2} dot={{ r: 4, fill: t.color }} activeDot={{ r: 6 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
          }
        </div>

        {/* Card: Distribuição da última contagem */}
        <div style={card()}>
          <CardTitle emoji="📊" title={`DISTRIBUIÇÃO ATUAL (DAT ${latest?.dat})`} infoKey="distribuicao" />
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={latestBar} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 12, fontFamily: FONT_SANS }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} domain={[0, 80]} unit="%" axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: FONT_SANS }} />
              <Bar dataKey="Normais"  fill="#6fa58b" radius={[4,4,0,0]} />
              <Bar dataKey="Anormais" fill="#b69b6a" radius={[4,4,0,0]} />
              <Bar dataKey="Mortas"   fill="#c47b6a" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── GRÁFICO DE VARIAÇÃO POR ROLO ─────────────────────────
          Barras empilhadas (stackId="a"): N + A + M = 25 por rolo */}
      <div style={card({ marginBottom: 16 })}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <CardTitle emoji="🔬" title={`VARIAÇÃO POR ROLO — DAT ${latest?.dat}`} infoKey="variacaoRolo" extra={{ marginBottom: 0 }} />
          {/* Botões de seleção de tratamento */}
          <div style={{ display: "flex", gap: 6 }}>
            {TREATMENTS.map(t => (
              <button key={t.id} className="btn" onClick={() => setSelT(t.id)} style={{
                background: selT === t.id ? t.color : "transparent",
                color: selT === t.id ? "#fff" : t.color,
                border: `1px solid ${t.color}`,
                borderRadius: 5, padding: "3px 10px", fontSize: 11,
                fontFamily: FONT_SANS, cursor: "pointer",
              }}>{t.id}</button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          {/* stackId="a" = empilha as 3 barras do mesmo rolo */}
          <BarChart data={roloData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 9, fontFamily: FONT_SANS }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} domain={[0, 25]} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: UI.surface, border: `1px solid ${UI.border}`, fontSize: 11 }} />
            <Bar dataKey="N" name="Normais"  fill="#6fa58b" radius={[3,3,0,0]} stackId="a" />
            <Bar dataKey="A" name="Anormais" fill="#b69b6a" radius={[0,0,0,0]} stackId="a" />
            <Bar dataKey="M" name="Mortas"   fill="#c47b6a" radius={[0,0,3,3]} stackId="a" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── TABELA HISTÓRICA ─────────────────────────────────────── */}
      <div style={card()}>
        <CardTitle emoji="📋" title="HISTÓRICO DE CONTAGENS" infoKey="historico" />
        {sorted.length === 0
          ? <p style={{ color: UI.textSoft, fontSize: 12 }}>Sem contagens.</p>
          : <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${UI.border}` }}>
                    {["DAT","Data","T0 N%","T1 N%","T2 N%","T3 N%","Ações"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: UI.textSoft, fontFamily: FONT_SANS, fontSize: 9, letterSpacing: 0.4, fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <td style={{ padding: "10px", fontFamily: FONT_SANS, fontWeight: 700, fontSize: 16, color: "#6f93b5", letterSpacing: 0.2 }}>{c.dat}</td>
                      <td style={{ padding: "10px", color: UI.textSoft, fontSize: 11, fontFamily: FONT_SANS }}>
                        {formatPtBrDate(c.countDate || c.savedAt)}
                      </td>
                      {/* % Normais de cada tratamento com mini barra de progresso */}
                      {TREATMENTS.map(t => {
                        const s = sumTreatment(c.grid, t.id);
                        const pct = s.total > 0 ? ((s.N / s.total) * 100).toFixed(1) : "—";
                        return (
                          <td key={t.id} style={{ padding: "10px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {/* Barra de progresso proporcional ao % */}
                              <div style={{ width: 40, height: 4, background: "#e5e7eb", borderRadius: 2 }}>
                                <div style={{ width: `${pct}%`, height: "100%", background: t.color, borderRadius: 2 }} />
                              </div>
                              <span style={{ fontFamily: FONT_SANS, fontSize: 11, color: t.color }}>{pct}%</span>
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ padding: "10px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn" onClick={() => startEdit(counts.indexOf(c))}
                            style={{ background: "#6f93b522", color: "#6f93b5", border: "1px solid #6f93b533", borderRadius: 5, padding: "3px 10px", fontSize: 10, fontFamily: FONT_SANS, cursor: "pointer" }}>
                            ✏️ Editar
                          </button>
                          <button className="btn" onClick={() => deleteCount(counts.indexOf(c))}
                            style={{ background: "#c47b6a11", color: "#c47b6a", border: "1px solid #c47b6a33", borderRadius: 5, padding: "3px 10px", fontSize: 10, fontFamily: FONT_SANS, cursor: "pointer" }}>
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </div>
    </div>
  );
}

function TrialSetupModal({ day0, setDay0, onClose }) {
  const [value, setValue] = useState(day0 || "");

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={card({ maxWidth: 520, width: "100%", padding: 18 })}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: UI.text, fontFamily: FONT_SANS }}>
            Cadastro do Ensaio
          </div>
          <button
            className="btn"
            onClick={onClose}
            style={{
              background: "transparent",
              border: `1px solid ${UI.border}`,
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              fontFamily: FONT_SANS,
              color: UI.textSoft,
            }}
          >
            Fechar
          </button>
        </div>

        <div style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS, lineHeight: 1.5, marginBottom: 12 }}>
          Dia 0 = data em que os tratamentos foram aplicados. O DAT das contagens será calculado automaticamente a partir dessa data.
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Dia 0:</label>
          <input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{ ...inputStyle, width: 180, textAlign: "center" }}
          />
          <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
            <button
              className="btn"
              onClick={onClose}
              style={{
                background: "transparent",
                border: `1px solid ${UI.border}`,
                borderRadius: 8,
                padding: "10px 16px",
                fontSize: 13,
                fontFamily: FONT_SANS,
                color: UI.textSoft,
              }}
            >
              Cancelar
            </button>
            <button
              className="btn"
              onClick={() => {
                setDay0(value);
                onClose();
              }}
              style={{
                background: "linear-gradient(135deg, #8ca8bf, #6f93b5)",
                border: "none",
                borderRadius: 8,
                padding: "10px 18px",
                fontSize: 13,
                fontFamily: FONT_SANS,
                fontWeight: 600,
                color: "#fff",
              }}
            >
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarModal({ day0, onClose, onCreateCount }) {
  const baseYear = day0 || "";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={card({ maxWidth: 880, width: "100%", padding: 18 })}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: UI.text, fontFamily: FONT_SANS }}>
              Calendário do Ensaio
            </div>
            <div style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS, marginTop: 2 }}>
              Dia 0: {day0 ? formatPtBrDate(day0) : "não definido"} · Selecione uma data para abrir a Nova Contagem
            </div>
          </div>
          <button
            className="btn"
            onClick={onClose}
            style={{
              background: "transparent",
              border: `1px solid ${UI.border}`,
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
              fontFamily: FONT_SANS,
              color: UI.textSoft,
            }}
          >
            Fechar
          </button>
        </div>

        <div style={{ maxHeight: "70vh", overflow: "auto", border: `1px solid ${UI.border}`, borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${UI.border}`, background: UI.surfaceSoft }}>
                {["Data", "DAT", "Atividade", "Ação"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: UI.textSoft, fontFamily: FONT_SANS, fontSize: 11, fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CALENDAR_EVENTS.map((ev, idx) => {
                const iso = dmToIso(ev.dm, baseYear);
                const d = day0 && iso ? calcDat(day0, iso) : null;
                return (
                  <tr key={`${ev.dm}-${idx}`} style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td style={{ padding: "10px 12px", color: UI.text, fontFamily: FONT_SANS, fontWeight: 600 }}>
                      {iso ? formatPtBrDate(iso) : ev.dm}
                    </td>
                    <td style={{ padding: "10px 12px", color: UI.textSoft, fontFamily: FONT_SANS }}>
                      {d === null ? "—" : `DAT ${d}`}
                    </td>
                    <td style={{ padding: "10px 12px", color: UI.textSoft, fontFamily: FONT_SANS }}>
                      <div style={{ color: UI.text, fontWeight: 600 }}>{ev.title}</div>
                      <div style={{ marginTop: 2 }}>{ev.detail}</div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <button
                        className="btn"
                        disabled={!iso}
                        onClick={() => iso && onCreateCount(iso)}
                        style={{
                          background: "linear-gradient(135deg, #8ca8bf, #6f93b5)",
                          border: "none",
                          borderRadius: 8,
                          padding: "8px 12px",
                          fontSize: 12,
                          fontFamily: FONT_SANS,
                          fontWeight: 600,
                          color: "#fff",
                          opacity: iso ? 1 : 0.5,
                        }}
                      >
                        Abrir contagem
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
// ════════════════════════════════════════════════════════════════
// FIM DO ARQUIV
// ════════════════════════════════════════════════════════════════
