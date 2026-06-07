import type { Probe, ProbeRow } from "../types.js";
import { rowFromCatalog } from "./util.js";

/**
 * CSS media-feature probes. These query high-entropy display / OS / a11y
 * state through `matchMedia(...)`. The `matchMedia` API itself IS catalogued
 * (dom-layout), but the individual media-FEATURE values are not — the
 * catalog is API-granular, not query-argument-granular. So the per-feature
 * rows are flagged `beyondCatalog` (see README "Beyond-catalog probes").
 */
const FEATURES: Array<{ q: string; label: string; signal: string }> = [
  { q: "(prefers-color-scheme: dark)", label: "prefers-color-scheme: dark", signal: "colorScheme" },
  { q: "(prefers-reduced-motion: reduce)", label: "prefers-reduced-motion", signal: "reducedMotion" },
  { q: "(prefers-contrast: more)", label: "prefers-contrast: more", signal: "contrast" },
  { q: "(forced-colors: active)", label: "forced-colors", signal: "forcedColors" },
  { q: "(inverted-colors: inverted)", label: "inverted-colors", signal: "invertedColors" },
  { q: "(dynamic-range: high)", label: "dynamic-range: high", signal: "dynamicRange" },
  { q: "(color-gamut: p3)", label: "color-gamut: p3", signal: "colorGamut" },
  { q: "(any-pointer: fine)", label: "any-pointer: fine", signal: "anyPointer" },
  { q: "(any-hover: hover)", label: "any-hover: hover", signal: "anyHover" },
  { q: "(pointer: coarse)", label: "pointer: coarse", signal: "pointer" },
  { q: "(hover: hover)", label: "hover: hover", signal: "hover" },
  { q: "(update: fast)", label: "update: fast", signal: "update" },
];

export const cssMediaProbe: Probe = {
  id: "cssmedia",
  keys: ["matchMedia"], // the API is catalogued; feature values are beyond-catalog
  run(): ProbeRow[] {
    const rows: ProbeRow[] = [];
    rows.push(rowFromCatalog("matchMedia", { surface: "window.matchMedia", value: typeof matchMedia === "function" ? "present" : "absent", present: typeof matchMedia === "function" }));
    for (const f of FEATURES) {
      let matches: boolean | null = null;
      try { matches = matchMedia(f.q).matches; } catch { matches = null; }
      rows.push({
        key: `beyond:media:${f.signal}`,
        surface: `@media ${f.label}`,
        value: String(matches),
        present: matches !== null,
        severity: "low",
        botDetectionTell: false,
        layer: "L1a",
        verdict: "info",
        beyondCatalog: true,
        note: "media-feature value not separately catalogued (matchMedia API is)",
        signal: { name: f.signal, value: matches },
      });
    }
    // Pointer/hover coherence vs touch is checked in the coherence engine.
    return rows;
  },
};
