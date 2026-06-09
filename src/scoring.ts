import type { DefenseLayer, ProbeRow, Severity } from "./types.js";
import { entry } from "./catalog.js";
import { layerForCategory } from "./layers.js";

/**
 * Bump whenever the shape of ScoreResult or the meaning of stealthScore
 * changes. The benchmark harness pins this and refuses to score against a
 * deployed xray whose version differs (see SPEC §4.3 version guard).
 */
export const SCORE_SCHEMA_VERSION = "1.0.0";

/**
 * Tunable scoring weights. Centralised so the model can be calibrated without
 * touching logic. Calibration anchors (SPEC §10.1): a clean real-browser run
 * scores >= 90; a vanilla automation run trips a hard-fail and scores <= cap.
 */
export const SCORING_CONFIG = {
  /** verdict → base weight. info/pass contribute nothing. */
  base: { bot: 1.0, suspect: 0.4, pass: 0, info: 0 } as Record<string, number>,
  /** severity multiplier. */
  severity: { info: 0.25, low: 0.5, medium: 1.0, high: 1.5 } as Record<Severity, number>,
  /** extra multiplier when the surface is a catalog-flagged bot-detection tell. */
  tellMultiplier: 1.5,
  /** coherence penalty weight: (100 - coherenceScore)/100 * Wc. */
  Wc: 25,
  /** saturating-normalisation constant: norm = raw / (raw + K). */
  K: 14,
  /** any hard-fail caps the stealth score at this value. */
  hardCap: 15,
};

export interface ScoreLeak {
  key: string;
  category: string | null;
  verdict: "bot" | "suspect";
  severity: Severity;
  botDetectionTell: boolean;
  layer: DefenseLayer | null;
}

export interface ScoreResult {
  scoreSchemaVersion: string;
  /** 0..100, higher = stealthier (harder to detect). */
  stealthScore: number;
  /** raw graded detectability sum (pre-normalisation), for debugging/calibration. */
  detectabilityRaw: number;
  /** the coherence component folded into the raw sum. */
  coherencePenalty: number;
  /** representative catalog keys whose hard-fail tripped the cap (empty = no cap). */
  hardFails: string[];
  /** fraction (0..100) of stable signals identical across reloads; null on a single run. */
  stabilityScore: number | null;
  /** per-IA-layer detectability contribution. */
  byLayer: Record<string, number>;
  /** per-catalog-category detectability contribution. */
  byCategory: Record<string, number>;
  /** the surfaces this run fails — the tool's side of the bypass-matrix join (SPEC §6). */
  leaks: ScoreLeak[];
}

/** Structural subset of RunResult that scoring needs (so fixtures stay light). */
export interface ScoreInput {
  rows: Array<Pick<ProbeRow, "key" | "verdict" | "severity" | "botDetectionTell" | "layer">>;
  coherenceScore: number;
  signals: Map<string, unknown>;
}

/**
 * Hard-fail surfaces: near-instant automation tells. Any one of these tripping
 * caps the stealth score regardless of how clean everything else is. Keyed on
 * the signal a probe emits (robust to UI wording changes), each mapped to a
 * representative catalog key for reporting.
 */
type HardFail = { signal: string; key: string; trips: (v: unknown, signals: Map<string, unknown>) => boolean };
const HARD_FAILS: HardFail[] = [
  { signal: "webdriver", key: "navigator.webdriver", trips: (v) => v === true },
  { signal: "webdriverGetterPatched", key: "navigator.__proto__.webdriver", trips: (v) => v === true },
  { signal: "getEventListeners", key: "getEventListeners", trips: (v) => v === true },
  { signal: "toStringPatched", key: "Function.prototype.toString", trips: (v) => v === true },
  {
    signal: "automationResidue",
    key: "webdriver",
    trips: (v) => typeof v === "string" && v.length > 0,
  },
  {
    // Chrome UA but window.chrome absent → headless tell.
    signal: "chromePresent",
    key: "window.chrome",
    trips: (v, signals) => v === false && /Chrome\//.test(String(signals.get("ua") ?? "")) && !/Edg|OPR/.test(String(signals.get("ua") ?? "")),
  },
];

function categoryOf(key: string): string | null {
  return entry(key)?.category ?? null;
}

function layerOf(row: ScoreInput["rows"][number]): string {
  if (row.layer) return row.layer;
  const cat = categoryOf(row.key);
  return cat ? layerForCategory(cat) : "other";
}

/**
 * Compute the stealth/detectability score from a completed run.
 * @param input  a RunResult (or structural subset).
 * @param stabilityScore  optional 0..100 reload-stability fraction (null if single run).
 */
export function score(input: ScoreInput, stabilityScore: number | null = null): ScoreResult {
  const cfg = SCORING_CONFIG;
  let detectabilityRaw = 0;
  const byLayer: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const leaks: ScoreLeak[] = [];

  for (const r of input.rows) {
    const base = cfg.base[r.verdict] ?? 0;
    if (base === 0) continue; // only bot/suspect rows contribute
    const sev = cfg.severity[r.severity] ?? 1;
    const tell = r.botDetectionTell ? cfg.tellMultiplier : 1;
    const w = base * sev * tell;
    detectabilityRaw += w;

    const layer = layerOf(r);
    byLayer[layer] = (byLayer[layer] ?? 0) + w;
    const cat = categoryOf(r.key) ?? "other";
    byCategory[cat] = (byCategory[cat] ?? 0) + w;

    leaks.push({
      key: r.key,
      category: categoryOf(r.key),
      verdict: r.verdict as "bot" | "suspect",
      severity: r.severity,
      botDetectionTell: r.botDetectionTell,
      layer: r.layer,
    });
  }

  // Hard-fails (from signals, not row wording).
  const hardFails: string[] = [];
  for (const hf of HARD_FAILS) {
    if (input.signals.has(hf.signal) && hf.trips(input.signals.get(hf.signal), input.signals)) {
      if (!hardFails.includes(hf.key)) hardFails.push(hf.key);
    }
  }

  const coherencePenalty = ((100 - input.coherenceScore) / 100) * cfg.Wc;
  const raw = detectabilityRaw + coherencePenalty;
  const norm = raw / (raw + cfg.K); // saturating 0..1
  let stealthScore = Math.round((1 - norm) * 100);
  if (hardFails.length > 0) stealthScore = Math.min(stealthScore, cfg.hardCap);
  stealthScore = Math.max(0, Math.min(100, stealthScore));

  return {
    scoreSchemaVersion: SCORE_SCHEMA_VERSION,
    stealthScore,
    detectabilityRaw: Math.round(detectabilityRaw * 1000) / 1000,
    coherencePenalty: Math.round(coherencePenalty * 1000) / 1000,
    hardFails,
    stabilityScore,
    byLayer,
    byCategory,
    leaks: leaks.sort((a, b) => (a.verdict === b.verdict ? a.key.localeCompare(b.key) : a.verdict === "bot" ? -1 : 1)),
  };
}

/** Derive a 0..100 reload-stability fraction from a stability report, or null if not meaningful. */
export function stabilityScoreFrom(report: { meaningful: boolean; rows: { stable: boolean }[]; driftCount: number } | null | undefined): number | null {
  if (!report || !report.meaningful || report.rows.length === 0) return null;
  return Math.round(((report.rows.length - report.driftCount) / report.rows.length) * 100);
}
