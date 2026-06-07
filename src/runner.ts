import type { ProbeRow } from "./types.js";
import { allProbes } from "./registry.js";
import { hashPairs, fnv1a } from "./hash.js";
import { layerForCategory } from "./layers.js";
import { entry } from "./catalog.js";
import { runCoherence, coherenceVerdict, type CoherenceCheck } from "./coherence.js";

export interface RunResult {
  rows: ProbeRow[];
  signals: Map<string, unknown>;
  /** Signals that are stable by design (volatile ones like clock skew removed). */
  stableSignals: Map<string, string>;
  coherence: CoherenceCheck[];
  coherenceScore: number;
  liesDetected: number;
  fingerprint: string;
  layerHashes: Record<string, string>;
  rowsByLayer: Map<string, ProbeRow[]>;
  beyondCatalog: ProbeRow[];
  stats: { probes: number; rows: number; bot: number; suspect: number };
  diagnostics: Diagnostics;
  categoryHashes: Record<string, string>;
}

/** Full fingerprint diagnostics: FP id, the lies/errors/trash triad,
 * the component hashes that compose the fingerprint, and the junk bins. */
export interface Diagnostics {
  fpId: string;
  /** A longer composite id (per-category hashes folded together). */
  fpIdLong: string;
  lies: number;
  errors: number;
  trash: number;
  lieList: Array<{ surface: string; note: string }>;
  errorList: Array<{ surface: string; value: string }>;
  trashList: Array<{ surface: string }>;
  /** The named signals that compose the fingerprint, each with its own hash. */
  components: Array<{ name: string; hash: string; value: string }>;
}

/**
 * Signals that legitimately change every run (timestamps, timer jitter) and
 * therefore must NOT count toward the deterministic fingerprint or the
 * reload-stability check — otherwise a real browser would look like it drifts.
 */
const VOLATILE_SIGNALS = new Set(["clockSkew", "perfResolution"]);

export async function runAll(): Promise<RunResult> {
  const probes = allProbes();
  const rows: ProbeRow[] = [];
  const signals = new Map<string, unknown>();

  // Run probes with isolation — one throwing probe never aborts the run.
  const settled = await Promise.allSettled(probes.map((p) => Promise.resolve().then(p.run)));
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i]!;
    if (s.status === "fulfilled") {
      for (const r of s.value) {
        rows.push(r);
        if (r.signal) signals.set(r.signal.name, r.signal.value);
      }
    } else {
      rows.push({
        key: probes[i]!.keys[0] ?? probes[i]!.id,
        surface: `probe ${probes[i]!.id}`,
        value: `error: ${String(s.reason)}`,
        present: null,
        severity: "info",
        botDetectionTell: false,
        layer: null,
        verdict: "info",
      });
    }
  }

  // Coherence layer.
  const coherence = runCoherence(signals);
  const cv = coherenceVerdict(coherence);

  // Bucket rows by IA layer.
  const rowsByLayer = new Map<string, ProbeRow[]>();
  const beyondCatalog: ProbeRow[] = [];
  for (const r of rows) {
    if (r.beyondCatalog) beyondCatalog.push(r);
    const cat = entry(r.key)?.category;
    const layer = r.beyondCatalog && r.key.startsWith("beyond:media") ? "browser-apis" : cat ? layerForCategory(cat) : "browser-apis";
    (rowsByLayer.get(layer) ?? rowsByLayer.set(layer, []).get(layer)!).push(r);
  }

  // Per-layer hashes (display detail — may include volatile rows).
  const layerHashes: Record<string, string> = {};
  for (const [layer, lrows] of rowsByLayer) {
    layerHashes[layer] = hashPairs(lrows.map((r) => ({ key: r.key + "#" + r.surface, value: r.value })));
  }

  // The deterministic fingerprint is computed over STABLE signals only, so it
  // persists across reloads for a genuine browser and changes only when a
  // surface is actually being randomized (a per-load-noise bot tell).
  const stableSignals = new Map<string, string>();
  for (const [name, value] of signals) {
    if (!VOLATILE_SIGNALS.has(name)) stableSignals.set(name, String(value));
  }
  const fingerprint = fnv1a(
    [...stableSignals.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n"),
  );

  const lieRows = rows.filter((r) => r.verdict === "bot").length;
  const suspectRows = rows.filter((r) => r.verdict === "suspect").length;

  // Per-category hashes — each catalog category gets its own digest, mirroring
  // a per-card hash. (beyond-catalog media rows fold into a synthetic category.)
  const rowsByCategory = new Map<string, ProbeRow[]>();
  for (const r of rows) {
    const cat = r.beyondCatalog && r.key.startsWith("beyond:media") ? "css-media" : entry(r.key)?.category ?? "other";
    (rowsByCategory.get(cat) ?? rowsByCategory.set(cat, []).get(cat)!).push(r);
  }
  const categoryHashes: Record<string, string> = {};
  for (const [cat, crows] of rowsByCategory) {
    categoryHashes[cat] = hashPairs(crows.map((r) => ({ key: r.key + "#" + r.surface, value: r.value })));
  }

  // The lies / errors / trash diagnostic triad.
  const lieList = rows.filter((r) => r.verdict === "bot").map((r) => ({ surface: r.surface, note: r.note ?? "lie detected" }));
  for (const c of coherence) if (c.ok === false) lieList.push({ surface: `coherence: ${c.name}`, note: c.detail });
  // errors = a probe threw; trash = a curated surface produced no usable value.
  // Auto-coverage probes (generic wildcard/optional-API placeholders) are
  // excluded so the triad reflects real measurement quality, not catalog breadth.
  const errorList = rows
    .filter((r) => r.value.startsWith("error:") || (r.present === null && !r.auto))
    .map((r) => ({ surface: r.surface, value: r.value }));
  const trashList = rows
    .filter((r) => !r.auto && (r.present === false || /\(unreadable\)/.test(r.value)))
    .map((r) => ({ surface: r.surface }));

  // Component breakdown: every stable signal that composes the fingerprint,
  // each with its own short hash (so individual components can be diffed).
  const components = [...stableSignals.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([name, value]) => ({ name, hash: fnv1a(value), value: value.length > 80 ? value.slice(0, 79) + "…" : value }));

  const fpIdLong = fnv1a(Object.entries(categoryHashes).sort().map(([k, v]) => `${k}:${v}`).join("|")) + fingerprint;

  const diagnostics: Diagnostics = {
    fpId: fingerprint,
    fpIdLong,
    lies: lieList.length,
    errors: errorList.length,
    trash: trashList.length,
    lieList,
    errorList,
    trashList,
    components,
  };

  return {
    rows,
    signals,
    stableSignals,
    coherence,
    coherenceScore: cv.score,
    liesDetected: cv.lies + lieRows,
    fingerprint,
    layerHashes,
    rowsByLayer,
    beyondCatalog,
    stats: { probes: probes.length, rows: rows.length, bot: lieRows, suspect: suspectRows },
    diagnostics,
    categoryHashes,
  };
}

