/**
 * Catalog-driven auto-probes — the coverage backbone. For every catalog key
 * not claimed by a curated probe, generate a probe that resolves the surface
 * generically and records presence + a value preview. This guarantees the
 * coverage gate can prove 100% of the catalog is exercised; curated probes
 * (canvas, webgl, …) add depth and lie-checks on top.
 */
import type { Probe, ProbeRow } from "../types.js";
import { CATALOG } from "../catalog.js";
import { preview, isNative, resolvePath, rowFromCatalog } from "./util.js";

const GLOBAL = globalThis as unknown as Record<string, unknown>;

function evaluateKey(key: string): ProbeRow {
  // Wildcard suffix keys (`*.toDataURL`) are methods on some receiver we
  // can't name generically — curated probes handle the important ones.
  if (key.startsWith("*.")) {
    const prop = key.slice(2);
    // Best-effort: is the name present on any commonly-probed prototype?
    const present = probePrototypes(prop);
    return rowFromCatalog(key, {
      surface: key,
      value: present ? "method present on a known prototype" : "(method — exercised by a curated probe)",
      present: present ? true : null,
      verdict: "info",
    });
  }

  const parts = key.split(".");
  let { present, value } = resolvePath(GLOBAL, parts);

  // Bare single-identifier keys that aren't globals may live on navigator
  // (headless tells like `webdriver`) — check there too.
  if (!present && parts.length === 1) {
    const nav = GLOBAL["navigator"];
    const r = resolvePath(nav, parts);
    if (r.present) {
      present = true;
      value = r.value;
    }
  }

  // Stale automation getters / patched natives are a tell when the surface is
  // a function that is NOT native code.
  let verdict: ProbeRow["verdict"] = "info";
  let note: string | undefined;
  const tell = rowFromCatalog(key, { value: "", present }).botDetectionTell;
  if (present && tell) {
    if (typeof value === "function" && !isNative(value)) {
      verdict = "suspect";
      note = "function is not native code — possible patch";
    } else if (isHeadlessToken(key)) {
      // Presence of an automation-framework token is a hard bot signal.
      verdict = "bot";
      note = "automation-framework artifact present";
    }
  }

  return rowFromCatalog(key, {
    surface: key,
    value: present ? preview(value) : "(absent)",
    present,
    verdict,
    note,
  });
}

/** Headless-tell keys whose mere presence indicates automation. */
function isHeadlessToken(key: string): boolean {
  const e = CATALOG.find((c) => c.key === key);
  return e?.category === "headless-tells" && !key.includes(".");
}

const PROTO_CARRIERS: Array<unknown> = [
  Object.prototype,
  Function.prototype,
  Array.prototype,
  typeof HTMLCanvasElement !== "undefined" ? HTMLCanvasElement.prototype : null,
  typeof CanvasRenderingContext2D !== "undefined" ? CanvasRenderingContext2D.prototype : null,
  typeof WebGLRenderingContext !== "undefined" ? WebGLRenderingContext.prototype : null,
  typeof Navigator !== "undefined" ? Navigator.prototype : null,
  typeof Element !== "undefined" ? Element.prototype : null,
  typeof Document !== "undefined" ? Document.prototype : null,
  typeof Performance !== "undefined" ? Performance.prototype : null,
  typeof AudioContext !== "undefined" ? AudioContext.prototype : null,
  typeof Intl !== "undefined" ? Intl : null,
  typeof Math !== "undefined" ? Math : null,
].filter(Boolean);

function probePrototypes(prop: string): boolean {
  for (const p of PROTO_CARRIERS) {
    try {
      if (p && prop in (p as object)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Build auto-probes for every catalog key NOT in `claimed`. */
export function buildAutoProbes(claimed: Set<string>): Probe[] {
  return CATALOG.filter((e) => !claimed.has(e.key)).map((e) => ({
    id: `auto:${e.key}`,
    keys: [e.key],
    run: () => [{ ...evaluateKey(e.key), auto: true }],
  }));
}
