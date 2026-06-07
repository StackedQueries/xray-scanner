/**
 * Reload / reconnection fingerprint-stability tooling.
 *
 * A genuine browser produces the SAME fingerprint on every reload, in a new
 * tab, and after a reconnect. A bot that injects per-load canvas/audio/WebGL
 * noise to dodge static fingerprinting produces a DIFFERENT value each time —
 * which is itself the tell. This module persists a baseline in localStorage
 * and reports, per surface, whether the value is stable or drifting across
 * reloads (cross-tab and cross-reconnect too, since localStorage is shared).
 */

const STORAGE_KEY = "xray:stability:v1";
const MAX_DISTINCT = 8;
const MAX_FPS = 16;

interface SignalRecord {
  last: string;
  distinct: string[];
  changes: number;
}
interface History {
  firstSeen: string;
  runs: number;
  fingerprints: string[];
  signals: Record<string, SignalRecord>;
}

export interface StabilitySignalRow {
  name: string;
  current: string;
  distinctCount: number;
  stable: boolean;
  values: string[];
}
export interface StabilityReport {
  available: boolean; // localStorage usable
  runs: number;
  sessionRuns: number;
  firstSeen: string;
  fingerprint: string;
  distinctFingerprints: number;
  fingerprintStable: boolean;
  meaningful: boolean; // >= 2 runs, so "stable" actually means something
  newBaseline: boolean;
  rows: StabilitySignalRow[];
  driftCount: number;
}

/** High-value fingerprint signals always shown in the stability table. */
const DISPLAY_SIGNALS = [
  "canvasHash",
  "canvasPixelHash",
  "textWidth",
  "webglRenderer",
  "webglParamHash",
  "webglExtHash",
  "audioHash",
  "fonts",
  "mathHash",
  "rtcCodecs",
];

let sessionRuns = 0;

function load(): History | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as History;
  } catch {
    return null;
  }
}

function save(h: History): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(h));
    return true;
  } catch {
    return false;
  }
}

export function resetHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  sessionRuns = 0;
}

/** Record a run and return the stability report comparing against the baseline. */
export function recordRun(fingerprint: string, stableSignals: Map<string, string>): StabilityReport {
  sessionRuns++;
  let h = load();
  const newBaseline = h === null;
  if (!h) {
    h = { firstSeen: new Date().toISOString(), runs: 0, fingerprints: [], signals: {} };
  }
  h.runs++;
  if (!h.fingerprints.includes(fingerprint)) {
    h.fingerprints.push(fingerprint);
    if (h.fingerprints.length > MAX_FPS) h.fingerprints.shift();
  }
  for (const [name, value] of stableSignals) {
    const str = value;
    const rec = h.signals[name];
    if (!rec) {
      h.signals[name] = { last: str, distinct: [str], changes: 0 };
    } else if (rec.last !== str) {
      rec.changes++;
      rec.last = str;
      if (!rec.distinct.includes(str)) {
        rec.distinct.push(str);
        if (rec.distinct.length > MAX_DISTINCT) rec.distinct.shift();
      }
    }
  }
  const available = save(h);

  // Build the report rows: the display set ∪ any drifted signal.
  const names = new Set<string>(DISPLAY_SIGNALS);
  for (const [name, rec] of Object.entries(h.signals)) if (rec.distinct.length > 1) names.add(name);

  const rows: StabilitySignalRow[] = [];
  for (const name of names) {
    const rec = h.signals[name];
    if (!rec) continue;
    rows.push({
      name,
      current: stableSignals.get(name) ?? rec.last,
      distinctCount: rec.distinct.length,
      stable: rec.distinct.length <= 1,
      values: rec.distinct,
    });
  }
  rows.sort((a, b) => Number(a.stable) - Number(b.stable) || a.name.localeCompare(b.name));

  const distinctFingerprints = h.fingerprints.length;
  return {
    available,
    runs: h.runs,
    sessionRuns,
    firstSeen: h.firstSeen,
    fingerprint,
    distinctFingerprints,
    fingerprintStable: distinctFingerprints === 1,
    meaningful: h.runs >= 2,
    newBaseline,
    rows,
    driftCount: rows.filter((r) => !r.stable).length,
  };
}
