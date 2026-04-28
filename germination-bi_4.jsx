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
import { supabase, isSupabaseConfigured } from "./src/supabaseClient.js";
import html2canvas from "html2canvas";

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
  { id: "T2", name: "Avicta",     color: "#6f93b5" }, // Fungicida Avicta
  { id: "T3", name: "Cropstar",   color: "#b69b6a" }, // Fungicida Cropstar
];

// Array com os rolos: ["R1", "R2", ...]
// Array.from cria um array; o segundo argumento (_, i) ignora o valor
// e usa o índice i para gerar o nome do rolo
function makeRolos(count) {
  const n = Number(count);
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  return Array.from({ length: safe }, (_, i) => `R${i + 1}`);
}

function getTrialPreset(trialId, kind) {
  if (trialId === "sem_vermiculita") return { rolosCount: 5, seedsPerRolo: 20 };
  return { rolosCount: kind === "vigor" ? 24 : 12, seedsPerRolo: 25 };
}

function getRolosForCount(trialId, kind, rolosCountOverride) {
  const preset = getTrialPreset(trialId, kind);
  const n = Number(rolosCountOverride);
  const rolosCount = Number.isFinite(n) && n > 0 ? Math.floor(n) : preset.rolosCount;
  return makeRolos(rolosCount);
}

// Os 3 tipos de plântula contados em cada rolo
const TIPOS = ["N", "A", "M"];

// Nomes completos para exibição na interface
const TIPO_LABELS = { N: "Normal", A: "Anormal", M: "Morta" };

// Cores semânticas: verde = saudável, amarelo = atenção, vermelho = problema
const TIPO_COLORS = { N: "#6fa58b", A: "#b69b6a", M: "#c47b6a" };

const WORKSPACE_CODE_KEY = "germinacao_device_id_v1";
const SUPABASE_META_TABLE = "germinacao_meta";
const SUPABASE_COUNTS_TABLE = "germinacao_counts";
const SUPABASE_MOISTURE_TABLE = "germinacao_moisture";
const DEFAULT_DAY0 = "2026-04-11";

function getStoredWorkspaceCode() {
  try {
    return String(localStorage.getItem(WORKSPACE_CODE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function clearLegacyLocalData() {
  try {
    const prefixes = [
      "germination_counts_v2",
      "germination_trial_meta_v1",
      "germination_moisture_v1",
    ];
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (prefixes.some((p) => k.startsWith(p) || k.includes(`${p}__`))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

function withTimeout(promise, ms, label) {
  const t = Number(ms);
  const timeoutMs = Number.isFinite(t) && t > 0 ? t : 12000;
  const name = String(label || "").trim();
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(name ? `Timeout ao carregar ${name} no Supabase.` : "Timeout ao carregar dados no Supabase."));
      }, timeoutMs);
    }),
  ]);
}

async function loadSupabaseMeta(deviceId) {
  if (!isSupabaseConfigured || !supabase) return null;
  if (!String(deviceId || "").trim()) return null;
  const tryFull = await supabase
    .from(SUPABASE_META_TABLE)
    .select("day0,mountings")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (!tryFull.error) {
    return { day0: tryFull.data?.day0 || null, mountings: tryFull.data?.mountings ?? null };
  }
  const tryLegacy = await supabase
    .from(SUPABASE_META_TABLE)
    .select("day0")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (tryLegacy.error) return null;
  return { day0: tryLegacy.data?.day0 || null, mountings: null };
}

async function saveSupabaseMeta(deviceId, payload) {
  if (!isSupabaseConfigured || !supabase) return;
  if (!String(deviceId || "").trim()) return;
  const day0 = payload?.day0 ?? null;
  const mountings = payload?.mountings ?? null;
  const full = await supabase
    .from(SUPABASE_META_TABLE)
    .upsert({ device_id: deviceId, day0, mountings }, { onConflict: "device_id" });
  if (!full.error) return;
  await supabase
    .from(SUPABASE_META_TABLE)
    .upsert({ device_id: deviceId, day0 }, { onConflict: "device_id" });
}

async function loadSupabaseCounts(deviceId) {
  if (!isSupabaseConfigured || !supabase) return null;
  if (!String(deviceId || "").trim()) return null;
  const tryFull = await supabase
    .from(SUPABASE_COUNTS_TABLE)
    .select("trial_code, kind, mounting_id, dat, count_date, rolos_count, seeds_per_rolo, grid, saved_at")
    .eq("device_id", deviceId)
    .order("dat", { ascending: true });
  if (!tryFull.error) {
    const data = tryFull.data || [];
    return data.map((row) => ({
      dat: row.dat,
      grid: row.grid,
      countDate: row.count_date,
      kind: row.kind,
      trialId: row.trial_code,
      mountingId: row.mounting_id || "default",
      rolosCount: row.rolos_count,
      seedsPerRolo: row.seeds_per_rolo,
      savedAt: row.saved_at,
    })).sort((a, b) => (a.dat - b.dat) || (countKindOrder(a) - countKindOrder(b)));
  }
  const tryLegacy = await supabase
    .from(SUPABASE_COUNTS_TABLE)
    .select("trial_code, kind, dat, count_date, rolos_count, seeds_per_rolo, grid, saved_at")
    .eq("device_id", deviceId)
    .order("dat", { ascending: true });
  if (tryLegacy.error) return null;
  const data = tryLegacy.data || [];
  return data.map((row) => ({
    dat: row.dat,
    grid: row.grid,
    countDate: row.count_date,
    kind: row.kind,
    trialId: row.trial_code,
    mountingId: "default",
    rolosCount: row.rolos_count,
    seedsPerRolo: row.seeds_per_rolo,
    savedAt: row.saved_at,
  })).sort((a, b) => (a.dat - b.dat) || (countKindOrder(a) - countKindOrder(b)));
}

async function upsertSupabaseCount(deviceId, entry) {
  if (!isSupabaseConfigured || !supabase) return;
  if (!String(deviceId || "").trim()) return;
  const kind = getCountKind(entry);
  const trialId = getCountTrialId(entry);
  const mountingId = getCountMountingId(entry);
  const payloadFull = {
    device_id: deviceId,
    trial_code: trialId,
    kind,
    mounting_id: mountingId,
    dat: Number(entry.dat),
    count_date: entry.countDate || null,
    rolos_count: Number(entry.rolosCount || getCountRolos(entry).length),
    seeds_per_rolo: Number(entry.seedsPerRolo || getCountSeedsPerRolo(entry)),
    grid: entry.grid,
    saved_at: entry.savedAt || new Date().toISOString(),
  };
  const full = await supabase
    .from(SUPABASE_COUNTS_TABLE)
    .upsert(payloadFull, { onConflict: "device_id,trial_code,kind,mounting_id,dat" });
  if (!full.error) return;
  await supabase
    .from(SUPABASE_COUNTS_TABLE)
    .upsert(
      {
        device_id: deviceId,
        trial_code: trialId,
        kind,
        dat: Number(entry.dat),
        count_date: entry.countDate || null,
        rolos_count: Number(entry.rolosCount || getCountRolos(entry).length),
        seeds_per_rolo: Number(entry.seedsPerRolo || getCountSeedsPerRolo(entry)),
        grid: entry.grid,
        saved_at: entry.savedAt || new Date().toISOString(),
      },
      { onConflict: "device_id,trial_code,kind,dat" }
    );
}

async function deleteSupabaseCount(deviceId, entry) {
  if (!isSupabaseConfigured || !supabase) return;
  if (!String(deviceId || "").trim()) return;
  const kind = getCountKind(entry);
  const trialId = getCountTrialId(entry);
  const mountingId = getCountMountingId(entry);
  const full = await supabase
    .from(SUPABASE_COUNTS_TABLE)
    .delete()
    .eq("device_id", deviceId)
    .eq("trial_code", trialId)
    .eq("kind", kind)
    .eq("mounting_id", mountingId)
    .eq("dat", Number(entry.dat));
  if (!full.error) return;
  await supabase
    .from(SUPABASE_COUNTS_TABLE)
    .delete()
    .eq("device_id", deviceId)
    .eq("trial_code", trialId)
    .eq("kind", kind)
    .eq("dat", Number(entry.dat));
}

async function loadSupabaseMoisture(deviceId) {
  if (!isSupabaseConfigured || !supabase) return null;
  if (!String(deviceId || "").trim()) return null;
  const { data, error } = await supabase
    .from(SUPABASE_MOISTURE_TABLE)
    .select("rep_label, m1, m2, m3")
    .eq("device_id", deviceId)
    .eq("trial_code", "principal")
    .order("rep_label", { ascending: true });
  if (error) return null;
  return (data || []).map((row) => ({
    id: row.rep_label,
    m1: row.m1 ?? "",
    m2: row.m2 ?? "",
    m3: row.m3 ?? "",
  }));
}

