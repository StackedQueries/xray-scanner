import type { ProbeRow, Verdict } from "../types.js";
import { entry } from "../catalog.js";

/** Safe, truncated preview of an arbitrary value for the monospace column. */
export function preview(v: unknown, max = 120): string {
  try {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    const t = typeof v;
    if (t === "function") {
      const name = (v as { name?: string }).name || "anonymous";
      const native = Function.prototype.toString.call(v as () => void).includes("[native code]");
      return `ƒ ${name}${native ? "" : " {patched?}"}`;
    }
    if (t === "string") return truncate(JSON.stringify(v), max);
    if (t === "number" || t === "boolean" || t === "bigint" || t === "symbol") return truncate(String(v as object), max);
    if (Array.isArray(v)) return truncate(`[${v.map((x) => shallow(x)).join(", ")}]`, max);
    if (t === "object") {
      const ctor = (v as object).constructor?.name;
      if (ctor && ctor !== "Object") return truncate(`${ctor} ${safeJson(v)}`, max);
      return truncate(safeJson(v), max);
    }
    return truncate(String(v), max);
  } catch {
    return "(unreadable)";
  }
}

function shallow(x: unknown): string {
  const t = typeof x;
  if (t === "object" && x !== null) return (x as object).constructor?.name ?? "object";
  if (t === "string") return JSON.stringify(x);
  return String(x);
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "[object]";
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Is a function the genuine native implementation (not a JS-land patch)? */
export function isNative(fn: unknown): boolean {
  if (typeof fn !== "function") return false;
  try {
    return /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(fn as () => void));
  } catch {
    return true;
  }
}

/** Resolve a dot-path from a root object without throwing. */
export function resolvePath(root: unknown, path: string[]): { present: boolean; value: unknown } {
  let cur: unknown = root;
  for (const p of path) {
    if (cur == null) return { present: false, value: undefined };
    try {
      if (!(p in Object(cur))) return { present: false, value: undefined };
      cur = (cur as Record<string, unknown>)[p];
    } catch {
      return { present: false, value: undefined };
    }
  }
  return { present: true, value: cur };
}

/** Build a ProbeRow that inherits severity/layer/tell from the catalog entry. */
export function rowFromCatalog(
  key: string,
  fields: { surface?: string; value: string; present: boolean | null; verdict?: Verdict; note?: string; signal?: ProbeRow["signal"] },
): ProbeRow {
  const e = entry(key);
  return {
    key,
    surface: fields.surface ?? key,
    value: fields.value,
    present: fields.present,
    severity: e?.severity ?? "info",
    botDetectionTell: e?.botDetectionTell ?? false,
    layer: e?.layer ?? null,
    verdict: fields.verdict ?? "info",
    note: fields.note,
    signal: fields.signal,
  };
}