/** The full result as a plain object (for JSON output / ?json mode). */
export function resultObject(r: RunResult): Record<string, unknown> {
  return {
    fingerprint: r.fingerprint,
    fpIdLong: r.diagnostics.fpIdLong,
    coherenceScore: r.coherenceScore,
    diagnostics: {
      lies: r.diagnostics.lies,
      errors: r.diagnostics.errors,
      trash: r.diagnostics.trash,
      components: r.diagnostics.components,
      lieList: r.diagnostics.lieList,
      errorList: r.diagnostics.errorList,
    },
    categoryHashes: r.categoryHashes,
    layerHashes: r.layerHashes,
    coherence: r.coherence.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
    stats: r.stats,
    rows: r.rows.map((row) => ({
      key: row.key,
      surface: row.surface,
      value: row.value,
      present: row.present,
      severity: row.severity,
      botDetectionTell: row.botDetectionTell,
      layer: row.layer,
      verdict: row.verdict,
      category: entry(row.key)?.category ?? null,
      beyondCatalog: row.beyondCatalog ?? false,
      ...(row.note ? { note: row.note } : {}),
    })),
  };
}

/** The deterministic, copy-pasteable result blob. */
export function resultJson(r: RunResult): string {
  return JSON.stringify(
    {
      fingerprint: r.fingerprint,
      fpIdLong: r.diagnostics.fpIdLong,
      coherenceScore: r.coherenceScore,
      diagnostics: {
        lies: r.diagnostics.lies,
        errors: r.diagnostics.errors,
        trash: r.diagnostics.trash,
        components: r.diagnostics.components,
        lieList: r.diagnostics.lieList,
        errorList: r.diagnostics.errorList,
      },
      categoryHashes: r.categoryHashes,
      liesDetected: r.liesDetected,
      layerHashes: r.layerHashes,
      stats: r.stats,
      coherence: r.coherence.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
      rows: r.rows.map((row) => ({
        key: row.key,
        surface: row.surface,
        value: row.value,
        present: row.present,
        severity: row.severity,
        botDetectionTell: row.botDetectionTell,
        layer: row.layer,
        verdict: row.verdict,
        beyondCatalog: row.beyondCatalog ?? false,
        ...(row.note ? { note: row.note } : {}),
      })),
    },
    null,
    2,
  );
}