async function upsertSupabaseMoistureRows(deviceId, rows) {
  if (!isSupabaseConfigured || !supabase) return;
  if (!String(deviceId || "").trim()) return;
  const payload = (rows || []).map((r) => ({
    device_id: deviceId,
    trial_code: "principal",
    rep_label: r.id,
    m1: r.m1 === "" ? null : Number(r.m1),
    m2: r.m2 === "" ? null : Number(r.m2),
    m3: r.m3 === "" ? null : Number(r.m3),
  }));
  if (!payload.length) return;
  await supabase
    .from(SUPABASE_MOISTURE_TABLE)
    .upsert(payload, { onConflict: "device_id,trial_code,rep_label" });
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

function calcMoisturePercent(m1, m2, m3) {
  const tare = Number(m1);
  const wet = Number(m2);
  const dry = Number(m3);
  if (![tare, wet, dry].every(Number.isFinite)) return null;
  const wetSampleMass = wet - tare; // massa da amostra umida
  const drySampleMass = dry - tare; // massa da amostra seca
  if (wetSampleMass <= 0 || drySampleMass < 0 || dry > wet) return null;
  return ((wetSampleMass - drySampleMass) / wetSampleMass) * 100;
}

function normalizeMountings(raw, day0) {
  const preset = getTrialPreset("principal", "vigor");
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = list
    .map((m) => ({
      id: String(m?.id || "").trim(),
      label: String(m?.label || "").trim(),
      mountDate: String(m?.mountDate || "").trim(),
      trialId: String(m?.trialId || "").trim() || "principal",
      rolosCount: Number.isFinite(Number(m?.rolosCount)) && Number(m.rolosCount) > 0 ? Math.floor(Number(m.rolosCount)) : null,
      seedsPerRolo: Number.isFinite(Number(m?.seedsPerRolo)) && Number(m.seedsPerRolo) > 0 ? Math.floor(Number(m.seedsPerRolo)) : null,
    }))
    .filter((m) => Boolean(m.id));

  const defaultMounting = {
    id: "default",
    label: "Montagem (padrão)",
    mountDate: day0 || "",
    trialId: "principal",
    rolosCount: preset.rolosCount,
    seedsPerRolo: preset.seedsPerRolo,
  };

  const next = cleaned.some((m) => m.id === "default")
    ? cleaned.map((m) => (m.id === "default"
      ? {
        ...defaultMounting,
        ...m,
        mountDate: m.mountDate || defaultMounting.mountDate,
        rolosCount: m.rolosCount ?? defaultMounting.rolosCount,
        seedsPerRolo: m.seedsPerRolo ?? defaultMounting.seedsPerRolo,
      }
      : {
        ...m,
        label: m.label || (m.mountDate ? `Montagem ${formatPtBrDate(m.mountDate)}` : "Montagem"),
        rolosCount: m.rolosCount ?? preset.rolosCount,
        seedsPerRolo: m.seedsPerRolo ?? preset.seedsPerRolo,
      }))
    : [
      defaultMounting,
      ...cleaned.map((m) => ({
        ...m,
        label: m.label || (m.mountDate ? `Montagem ${formatPtBrDate(m.mountDate)}` : "Montagem"),
        rolosCount: m.rolosCount ?? preset.rolosCount,
        seedsPerRolo: m.seedsPerRolo ?? preset.seedsPerRolo,
      })),
    ];

  const withoutDefault = next.filter((m) => m.id !== "default");
  withoutDefault.sort((a, b) => {
    const ad = a.mountDate || "";
    const bd = b.mountDate || "";
    if (ad !== bd) return ad.localeCompare(bd);
    return (a.label || "").localeCompare(b.label || "");
  });
  return [next.find((m) => m.id === "default") || defaultMounting, ...withoutDefault];
}

function generateMountingId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function getCountKind(entry) {
  const k = entry?.kind;
  if (k === "vigor" || k === "germinacao") return k;
  if (k === "final") return "germinacao";
  const d = Number(entry?.dat);
  if (Number.isFinite(d) && d <= 5) return "vigor";
  return "germinacao";
}

function countKindOrder(entryOrKind) {
  const k = typeof entryOrKind === "string" ? entryOrKind : getCountKind(entryOrKind);
  return k === "germinacao" ? 1 : 0;
}

function getCountTrialId(entry) {
  const t = entry?.trialId;
  return typeof t === "string" && t ? t : "principal";
}

function getCountMountingId(entry) {
  const m = entry?.mountingId;
  return typeof m === "string" && m ? m : "default";
}

function getCountRolos(entry) {
  const trialId = getCountTrialId(entry);
  const kind = getCountKind(entry);
  return getRolosForCount(trialId, kind, entry?.rolosCount);
}

function getCountSeedsPerRolo(entry) {
  const trialId = getCountTrialId(entry);
  const kind = getCountKind(entry);
  const preset = getTrialPreset(trialId, kind);
  const n = Number(entry?.seedsPerRolo);
  return Number.isFinite(n) && n > 0 ? n : preset.seedsPerRolo;
}

function findFirstUnfilledCell(grid, rolos) {
  for (const t of TREATMENTS) {
    const tid = t.id;
    for (const r of rolos) {
      for (const tipo of TIPOS) {
        const v = grid?.[tid]?.[r]?.[tipo];
        if (v === "" || v === null || typeof v === "undefined" || (typeof v === "number" && Number.isNaN(v))) {
          return { treatId: tid, rolo: r, tipo };
        }
      }
    }
  }
  const lastT = TREATMENTS[TREATMENTS.length - 1]?.id || "T0";
  const lastR = rolos[rolos.length - 1] || "R1";
  return { treatId: lastT, rolo: lastR, tipo: "M" };
}

function sanitizeFileName(name) {
  return String(name || "export")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 140);
}

async function exportFirstSvgAsPng(containerEl, fileName, opts = {}) {
  const { background = "#ffffff", pixelRatio = window.devicePixelRatio || 2 } = opts;
  if (!containerEl) throw new Error("Container não encontrado.");
  const svgEl = containerEl.querySelector("svg");
  if (!svgEl) throw new Error("SVG do gráfico não encontrado.");

  const rect = svgEl.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const cloned = svgEl.cloneNode(true);
  cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  cloned.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  if (!cloned.getAttribute("viewBox")) cloned.setAttribute("viewBox", `0 0 ${width} ${height}`);
  cloned.setAttribute("width", String(width));
  cloned.setAttribute("height", String(height));

  const svgText = new XMLSerializer().serializeToString(cloned);
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    img.decoding = "async";
    const loaded = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Falha ao carregar SVG para exportação."));
    });
    img.src = svgUrl;
    await loaded;

    const pr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * pr);
    canvas.height = Math.round(height * pr);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas não disponível para exportação.");

    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Não foi possível gerar o PNG.");

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sanitizeFileName(fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function exportHtmlAsPng(containerEl, fileName, opts = {}) {
  const { background = "#ffffff", pixelRatio = window.devicePixelRatio || 2 } = opts;
  if (!containerEl) throw new Error("Container não encontrado.");
  const pr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 2;
  const canvas = await html2canvas(containerEl, {
    backgroundColor: background,
    scale: pr,
    useCORS: true,
    logging: false,
  });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Não foi possível gerar o PNG.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sanitizeFileName(fileName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
function emptyGrid(rolos) {
  const g = {};
  TREATMENTS.forEach(t => {
    g[t.id] = {};
    rolos.forEach(r => {
      g[t.id][r] = { N: "", A: "", M: "" };
    });
  });
  return g;
}

function ensureGridHasRolos(grid, rolos) {
  const next = { ...(grid || {}) };
  TREATMENTS.forEach(t => {
    const tid = t.id;
    next[tid] = { ...(next[tid] || {}) };
    rolos.forEach(r => {
      if (!next[tid][r]) next[tid][r] = { N: "", A: "", M: "" };
      if (typeof next[tid][r].N === "undefined") next[tid][r].N = "";
      if (typeof next[tid][r].A === "undefined") next[tid][r].A = "";
      if (typeof next[tid][r].M === "undefined") next[tid][r].M = "";
    });
  });
  return next;
}

/**
 * sumTreatment(grid, tid)
 * Soma N, A, M de todos os 12 rolos de um tratamento.
 * O operador ?. evita erros se o rolo ainda não existir.
 * @returns {{ N, A, M, total }}
 */
function sumTreatment(grid, tid, rolos = makeRolos(12)) {
  let N = 0, A = 0, M = 0;
  rolos.forEach(r => {
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
  const byDat = new Map();
  counts.forEach(c => {
    const existing = byDat.get(c.dat);
    if (!existing || countKindOrder(c) > countKindOrder(existing)) byDat.set(c.dat, c);
  });
  const unique = Array.from(byDat.values());
  const ivg = {};
  TREATMENTS.forEach(t => {
    let sum = 0;
    unique.forEach(c => {
      const { N } = sumTreatment(c.grid, t.id, getCountRolos(c));
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
  const [workspaceCode, setWorkspaceCode] = useState(getStoredWorkspaceCode());
  const workspaceCodeRef = useRef(workspaceCode);
  const pendingInitRef = useRef(null);
  const initialTrialId = "principal";
  const initialKind = "vigor";
  const initialPreset = getTrialPreset(initialTrialId, initialKind);
  const initialRolos = makeRolos(initialPreset.rolosCount);

  const [view, setView]               = useState("dashboard"); // Tela ativa
  const [counts, setCounts]           = useState([]);          // Array de contagens salvas
  const [loading, setLoading]         = useState(true);        // Carregamento inicial
  const [dat, setDat]                 = useState("");          // DAT do formulário
  const [day0, setDay0]               = useState(DEFAULT_DAY0);          // Dia 0 do ensaio (data do tratamento)
  const [countDate, setCountDate]     = useState("");          // Data da contagem (yyyy-mm-dd)
  const [countKind, setCountKind]     = useState(initialKind);
  const [countTrialId, setCountTrialId] = useState(initialTrialId);
  const [countRolosCount, setCountRolosCount] = useState(initialPreset.rolosCount);
  const [countSeedsPerRolo, setCountSeedsPerRolo] = useState(initialPreset.seedsPerRolo);
  const [mountings, setMountings]     = useState(() => normalizeMountings([], DEFAULT_DAY0));
  const [activeMountingId, setActiveMountingId] = useState("default");
  const [showMounting, setShowMounting] = useState(false);
  const [grid, setGrid]               = useState(emptyGrid(initialRolos)); // Dados N/A/M do formulário
  const [activeTreat, setActiveTreat] = useState("T0");        // Aba ativa no formulário
  const [saved, setSaved]             = useState(false);       // Animação de confirmação
  const [editIdx, setEditIdx]         = useState(null);        // null = novo, número = edição
  const [showTrial, setShowTrial]     = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [loadingError, setLoadingError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const countsRef                     = useRef([]);
  const supabaseMetaTimerRef          = useRef(null);
  const supabaseMetaSignatureRef      = useRef("");
  const supabaseMoistureTimerRef      = useRef(null);
  const supabaseMoistureSignatureRef  = useRef("");
  const [editFocus, setEditFocus]     = useState(null);
  const [moistureRows, setMoistureRows] = useState([
    { id: "Rep 1", m1: "", m2: "", m3: "" },
    { id: "Rep 2", m1: "", m2: "", m3: "" },
  ]);

  // ── PERSISTIR DADOS ──────────────────────────────────────────────
  // useCallback evita recriar a função a cada render
  const persist = useCallback((next) => {
    setCounts(next);
  }, []);

  useEffect(() => {
    workspaceCodeRef.current = workspaceCode;
  }, [workspaceCode]);

  // ── CARREGAR DADOS AO INICIAR ────────────────────────────────────
  // useEffect com [] executa UMA vez ao montar o componente
  useEffect(() => {
    (async () => {
      clearLegacyLocalData();
      setLoadingError("");
      const deviceId = workspaceCode;
      if (!deviceId) {
        setCounts([]);
        setDay0("");
        setMountings(normalizeMountings([], ""));
        setActiveMountingId("default");
        setMoistureRows([
          { id: "Rep 1", m1: "", m2: "", m3: "" },
          { id: "Rep 2", m1: "", m2: "", m3: "" },
        ]);
        setLoading(false);
        return;
      }

      const pending = pendingInitRef.current;
      try {
        const [remoteMeta, remoteCounts, remoteMoisture] = await Promise.all([
          withTimeout(loadSupabaseMeta(deviceId), 12000, "Dia 0"),
          withTimeout(loadSupabaseCounts(deviceId), 12000, "contagens"),
          withTimeout(loadSupabaseMoisture(deviceId), 12000, "umidade"),
        ]);

        const remoteDay0 = remoteMeta?.day0 || null;
        const remoteMountings = remoteMeta?.mountings ?? null;
        const nextDay0 = (remoteDay0 || (pending?.code === deviceId ? pending?.day0 : "") || "");
        const nextMountings = normalizeMountings(remoteMountings, nextDay0);
        setDay0(nextDay0);
        setMountings(nextMountings);
        setActiveMountingId((prev) => {
          const keep = String(prev || "").trim();
          if (keep && nextMountings.some((m) => m.id === keep)) return keep;
          return nextMountings[0]?.id || "default";
        });
        setCounts(Array.isArray(remoteCounts) ? remoteCounts : []);
        setMoistureRows(Array.isArray(remoteMoisture) && remoteMoisture.length
          ? remoteMoisture
          : [
            { id: "Rep 1", m1: "", m2: "", m3: "" },
            { id: "Rep 2", m1: "", m2: "", m3: "" },
          ]);
      } catch (err) {
        const nextDay0 = (pending?.code === deviceId ? pending?.day0 : "") || "";
        setDay0(nextDay0);
        setMountings(normalizeMountings([], nextDay0));
        setActiveMountingId("default");
        setCounts([]);
        setMoistureRows([
          { id: "Rep 1", m1: "", m2: "", m3: "" },
          { id: "Rep 2", m1: "", m2: "", m3: "" },
        ]);
        setLoadingError(err?.message || "Não foi possível carregar dados do Supabase.");
      } finally {
        if (pending?.code === deviceId) pendingInitRef.current = null;
        setLoading(false);
      }
    })();
  }, [workspaceCode, reloadKey]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (loading) return;
    const deviceId = workspaceCodeRef.current;
    if (!String(deviceId || "").trim()) return;
    const signature = JSON.stringify({ deviceId, day0: day0 || null, mountings: mountings || [] });
    if (signature === supabaseMetaSignatureRef.current) return;
    supabaseMetaSignatureRef.current = signature;
    if (supabaseMetaTimerRef.current) clearTimeout(supabaseMetaTimerRef.current);
    supabaseMetaTimerRef.current = setTimeout(() => {
      saveSupabaseMeta(deviceId, { day0: day0 || null, mountings: mountings || [] });
    }, 600);
  }, [day0, mountings, workspaceCode, loading]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (loading) return;
    const deviceId = workspaceCodeRef.current;
    if (!String(deviceId || "").trim()) return;
    const signature = JSON.stringify({ deviceId, rows: moistureRows || [] });
    if (signature === supabaseMoistureSignatureRef.current) return;
    supabaseMoistureSignatureRef.current = signature;
    if (supabaseMoistureTimerRef.current) clearTimeout(supabaseMoistureTimerRef.current);
    supabaseMoistureTimerRef.current = setTimeout(() => {
      upsertSupabaseMoistureRows(deviceId, moistureRows);
    }, 650);
  }, [moistureRows, workspaceCode, loading]);

  useEffect(() => {
    if (!day0 || !countDate) return;
    const d = calcDat(day0, countDate);
    if (d === null || d < 0) return;
    setDat(String(d));
    if (editIdx === null) {
      setCountKind(d <= 5 ? "vigor" : "germinacao");
    }
  }, [day0, countDate, editIdx]);

  useEffect(() => {
    if (editIdx !== null) return;
    const preset = getTrialPreset(countTrialId, countKind);
    const m = mountings.find((x) => x.id === (activeMountingId || "default"));
    setCountRolosCount(m?.rolosCount || preset.rolosCount);
    setCountSeedsPerRolo(m?.seedsPerRolo || preset.seedsPerRolo);
  }, [countTrialId, countKind, editIdx, mountings, activeMountingId]);

  useEffect(() => {
    const rolos = getRolosForCount(countTrialId, countKind, countRolosCount);
    setGrid(prev => ensureGridHasRolos(prev, rolos));
  }, [countTrialId, countKind, countRolosCount]);

  useEffect(() => {
    countsRef.current = counts;
  }, [counts]);

  const editIdxRef = useRef(editIdx);
  const viewRef = useRef(view);
  const realtimeRefreshTimerRef = useRef(null);

  useEffect(() => {
    editIdxRef.current = editIdx;
    viewRef.current = view;
  }, [editIdx, view]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const deviceId = workspaceCode;
    if (!deviceId) return;

    const refresh = () => {
      if (editIdxRef.current !== null) return;
      if (realtimeRefreshTimerRef.current) clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = setTimeout(async () => {
        const [remoteMeta, remoteCounts, remoteMoisture] = await Promise.all([
          loadSupabaseMeta(deviceId),
          loadSupabaseCounts(deviceId),
          loadSupabaseMoisture(deviceId),
        ]);
        const remoteDay0 = remoteMeta?.day0 || null;
        const remoteMountings = remoteMeta?.mountings ?? null;
        if (remoteDay0) setDay0(remoteDay0);
        if (remoteMountings !== null) {
          const normalized = normalizeMountings(remoteMountings, remoteDay0 || day0 || "");
          setMountings(normalized);
          setActiveMountingId((prev) => {
            const keep = String(prev || "").trim();
            if (keep && normalized.some((m) => m.id === keep)) return keep;
            return normalized[0]?.id || "default";
          });
        }
        setCounts(Array.isArray(remoteCounts) ? remoteCounts : []);
        setMoistureRows(Array.isArray(remoteMoisture) && remoteMoisture.length
          ? remoteMoisture
          : [
            { id: "Rep 1", m1: "", m2: "", m3: "" },
            { id: "Rep 2", m1: "", m2: "", m3: "" },
          ]);
      }, 350);
    };

    const channel = supabase
      .channel(`germinacao:${deviceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_META_TABLE, filter: `device_id=eq.${deviceId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_COUNTS_TABLE, filter: `device_id=eq.${deviceId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_MOISTURE_TABLE, filter: `device_id=eq.${deviceId}` }, refresh)
      .subscribe();

    return () => {
      if (realtimeRefreshTimerRef.current) clearTimeout(realtimeRefreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [workspaceCode]);

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
    if (!changed) return;
    persist(next);
    (async () => {
      const deviceId = workspaceCodeRef.current;
      if (!deviceId) return;
      if (!isSupabaseConfigured || !supabase) return;

      const rows = next.map((c) => ({
        device_id: deviceId,
        trial_code: getCountTrialId(c),
        kind: getCountKind(c),
        mounting_id: getCountMountingId(c),
        dat: Number(c.dat),
        count_date: c.countDate || null,
        rolos_count: Number(c.rolosCount || getCountRolos(c).length),
        seeds_per_rolo: Number(c.seedsPerRolo || getCountSeedsPerRolo(c)),
        grid: c.grid,
        saved_at: c.savedAt || new Date().toISOString(),
      }));

      if (rows.length) {
        const full = await supabase
          .from(SUPABASE_COUNTS_TABLE)
          .upsert(rows, { onConflict: "device_id,trial_code,kind,mounting_id,dat" });
        if (full.error) {
          const legacyRows = rows.map(({ mounting_id: _m, ...rest }) => rest);
          await supabase
            .from(SUPABASE_COUNTS_TABLE)
            .upsert(legacyRows, { onConflict: "device_id,trial_code,kind,dat" });
        }
      }

      const fullExisting = await supabase
        .from(SUPABASE_COUNTS_TABLE)
        .select("trial_code, kind, mounting_id, dat")
        .eq("device_id", deviceId);

      if (!fullExisting.error && Array.isArray(fullExisting.data)) {
        const keep = new Set(rows.map((r) => `${r.trial_code}|${r.kind}|${r.mounting_id}|${r.dat}`));
        for (const ex of fullExisting.data) {
          const key = `${ex.trial_code}|${ex.kind}|${ex.mounting_id || "default"}|${ex.dat}`;
          if (keep.has(key)) continue;
          await supabase
            .from(SUPABASE_COUNTS_TABLE)
            .delete()
            .eq("device_id", deviceId)
            .eq("trial_code", ex.trial_code)
            .eq("kind", ex.kind)
            .eq("mounting_id", ex.mounting_id || "default")
            .eq("dat", ex.dat);
        }
      } else {
        const legacyExisting = await supabase
          .from(SUPABASE_COUNTS_TABLE)
          .select("trial_code, kind, dat")
          .eq("device_id", deviceId);
        if (!legacyExisting.error && Array.isArray(legacyExisting.data)) {
          const legacyRows = rows.map(({ mounting_id: _m, ...rest }) => rest);
          const keep = new Set(legacyRows.map((r) => `${r.trial_code}|${r.kind}|${r.dat}`));
          for (const ex of legacyExisting.data) {
            const key = `${ex.trial_code}|${ex.kind}|${ex.dat}`;
            if (keep.has(key)) continue;
            await supabase
              .from(SUPABASE_COUNTS_TABLE)
              .delete()
              .eq("device_id", deviceId)
              .eq("trial_code", ex.trial_code)
              .eq("kind", ex.kind)
              .eq("dat", ex.dat);
          }
        }
      }
    })();
  }, [day0, persist]);

  useEffect(() => {
    if (!loading && (!workspaceCode || !day0)) setShowTrial(true);
  }, [loading, day0, workspaceCode]);

  // ── SALVAR CONTAGEM ──────────────────────────────────────────────
  const handleSave = async () => {
    if (!day0) return alert("Informe a data do Dia 0 (tratamento) para calcular o DAT.");
    if (!countDate) return alert("Informe a data da contagem.");
    const d = calcDat(day0, countDate);
    if (d === null) return alert("Informe datas válidas para Dia 0 e para a contagem.");
    if (d < 0) return alert("A data da contagem não pode ser anterior ao Dia 0.");
    const entry = {
      dat: d,
      grid,
      countDate,
      kind: countKind,
      trialId: countTrialId,
      mountingId: activeMountingId || "default",
      rolosCount: countRolosCount,
      seedsPerRolo: countSeedsPerRolo,
      savedAt: new Date().toISOString(),
    };
    let next;
    const previous = editIdx !== null ? counts[editIdx] : null;
    if (editIdx !== null) {
      // Edição: substitui o item no índice editIdx
      next = counts.map((c, i) => i === editIdx ? entry : c);
    } else {
      const exists = counts.findIndex(c =>
        c.dat === d &&
        getCountKind(c) === countKind &&
        getCountTrialId(c) === countTrialId &&
        getCountMountingId(c) === getCountMountingId(entry)
      );
      if (exists >= 0 && !window.confirm(`Já existe contagem no DAT ${d} (${countKind === "vigor" ? "Vigor" : "Germinação"}). Substituir?`)) return;
      next = exists >= 0
        ? counts.map((c, i) => i === exists ? entry : c)
        : [...counts, entry].sort((a, b) => (a.dat - b.dat) || (countKindOrder(a) - countKindOrder(b))); // Mantém ordem crescente
    }
    await persist(next);
    if (previous) {
      const changedKey =
        Number(previous.dat) !== Number(entry.dat) ||
        getCountKind(previous) !== getCountKind(entry) ||
        getCountTrialId(previous) !== getCountTrialId(entry) ||
        getCountMountingId(previous) !== getCountMountingId(entry);
      if (changedKey) await deleteSupabaseCount(workspaceCodeRef.current, previous);
    }
    await upsertSupabaseCount(workspaceCodeRef.current, entry);
    setSaved(true);
    setTimeout(() => { setSaved(false); setView("dashboard"); setEditIdx(null); }, 1200);
  };

  // ── INICIAR EDIÇÃO ───────────────────────────────────────────────
  const startEdit = (idx) => {
    const c = counts[idx];
    setDat(String(c.dat));
    setCountDate(String((c.countDate || c.savedAt || "").slice(0, 10)));
    const nextKind = getCountKind(c);
    const nextTrialId = getCountTrialId(c);
    setActiveMountingId(getCountMountingId(c));
    const rolos = getCountRolos(c);
    const seeds = getCountSeedsPerRolo(c);
    setCountKind(nextKind);
    setCountTrialId(nextTrialId);
    setCountRolosCount(rolos.length);
    setCountSeedsPerRolo(seeds);
    const copied = JSON.parse(JSON.stringify(c.grid));
    setGrid(ensureGridHasRolos(copied, rolos));
    setEditIdx(idx);
    setView("entry");
    const focus = findFirstUnfilledCell(c.grid, rolos);
    setEditFocus(focus);
    setActiveTreat(focus?.treatId || "T0");
  };

  // ── DELETAR CONTAGEM ─────────────────────────────────────────────
  const deleteCount = async (idx) => {
    if (!window.confirm("Remover esta contagem?")) return;
    const entry = counts[idx];
    await persist(counts.filter((_, i) => i !== idx));
    if (entry) await deleteSupabaseCount(workspaceCodeRef.current, entry);
  };

  const clearWorkspaceData = async (deviceId) => {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase não configurado.");
    const id = String(deviceId || "").trim();
    if (!id) throw new Error("Código inválido.");

    await supabase.from(SUPABASE_COUNTS_TABLE).delete().eq("device_id", id);
    await supabase.from(SUPABASE_MOISTURE_TABLE).delete().eq("device_id", id);
    await supabase.from(SUPABASE_META_TABLE).delete().eq("device_id", id);
  };

  // ── NOVA CONTAGEM ────────────────────────────────────────────────
  const startNew = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setCountDate(`${yyyy}-${mm}-${dd}`);
    setCountKind("vigor");
    const mounting = mountings.find((m) => m.id === (activeMountingId || "default")) || mountings[0];
    const trialId = mounting?.trialId || countTrialId;
    const preset = getTrialPreset(trialId, "vigor");
    const rolosCount = mounting?.rolosCount || preset.rolosCount;
    setCountTrialId(trialId);
    setCountRolosCount(rolosCount);
    setCountSeedsPerRolo(mounting?.seedsPerRolo || preset.seedsPerRolo);
    setDat(""); setGrid(emptyGrid(makeRolos(rolosCount))); setEditIdx(null);
    setEditFocus(null);
    setActiveTreat("T0"); setView("entry");
  };

  const startNewAtDate = (isoDate) => {
    setCountDate(isoDate);
    setCountKind("vigor");
    const mounting = mountings.find((m) => m.id === (activeMountingId || "default")) || mountings[0];
    const trialId = mounting?.trialId || countTrialId;
    const preset = getTrialPreset(trialId, "vigor");
    const rolosCount = mounting?.rolosCount || preset.rolosCount;
    setCountTrialId(trialId);
    setCountRolosCount(rolosCount);
    setCountSeedsPerRolo(mounting?.seedsPerRolo || preset.seedsPerRolo);
    setDat(""); setGrid(emptyGrid(makeRolos(rolosCount))); setEditIdx(null);
    setEditFocus(null);
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
    const n = Number(grid[activeTreat]?.[rolo]?.N || 0);
    const a = Number(grid[activeTreat]?.[rolo]?.A || 0);
    const m = Number(countSeedsPerRolo || 0) - n - a;
    if (m >= 0) setCell(rolo, "M", m);
  };

  if (!isSupabaseConfigured || !supabase) return (
    <div style={{ background: UI.bg, color: UI.text, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_SANS, padding: 24 }}>
      <div style={{ maxWidth: 560, background: UI.surface, border: `1px solid ${UI.border}`, borderRadius: 12, padding: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Supabase não configurado</div>
        <div style={{ fontSize: 13, color: UI.textSoft }}>
          Configure as variáveis de ambiente no Vercel: VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.
        </div>
      </div>
    </div>
  );

  // ── TELA DE CARREGAMENTO ─────────────────────────────────────────
  if (loading) return (
    <div style={{ background: UI.bg, color: UI.accent, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_SANS, fontSize: 14, padding: 24 }}>
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <div>Carregando dados...</div>
        <div style={{ marginTop: 12 }}>
          <button
            className="btn"
            onClick={() => { setLoading(false); setShowTrial(true); }}
            style={{ background: "transparent", border: `1px solid ${UI.border}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, fontFamily: FONT_SANS, color: UI.textSoft }}
          >
            Abrir Cadastro do Ensaio
          </button>
        </div>
      </div>
    </div>
  );

  // ── RENDERIZAÇÃO PRINCIPAL ───────────────────────────────────────
  const activeMounting = mountings.find((m) => m.id === (activeMountingId || "default")) || mountings[0] || null;
  const headerCounts = (counts || []).filter((c) => getCountMountingId(c) === (activeMountingId || "default"));
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
              Código: {workspaceCode || "—"} · Dia 0: {day0 ? formatPtBrDate(day0) : "—"} · Montagem: {activeMounting?.label || "—"} · {headerCounts.length} CONTAGEM{headerCounts.length !== 1 ? "S" : ""} · DATs: {headerCounts.map(c => c.dat).join(", ") || "—"}
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
      {loadingError ? (
        <div style={{ padding: "10px 24px", background: "#c47b6a11", borderBottom: `1px solid ${UI.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "#9b3f31", fontFamily: FONT_SANS }}>
              {loadingError}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                onClick={() => { setLoading(true); setReloadKey(k => k + 1); }}
                style={{ background: "transparent", border: `1px solid ${UI.border}`, borderRadius: 10, padding: "8px 10px", fontSize: 12, fontFamily: FONT_SANS, color: UI.textSoft }}
              >
                Tentar novamente
              </button>
              <button
                className="btn"
                onClick={() => setShowTrial(true)}
                style={{ background: "transparent", border: `1px solid ${UI.border}`, borderRadius: 10, padding: "8px 10px", fontSize: 12, fontFamily: FONT_SANS, color: UI.textSoft }}
              >
                Abrir Ensaio
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ════ ROTEAMENTO DE TELAS ════════════════════════════════════
          Em vez de um router externo, usamos condicionais simples */}
      {view === "dashboard" && (
        <DashboardView
          counts={counts}
          mountings={mountings}
          activeMountingId={activeMountingId}
          setActiveMountingId={setActiveMountingId}
          openMountingModal={() => setShowMounting(true)}
          startEdit={startEdit}
          deleteCount={deleteCount}
          openCalendar={() => setShowCalendar(true)}
          moistureRows={moistureRows}
          setMoistureRows={setMoistureRows}
        />
      )}
      {view === "entry" && (
        <EntryView
          dat={dat} setDat={setDat} day0={day0} openTrial={() => setShowTrial(true)} countDate={countDate} setCountDate={setCountDate} grid={grid}
          countKind={countKind} setCountKind={setCountKind}
          countTrialId={countTrialId} setCountTrialId={setCountTrialId}
          countRolosCount={countRolosCount} setCountRolosCount={setCountRolosCount}
          countSeedsPerRolo={countSeedsPerRolo} setCountSeedsPerRolo={setCountSeedsPerRolo}
          mountings={mountings}
          activeMountingId={activeMountingId}
          onChangeMounting={(nextId) => {
            const id = String(nextId || "").trim() || "default";
            setActiveMountingId(id);
            const m = mountings.find((x) => x.id === id);
            if (!m) return;
            const trialId = m.trialId || "principal";
            const preset = getTrialPreset(trialId, countKind);
            setCountTrialId(trialId);
            setCountRolosCount(m.rolosCount || preset.rolosCount);
            setCountSeedsPerRolo(m.seedsPerRolo || preset.seedsPerRolo);
          }}
          openMountingModal={() => setShowMounting(true)}
          activeTreat={activeTreat} setActiveTreat={setActiveTreat}
          setCell={setCell} fillM={fillM}
          saved={saved} editIdx={editIdx}
          editFocus={editFocus}
          handleSave={handleSave}
          onCancel={() => setView("dashboard")}
        />
      )}
      {showTrial && (
        <TrialSetupModal
          workspaceCode={workspaceCode}
          applyWorkspaceCode={(nextCode, nextDay0) => {
            const cleaned = String(nextCode || "").trim();
            if (!cleaned) return;
            const d0 = String(nextDay0 || "").trim() || DEFAULT_DAY0;
            pendingInitRef.current = { code: cleaned, day0: d0 };
            try { localStorage.setItem(WORKSPACE_CODE_KEY, cleaned); } catch {}
            setWorkspaceCode(cleaned);
            setDay0(d0);
            setMountings(normalizeMountings([], d0));
            setActiveMountingId("default");
            setCounts([]);
            setMoistureRows([
              { id: "Rep 1", m1: "", m2: "", m3: "" },
              { id: "Rep 2", m1: "", m2: "", m3: "" },
            ]);
            setLoadingError("");
            setLoading(true);
          }}
          day0={day0}
          setDay0={setDay0}
          clearWorkspaceData={clearWorkspaceData}
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
      {showMounting && (
        <MountingModal
          day0={day0}
          mountings={mountings}
          onClose={() => setShowMounting(false)}
          onAdd={(m) => {
            setMountings((prev) => normalizeMountings([...(prev || []), m], day0));
            setActiveMountingId(m.id);
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
function EntryView({ dat, setDat, day0, openTrial, countDate, setCountDate, countKind, setCountKind, countTrialId, setCountTrialId, countRolosCount, setCountRolosCount, countSeedsPerRolo, setCountSeedsPerRolo, mountings, activeMountingId, onChangeMounting, openMountingModal, grid, activeTreat, setActiveTreat, setCell, fillM, saved, editIdx, editFocus, handleSave, onCancel }) {
  const inputRefs = useRef({});
  const timersRef = useRef({});
  const gridScrollRef = useRef(null);
  const lastAutoFocusKeyRef = useRef("");
  const exportSheetRef = useRef(null);
  const rolos = getRolosForCount(countTrialId, countKind, countRolosCount);
  const seedsPerRolo = Number(countSeedsPerRolo || 0) || getTrialPreset(countTrialId, countKind).seedsPerRolo;
  const datLabel = String(dat || (day0 && countDate ? (calcDat(day0, countDate) ?? "") : "") || "").trim();
  const activeMounting = (mountings || []).find((m) => m.id === (activeMountingId || "default")) || (mountings || [])[0] || null;

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(t => clearTimeout(t));
      timersRef.current = {};
    };
  }, []);

  const exportAllTreatmentsSinglePng = async () => {
    try {
      const base = `contagem_${activeMounting?.label || "montagem"}_dat_${datLabel || "?"}_${countKind === "vigor" ? "vigor" : "germinacao"}_${countDate || ""}`;
      await exportHtmlAsPng(exportSheetRef.current, `${base}.png`, { background: "#ffffff", pixelRatio: 2 });
    } catch (err) {
      alert(err?.message || "Não foi possível exportar o PNG.");
    }
  };

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

  useEffect(() => {
    const key = editIdx === null
      ? ""
      : `${editIdx}:${editFocus?.treatId || activeTreat}:${editFocus?.rolo || ""}:${editFocus?.tipo || ""}`;

    if (!key) {
      lastAutoFocusKeyRef.current = "";
      return;
    }
    if (lastAutoFocusKeyRef.current === key) return;
    lastAutoFocusKeyRef.current = key;

    const targetTreat = editFocus?.treatId || activeTreat;
    if (targetTreat && targetTreat !== activeTreat) return;

    const rolo = editFocus?.rolo || rolos[rolos.length - 1];
    const tipoPriority = editFocus?.tipo
      ? [editFocus.tipo, ...TIPOS.filter(t => t !== editFocus.tipo)]
      : ["M", "A", "N"];

    setTimeout(() => {
      for (const tipo of tipoPriority) {
        const el = inputRefs.current[keyFor(rolo, tipo)];
        if (el) {
          el.scrollIntoView({ block: "nearest", inline: "center" });
          el.focus();
          if (typeof el.select === "function") el.select();
          return;
        }
      }
      if (gridScrollRef.current) {
        gridScrollRef.current.scrollLeft = gridScrollRef.current.scrollWidth;
      }
    }, 0);
  }, [editIdx, editFocus, activeTreat]);

  const nextCoords = (rolo, tipo) => {
    const roloIdx = rolos.indexOf(rolo);
    const tipoIdx = TIPOS.indexOf(tipo);
    if (roloIdx < 0 || tipoIdx < 0) return null;

    let nextRolo = rolo;
    let nextTipo = TIPOS[tipoIdx + 1];
    if (!nextTipo) {
      nextRolo = rolos[roloIdx + 1];
      nextTipo = TIPOS[0];
    }
    if (!nextRolo || !nextTipo) return null;
    return { rolo: nextRolo, tipo: nextTipo };
  };

  const prevCoords = (rolo, tipo) => {
    const roloIdx = rolos.indexOf(rolo);
    const tipoIdx = TIPOS.indexOf(tipo);
    if (roloIdx < 0 || tipoIdx < 0) return null;

    let prevRolo = rolo;
    let prevTipo = TIPOS[tipoIdx - 1];
    if (!prevTipo) {
      prevRolo = rolos[roloIdx - 1];
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
    if (num > seedsPerRolo) num = seedsPerRolo;

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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Montagem:</span>
            <select
              value={activeMountingId || "default"}
              onChange={(e) => onChangeMounting?.(e.target.value)}
              disabled={editIdx !== null}
              style={{ ...inputStyle, width: 210, textAlign: "left" }}
            >
              {(mountings || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || m.id}
                </option>
              ))}
            </select>
            <button
              className="btn"
              onClick={openMountingModal}
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
              + Montagem
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>DAT:</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: UI.text, fontFamily: FONT_SANS }}>{dat || "—"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Tipo:</span>
            <div style={{ display: "flex", border: `1px solid ${UI.border}`, borderRadius: 8, overflow: "hidden" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setCountKind("vigor")}
                style={{
                  background: countKind === "vigor" ? UI.accent : "transparent",
                  color: countKind === "vigor" ? "#fff" : UI.textSoft,
                  padding: "6px 10px",
                  fontSize: 12,
                  fontFamily: FONT_SANS,
                }}
              >
                Vigor
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setCountKind("germinacao")}
                style={{
                  background: countKind === "germinacao" ? UI.accent : "transparent",
                  color: countKind === "germinacao" ? "#fff" : UI.textSoft,
                  padding: "6px 10px",
                  fontSize: 12,
                  fontFamily: FONT_SANS,
                }}
              >
                Germinação
              </button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Ensaio:</span>
            <div style={{ display: "flex", border: `1px solid ${UI.border}`, borderRadius: 8, overflow: "hidden" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setCountTrialId("principal")}
                style={{
                  background: countTrialId === "principal" ? UI.accent : "transparent",
                  color: countTrialId === "principal" ? "#fff" : UI.textSoft,
                  padding: "6px 10px",
                  fontSize: 12,
                  fontFamily: FONT_SANS,
                }}
              >
                Principal
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setCountTrialId("sem_vermiculita")}
                style={{
                  background: countTrialId === "sem_vermiculita" ? UI.accent : "transparent",
                  color: countTrialId === "sem_vermiculita" ? "#fff" : UI.textSoft,
                  padding: "6px 10px",
                  fontSize: 12,
                  fontFamily: FONT_SANS,
                }}
              >
                Sem vermiculita
              </button>
            </div>
          </div>
          <InfoTooltip text={INFO_TEXTS.ultimaContagem} />
        </div>
      </div>

      {/* Abas de tratamento com indicador de progresso */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TREATMENTS.map(t => {
          // Conta rolos que já têm algum valor digitado
          const filled = rolos.filter(r =>
            grid[t.id]?.[r]?.N !== "" || grid[t.id]?.[r]?.A !== "" || grid[t.id]?.[r]?.M !== ""
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
              <span style={{ marginLeft: 8, fontSize: 10, color: filled === rolos.length ? "#6fa58b" : "#b69b6a" }}>
                {filled}/{rolos.length} rolos
              </span>
            </button>
          );
        })}
      </div>

      {/* Grade de entrada para o tratamento ativo */}
      {(() => {
        const t = TREATMENTS.find(x => x.id === activeTreat);
        const sums = sumTreatment(grid, activeTreat, rolos);
        return (
          <div style={card({ marginBottom: 20 })}>
            {/* Cabeçalho com totais em tempo real */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 style={{ fontFamily: FONT_SANS, fontSize: 11, color: UI.textSoft, letterSpacing: 0.3 }}>
                ROLO-PAPEL · {t.name.toUpperCase()} · {seedsPerRolo} sementes/rolo
              </h3>
              <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                {["N","A","M"].map(tp => (
                  <span key={tp} style={{ color: TIPO_COLORS[tp], fontFamily: FONT_SANS }}>
                    {tp}: {sums[tp]}
                  </span>
                ))}
                <span style={{ color: UI.textSoft }}>Total: {sums.total}/{rolos.length * 25}</span>
              </div>
            </div>

            <div ref={gridScrollRef} className="entry-grid-scroll">
              <div className="entry-grid-inner" style={{ minWidth: 70 + rolos.length * 52 }}>
                {/* Linha de cabeçalho com nomes dos rolos */}
                <div style={{ display: "grid", gridTemplateColumns: `70px repeat(${rolos.length}, 1fr)`, gap: 6, marginBottom: 6 }}>
                  <div />
                  {rolos.map(r => (
                    <div key={r} style={{ fontSize: 10, color: UI.textSoft, textAlign: "center", fontFamily: FONT_SANS }}>{r}</div>
                  ))}
                </div>

                {/* Uma linha por tipo: Normal, Anormal, Morta */}
                {TIPOS.map(tipo => (
                  <div key={tipo} style={{ display: "grid", gridTemplateColumns: `70px repeat(${rolos.length}, 1fr)`, gap: 6, marginBottom: 6, alignItems: "center" }}>
                    <div style={{ fontSize: 14, color: TIPO_COLORS[tipo], fontFamily: FONT_SANS, fontWeight: 600, letterSpacing: 0.2, textAlign: "right", paddingRight: 8 }}>
                      {TIPO_LABELS[tipo]}
                    </div>
                    {/* Um input por rolo — borda colorida quando preenchido */}
                    {rolos.map(r => (
                      <input
                        key={r}
                        ref={setInputRef(r, tipo)}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={2}
                        className="cell-input"
                        value={grid[activeTreat]?.[r]?.[tipo] ?? ""}
                        onChange={e => handleCellChange(r, tipo, e.target.value)}
                        onKeyDown={e => handleCellKeyDown(r, tipo, e)}
                        onFocus={(e) => e.target.select()}
                        style={{ borderColor: (grid[activeTreat]?.[r]?.[tipo] ?? "") !== "" ? `${TIPO_COLORS[tipo]}66` : UI.border }}
                      />
                    ))}
                  </div>
                ))}

                {/* Linha de preenchimento automático: M = 25 - N - A */}
                <div style={{ display: "grid", gridTemplateColumns: `70px repeat(${rolos.length}, 1fr)`, gap: 6, marginTop: 4 }}>
                  <div style={{ fontSize: 9, color: UI.textSoft, textAlign: "right", paddingRight: 8, paddingTop: 6 }}>auto M ▼</div>
                  {rolos.map(r => {
                    const n = Number(grid[activeTreat]?.[r]?.N || 0);
                    const a = Number(grid[activeTreat]?.[r]?.A || 0);
                    const rem = seedsPerRolo - n - a;
                    return (
                      <button key={r} className="btn" onClick={() => fillM(r)}
                        title={`Preencher Mortas = ${seedsPerRolo} - N - A`}
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

      <div style={{ position: "fixed", left: -10000, top: 0, background: "#ffffff" }}>
        <div ref={exportSheetRef} style={{ width: 1200, padding: 18, background: "#ffffff", color: "#0f172a", fontFamily: FONT_SANS }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.2 }}>
            Contagem DAT {datLabel || "—"} · {countKind === "vigor" ? "Vigor" : "Germinação"}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#334155", display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>Dia 0: <b style={{ color: "#0f172a" }}>{day0 ? formatPtBrDate(day0) : "—"}</b></span>
            <span>Contagem: <b style={{ color: "#0f172a" }}>{countDate ? formatPtBrDate(countDate) : "—"}</b></span>
            <span>Montagem: <b style={{ color: "#0f172a" }}>{activeMounting?.label || "—"}</b></span>
            <span>Ensaio: <b style={{ color: "#0f172a" }}>{countTrialId === "sem_vermiculita" ? "Sem vermiculita" : "Principal"}</b></span>
          </div>

          {TREATMENTS.map((t) => {
            const s = sumTreatment(grid, t.id, rolos);
            const expected = rolos.length * seedsPerRolo;
            return (
              <div key={t.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: t.color }}>
                    {t.id} · {t.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#334155" }}>
                    <span style={{ color: "#6fa58b", fontWeight: 800 }}>N:</span> {s.N}{" "}
                    <span style={{ color: "#b69b6a", fontWeight: 800 }}>A:</span> {s.A}{" "}
                    <span style={{ color: "#c47b6a", fontWeight: 800 }}>M:</span> {s.M}{" "}
                    <span style={{ fontWeight: 800 }}>Total:</span> {s.total}/{expected}
                  </div>
                </div>

                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ textAlign: "left", padding: "8px 8px", color: "#475569", fontFamily: FONT_SANS, fontSize: 11, fontWeight: 800, width: 92 }}>Tipo</th>
                      {rolos.map((r) => (
                        <th key={r} style={{ textAlign: "center", padding: "8px 6px", color: "#475569", fontFamily: FONT_SANS, fontSize: 11, fontWeight: 800 }}>
                          {r}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TIPOS.map((tipo) => (
                      <tr key={tipo} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 8px", fontFamily: FONT_SANS, fontWeight: 800, color: TIPO_COLORS[tipo] }}>
                          {TIPO_LABELS[tipo]}
                        </td>
                        {rolos.map((r) => {
                          const v = grid?.[t.id]?.[r]?.[tipo];
                          const txt = v === "" || v === null || typeof v === "undefined" ? "—" : String(v);
                          return (
                            <td key={`${tipo}-${r}`} style={{ padding: "8px 6px", textAlign: "center", fontFamily: FONT_SANS, color: "#0f172a" }}>
                              {txt}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>

      {/* Botões de ação */}
      <div className="entry-actions">
        <button className="btn" onClick={onCancel} style={{
          background: "transparent", border: `1px solid ${UI.border}`, color: UI.textSoft,
          borderRadius: 8, padding: "10px 20px", fontSize: 13, fontFamily: FONT_SANS,
        }}>Cancelar</button>
        <button className="btn" onClick={exportAllTreatmentsSinglePng} style={{
          background: "transparent", border: `1px solid ${UI.border}`, color: UI.textSoft,
          borderRadius: 8, padding: "10px 20px", fontSize: 13, fontFamily: FONT_SANS,
        }}>📷 PNG (T0–T3)</button>
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
function DashboardView({ counts, mountings, activeMountingId, setActiveMountingId, openMountingModal, startEdit, deleteCount, openCalendar, moistureRows, setMoistureRows }) {

  // Tratamento selecionado para o gráfico de rolos
  const [selT, setSelT] = useState("T1");
  const trendChartRef = useRef(null);
  const distChartRef = useRef(null);
  const roloChartRef = useRef(null);

  // Ordena por DAT crescente para os gráficos de linha
  const activeId = String(activeMountingId || "").trim() || "default";
  const activeMounting = (mountings || []).find((m) => m.id === activeId) || (mountings || [])[0] || null;
  const filteredCounts = (counts || []).filter((c) => getCountMountingId(c) === activeId);
  const sortedAll = [...filteredCounts].sort((a, b) => (a.dat - b.dat) || (countKindOrder(a) - countKindOrder(b)));
  const groupedByDat = new Map();
  sortedAll.forEach(c => {
    const existing = groupedByDat.get(c.dat);
    if (!existing || countKindOrder(c) > countKindOrder(existing)) groupedByDat.set(c.dat, c);
  });
  const sorted = Array.from(groupedByDat.values()).sort((a, b) => a.dat - b.dat);
  const latest = sorted[sorted.length - 1];
  const ivg = calcIVG(sorted);
  const rolosLatest = latest ? getCountRolos(latest) : makeRolos(12);
  const seedsLatest = latest ? getCountSeedsPerRolo(latest) : 25;

  // ── PREPARAÇÃO DOS DADOS DOS GRÁFICOS ─────────────────────────

  // LineChart: [{ dat:5, T0:41.7, T1:58.0, ... }, { dat:8, ... }]
  const trendData = sorted.map(c => {
    const row = { dat: c.dat };
    TREATMENTS.forEach(t => {
      const s = sumTreatment(c.grid, t.id, getCountRolos(c));
      row[t.id] = s.total > 0 ? +((s.N / s.total) * 100).toFixed(1) : 0;
    });
    return row;
  });

  // BarChart comparativo da última contagem
  const latestBar = latest ? TREATMENTS.map(t => {
    const s = sumTreatment(latest.grid, t.id, rolosLatest);
    return {
      name: t.id,
      Normais:  s.total > 0 ? +((s.N / s.total) * 100).toFixed(1) : 0,
      Anormais: s.total > 0 ? +((s.A / s.total) * 100).toFixed(1) : 0,
      Mortas:   s.total > 0 ? +((s.M / s.total) * 100).toFixed(1) : 0,
    };
  }) : [];

  // BarChart empilhado por rolo do tratamento selecionado
  const roloData = latest ? rolosLatest.map(r => ({
    name: r,
    N: Number(latest.grid[selT]?.[r]?.N || 0),
    A: Number(latest.grid[selT]?.[r]?.A || 0),
    M: Number(latest.grid[selT]?.[r]?.M || 0),
  })) : [];

  // Determina qual tratamento tem maior % de normais na última contagem
  const bestT = latest ? TREATMENTS.reduce((best, t) => {
    const s    = sumTreatment(latest.grid, t.id, rolosLatest);
    const pct  = s.total > 0 ? s.N / s.total : 0;
    const bs   = sumTreatment(latest.grid, best.id, rolosLatest);
    const bpct = bs.total > 0 ? bs.N / bs.total : 0;
    return pct > bpct ? t : best;
  }, TREATMENTS[0]) : null;

  const moistureWithCalc = moistureRows.map(r => ({
    ...r,
    pct: calcMoisturePercent(r.m1, r.m2, r.m3),
  }));
  const validMoisture = moistureWithCalc.filter(r => r.pct !== null).map(r => r.pct);
  const avgMoisture = validMoisture.length
    ? validMoisture.reduce((a, b) => a + b, 0) / validMoisture.length
    : null;
  const moistureSpread = validMoisture.length >= 2
    ? Math.max(...validMoisture) - Math.min(...validMoisture)
    : null;

  const setMoistureCell = (idx, key, value) => {
    const normalized = String(value ?? "").replace(",", ".").replace(/[^\d.]/g, "");
    setMoistureRows(prev =>
      prev.map((row, i) => (i === idx ? { ...row, [key]: normalized } : row))
    );
  };

  // Estado vazio
  if (!filteredCounts.length) return (
    <div style={{ textAlign: "center", padding: "80px 24px", color: UI.textSoft }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🌾</div>
      <p style={{ fontFamily: FONT_SANS, fontSize: 13 }}>Nenhuma contagem registrada nesta montagem.</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
        <select
          value={activeId}
          onChange={(e) => setActiveMountingId?.(e.target.value)}
          style={{ ...inputStyle, width: 240, textAlign: "left" }}
        >
          {(mountings || []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label || m.id}
            </option>
          ))}
        </select>
        <button
          className="btn"
          onClick={openMountingModal}
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
          + Montagem
        </button>
      </div>
      <p style={{ fontSize: 12, marginTop: 10 }}>Selecione outra montagem ou crie uma nova.</p>
    </div>
  );

  const exportPng = async (ref, baseName) => {
    try {
      await exportFirstSvgAsPng(ref?.current, `${baseName}.png`);
    } catch (err) {
      alert(err?.message || "Não foi possível exportar o PNG.");
    }
  };

  const exportRoloPngAllTreatments = async () => {
    const datLabel = latest?.dat || "atual";
    for (const t of TREATMENTS) {
      setSelT(t.id);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await exportPng(roloChartRef, `variacao_rolo_${t.id}_dat_${datLabel}`);
    }
  };

  return (
    <div className="dashboard-layout">
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>
          Montagem: <b style={{ color: UI.text }}>{activeMounting?.label || "—"}</b> · Planejamento do ensaio e datas sugeridas
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={activeId}
            onChange={(e) => setActiveMountingId?.(e.target.value)}
            style={{ ...inputStyle, width: 220, textAlign: "left" }}
          >
            {(mountings || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label || m.id}
              </option>
            ))}
          </select>
          <button
            className="btn"
            onClick={openMountingModal}
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
            + Montagem
          </button>
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
          const s = sumTreatment(latest.grid, bestT.id, rolosLatest);
          const pct = s.total > 0 ? ((s.N / s.total) * 100).toFixed(1) : 0;
          return <KPIBlock label="MELHOR TRATAMENTO" val={bestT.id} sub={`${bestT.name} · ${pct}% normais`} color={bestT.color} tag="LÍDER" infoKey="melhorTratamento" />;
        })()}

        <KPIBlock label="ÚLTIMA CONTAGEM" val={`DAT ${latest.dat}`}
          sub={`${formatPtBrDate(latest.countDate || latest.savedAt)} · ${getCountKind(latest) === "vigor" ? "Vigor" : "Germinação"}`}
          color="#6f93b5" infoKey="ultimaContagem" />

        <KPIBlock label="TOTAL DE CONTAGENS" val={filteredCounts.length}
          sub={`DATs: ${sorted.map(c => c.dat).join(", ")}`}
          color="#a78bfa" infoKey="totalContagens" />

        {/* IVG de cada tratamento — versão compacta */}
        {TREATMENTS.map(t => (
          <KPIBlock key={t.id} label={`IVG — ${t.id}`} val={ivg[t.id]}
            sub={t.name} color={t.color} small infoKey="ivg" />
        ))}
      </div>

      <div style={card({ marginBottom: 16 })}>
        <CardTitle emoji="💧" title="UMIDADE (RAS) — MÉTODO DE ESTUFA" />
        <div style={{ color: UI.textSoft, fontSize: 11, marginBottom: 10 }}>
          Informe massas (g): `M1` = recipiente+tampa, `M2` = recipiente+amostra úmida, `M3` = recipiente+amostra seca.
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${UI.border}` }}>
                {["Rep", "M1 (tara)", "M2 (úmida)", "M3 (seca)", "Umidade %"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "8px", color: UI.textSoft, fontFamily: FONT_SANS, fontSize: 11, fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {moistureWithCalc.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "8px", fontWeight: 600, color: UI.text }}>{r.id}</td>
                  {["m1", "m2", "m3"].map(k => (
                    <td key={k} style={{ padding: "8px" }}>
                      <input
                        value={r[k]}
                        onChange={e => setMoistureCell(i, k, e.target.value)}
                        inputMode="decimal"
                        placeholder="0,000"
                        style={{ ...inputStyle, width: 120, textAlign: "right" }}
                      />
                    </td>
                  ))}
                  <td style={{ padding: "8px", color: r.pct === null ? UI.textSoft : "#6f93b5", fontWeight: 700 }}>
                    {r.pct === null ? "—" : `${r.pct.toFixed(2)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap", fontSize: 12 }}>
          <span style={{ color: UI.textSoft }}>Média: <b style={{ color: UI.text }}>{avgMoisture === null ? "—" : `${avgMoisture.toFixed(2)}%`}</b></span>
          <span style={{ color: UI.textSoft }}>Amplitude (máx-mín): <b style={{ color: UI.text }}>{moistureSpread === null ? "—" : `${moistureSpread.toFixed(2)} p.p.`}</b></span>
        </div>
      </div>

      {/* ── LINHA 2: EVOLUÇÃO + DISTRIBUIÇÃO ─────────────────────
          Grid CSS de 2 colunas iguais lado a lado */}
      <div className="dashboard-charts">

        {/* Card: Gráfico de evolução por DAT */}
        <div ref={trendChartRef} style={card()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <CardTitle emoji="📈" title="EVOLUÇÃO % NORMAIS POR DAT" infoKey="evolucao" extra={{ marginBottom: 0 }} />
            <button
              className="btn"
              onClick={() => exportPng(trendChartRef, `evolucao_dat_${latest?.dat || "atual"}`)}
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
              📷 PNG
            </button>
          </div>
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
        <div ref={distChartRef} style={card()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <CardTitle emoji="📊" title={`DISTRIBUIÇÃO ATUAL (DAT ${latest?.dat})`} infoKey="distribuicao" extra={{ marginBottom: 0 }} />
            <button
              className="btn"
              onClick={() => exportPng(distChartRef, `distribuicao_dat_${latest?.dat || "atual"}`)}
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
              📷 PNG
            </button>
          </div>
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
      <div ref={roloChartRef} style={card({ marginBottom: 16 })}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <CardTitle emoji="🔬" title={`VARIAÇÃO POR ROLO — DAT ${latest?.dat}`} infoKey="variacaoRolo" extra={{ marginBottom: 0 }} />
          {/* Botões de seleção de tratamento */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
            <button
              className="btn"
              onClick={() => exportPng(roloChartRef, `variacao_rolo_${selT}_dat_${latest?.dat || "atual"}`)}
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
              📷 PNG
            </button>
            <button
              className="btn"
              onClick={exportRoloPngAllTreatments}
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
              📷 PNG (T0–T3)
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          {/* stackId="a" = empilha as 3 barras do mesmo rolo */}
          <BarChart data={roloData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 9, fontFamily: FONT_SANS }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} domain={[0, seedsLatest]} axisLine={false} tickLine={false} />
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
        {sortedAll.length === 0
          ? <p style={{ color: UI.textSoft, fontSize: 12 }}>Sem contagens.</p>
          : <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${UI.border}` }}>
                    <th style={{ textAlign: "left", padding: "8px 10px", color: UI.textSoft, fontFamily: FONT_SANS, fontSize: 9, letterSpacing: 0.4, fontWeight: 500 }}>DAT</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", color: UI.textSoft, fontFamily: FONT_SANS, fontSize: 9, letterSpacing: 0.4, fontWeight: 500 }}>Data</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", color: UI.textSoft, fontFamily: FONT_SANS, fontSize: 9, letterSpacing: 0.4, fontWeight: 500 }}>Tipo</th>
                    {TREATMENTS.flatMap(t =>
                      ["N", "A", "M"].map(tipo => (
                        <th
                          key={`${t.id}-${tipo}`}
                          style={{ textAlign: "left", padding: "8px 10px", color: UI.textSoft, fontFamily: FONT_SANS, fontSize: 9, letterSpacing: 0.4, fontWeight: 500 }}
                        >
                          {t.id} {tipo}%
                        </th>
                      ))
                    )}
                    <th style={{ textAlign: "left", padding: "8px 10px", color: UI.textSoft, fontFamily: FONT_SANS, fontSize: 9, letterSpacing: 0.4, fontWeight: 500 }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAll.map((c, i) => (
                    <tr key={`${c.dat}-${getCountKind(c)}-${i}`} style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <td style={{ padding: "10px", fontFamily: FONT_SANS, fontWeight: 700, fontSize: 16, color: "#6f93b5", letterSpacing: 0.2 }}>{c.dat}</td>
                      <td style={{ padding: "10px", color: UI.textSoft, fontSize: 11, fontFamily: FONT_SANS }}>
                        {formatPtBrDate(c.countDate || c.savedAt)}
                      </td>
                      <td style={{ padding: "10px", color: UI.textSoft, fontSize: 11, fontFamily: FONT_SANS }}>
                        {getCountKind(c) === "vigor" ? "Vigor" : "Germinação"}
                      </td>
                      {TREATMENTS.flatMap(t =>
                        ["N", "A", "M"].map(tipo => {
                          const s = sumTreatment(c.grid, t.id, getCountRolos(c));
                          const val = Number(s[tipo] || 0);
                          const pctStr = s.total > 0 ? ((val / s.total) * 100).toFixed(1) : "—";
                          const pctNum = pctStr === "—" ? 0 : Number(pctStr);
                          const color = TIPO_COLORS[tipo];
                          return (
                            <td key={`${t.id}-${tipo}`} style={{ padding: "10px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <div style={{ width: 40, height: 4, background: "#e5e7eb", borderRadius: 2 }}>
                                  <div style={{ width: `${pctNum}%`, height: "100%", background: color, borderRadius: 2 }} />
                                </div>
                                <span style={{ fontFamily: FONT_SANS, fontSize: 11, color }}>
                                  {pctStr}%
                                </span>
                              </div>
                            </td>
                          );
                        })
                      )}
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

function TrialSetupModal({ workspaceCode, applyWorkspaceCode, day0, setDay0, clearWorkspaceData, onClose }) {
  const [code, setCode] = useState(workspaceCode || "");
  const [value, setValue] = useState(day0 || DEFAULT_DAY0);

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
          Use o mesmo código em outros dispositivos para todos acessarem o mesmo ensaio. Dia 0 = data em que os tratamentos foram aplicados. O DAT das contagens será calculado automaticamente a partir dessa data.
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Código:</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ex: ENSAIO-2026-A"
            style={{ ...inputStyle, width: 220, textAlign: "center", textTransform: "uppercase" }}
          />
          <button
            className="btn"
            onClick={() => {
              const next = (typeof crypto?.randomUUID === "function"
                ? crypto.randomUUID().slice(0, 8)
                : Math.random().toString(16).slice(2, 10)
              ).toUpperCase();
              setCode(next);
            }}
            style={{
              background: "transparent",
              border: `1px solid ${UI.border}`,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              fontFamily: FONT_SANS,
              color: UI.textSoft,
            }}
          >
            Gerar
          </button>
          <button
            className="btn"
            onClick={() => {
              const txt = String(code || "").trim();
              if (!txt) return;
              try { navigator.clipboard.writeText(txt); } catch {}
            }}
            style={{
              background: "transparent",
              border: `1px solid ${UI.border}`,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              fontFamily: FONT_SANS,
              color: UI.textSoft,
            }}
          >
            Copiar
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Dia 0:</label>
          <input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{ ...inputStyle, width: 180, textAlign: "center" }}
          />
          <div style={{ display: "flex", gap: 10, marginLeft: "auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              className="btn"
              onClick={async () => {
                const txt = String(code || "").trim();
                if (!txt) return;
                if (!window.confirm("Isso vai APAGAR todos os dados deste código no Supabase. Continuar?")) return;
                try {
                  await clearWorkspaceData?.(txt);
                  applyWorkspaceCode(txt, "");
                  setValue("");
                  setDay0("");
                  onClose();
                } catch (err) {
                  alert(err?.message || "Não foi possível limpar os dados no Supabase.");
                }
              }}
              style={{
                background: "#c47b6a11",
                border: "1px solid #c47b6a33",
                borderRadius: 8,
                padding: "10px 16px",
                fontSize: 13,
                fontFamily: FONT_SANS,
                color: "#c47b6a",
              }}
            >
              Limpar ensaio
            </button>
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
                applyWorkspaceCode(code, value);
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

function MountingModal({ day0, mountings, onClose, onAdd }) {
  const [mountDate, setMountDate] = useState(day0 || "");
  const [trialId, setTrialId] = useState("principal");
  const preset = getTrialPreset(trialId, "vigor");
  const [rolosCount, setRolosCount] = useState(String(preset.rolosCount));
  const [seedsPerRolo, setSeedsPerRolo] = useState(String(preset.seedsPerRolo));
  const [label, setLabel] = useState("");

  useEffect(() => {
    const next = getTrialPreset(trialId, "vigor");
    setRolosCount(String(next.rolosCount));
    setSeedsPerRolo(String(next.seedsPerRolo));
  }, [trialId]);

  const canSave = Boolean(String(mountDate || "").trim());

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
        style={card({ maxWidth: 560, width: "100%", padding: 18 })}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: UI.text, fontFamily: FONT_SANS }}>
            Nova montagem de rolos
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
          Cada montagem representa um conjunto de rolos montados em uma data. As contagens (análises) ficam associadas à montagem selecionada.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Data da montagem:</label>
            <input
              type="date"
              value={mountDate}
              onChange={(e) => setMountDate(e.target.value)}
              style={{ ...inputStyle, width: "100%", textAlign: "center" }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Ensaio:</label>
            <select
              value={trialId}
              onChange={(e) => setTrialId(e.target.value)}
              style={{ ...inputStyle, width: "100%", textAlign: "left" }}
            >
              <option value="principal">Principal</option>
              <option value="sem_vermiculita">Sem vermiculita</option>
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Rolos:</label>
            <input
              value={rolosCount}
              onChange={(e) => setRolosCount(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder={String(preset.rolosCount)}
              style={{ ...inputStyle, width: "100%", textAlign: "center" }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Sementes/rolo:</label>
            <input
              value={seedsPerRolo}
              onChange={(e) => setSeedsPerRolo(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder={String(preset.seedsPerRolo)}
              style={{ ...inputStyle, width: "100%", textAlign: "center" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: UI.textSoft, fontFamily: FONT_SANS }}>Nome (opcional):</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={mountDate ? `Montagem ${formatPtBrDate(mountDate)}` : "Montagem"}
            style={{ ...inputStyle, flex: 1, minWidth: 220, textAlign: "left" }}
          />
        </div>

        {(mountings || []).length > 0 ? (
          <div style={{ marginTop: 12, borderTop: `1px solid ${UI.border}`, paddingTop: 10 }}>
            <div style={{ fontSize: 11, color: UI.textSoft, fontFamily: FONT_SANS, marginBottom: 8 }}>
              Montagens cadastradas:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 120, overflow: "auto" }}>
              {(mountings || []).map((m) => (
                <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, color: UI.text }}>
                  <span style={{ fontFamily: FONT_SANS, fontWeight: 600 }}>{m.label || m.id}</span>
                  <span style={{ color: UI.textSoft, fontFamily: FONT_SANS }}>{m.mountDate ? formatPtBrDate(m.mountDate) : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end", flexWrap: "wrap" }}>
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
            disabled={!canSave}
            onClick={() => {
              const id = generateMountingId();
              const d = String(mountDate || "").trim();
              const nRolos = Number(rolosCount);
              const nSeeds = Number(seedsPerRolo);
              const next = {
                id,
                mountDate: d,
                trialId,
                rolosCount: Number.isFinite(nRolos) && nRolos > 0 ? nRolos : preset.rolosCount,
                seedsPerRolo: Number.isFinite(nSeeds) && nSeeds > 0 ? nSeeds : preset.seedsPerRolo,
                label: String(label || "").trim() || (d ? `Montagem ${formatPtBrDate(d)}` : "Montagem"),
              };
              onAdd?.(next);
              onClose?.();
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
              opacity: canSave ? 1 : 0.6,
              cursor: canSave ? "pointer" : "not-allowed",
            }}
          >
            Salvar montagem
          </button>
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
