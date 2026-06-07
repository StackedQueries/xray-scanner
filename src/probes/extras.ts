import type { Probe, ProbeRow } from "../types.js";
import { fnv1a } from "../hash.js";
import { rowFromCatalog } from "./util.js";

/** Engine/version fingerprint from the global namespace (window key list). */
export const featuresProbe: Probe = {
  id: "features",
  keys: [],
  run(): ProbeRow[] {
    const keys = Object.getOwnPropertyNames(window).sort();
    const ctors = keys.filter((k) => /^[A-Z]/.test(k));
    return [
      {
        key: "beyond:features:window-keys",
        surface: "Global namespace (window keys → engine version)",
        value: `${keys.length} keys, ${ctors.length} constructors, hash ${fnv1a(keys.join(","))}`,
        present: true,
        severity: "medium",
        botDetectionTell: false,
        layer: "L1a",
        verdict: "info",
        beyondCatalog: true,
        note: "the set of exposed globals pins the exact engine build — a UA claiming a version whose feature set doesn't match is a tell",
        signal: { name: "windowKeysHash", value: fnv1a(keys.join(",")) },
      },
      {
        key: "beyond:features:ctor-hash",
        surface: "Constructor name set",
        value: `hash ${fnv1a(ctors.join(","))}`,
        present: true,
        severity: "low",
        botDetectionTell: false,
        layer: "L1a",
        verdict: "info",
        beyondCatalog: true,
        signal: { name: "ctorSetHash", value: fnv1a(ctors.join(",")) },
      },
    ];
  },
};

/** DOMRect sub-pixel geometry fingerprint (font/zoom/engine dependent). */
export const domrectProbe: Probe = {
  id: "domrect",
  keys: ["*.getBoundingClientRect", "*.getClientRects", "*.elementFromPoint"],
  run(): ProbeRow[] {
    const rows: ProbeRow[] = [];
    try {
      const d = document.createElement("div");
      d.style.cssText = "position:absolute;left:-9999px;font:30px/1 'Times New Roman';transform:rotate(3deg) scale(1.0001);width:auto;";
      d.textContent = "xray Wgq文字😀";
      document.body.appendChild(d);
      const r = d.getBoundingClientRect();
      const sig = [r.x, r.y, r.width, r.height, r.top, r.right, r.bottom, r.left].map((n) => n.toFixed(4)).join("|");
      document.body.removeChild(d);
      rows.push(rowFromCatalog("*.getBoundingClientRect", {
        surface: "DOMRect sub-pixel geometry",
        value: `hash ${fnv1a(sig)} (w${r.width.toFixed(2)} h${r.height.toFixed(2)})`,
        present: true,
        signal: { name: "domRectHash", value: fnv1a(sig) },
      }));
      rows.push(rowFromCatalog("*.getClientRects", { surface: "*.getClientRects", value: "exercised", present: true }));
      rows.push(rowFromCatalog("*.elementFromPoint", { surface: "document.elementFromPoint", value: typeof document.elementFromPoint === "function" ? "present" : "absent", present: typeof document.elementFromPoint === "function" }));
    } catch (e) {
      rows.push(rowFromCatalog("*.getBoundingClientRect", { surface: "DOMRect", value: `error: ${String(e)}`, present: null }));
    }
    return rows;
  },
};

/** Speech synthesis voice list — strong OS/locale fingerprint. */
export const speechProbe: Probe = {
  id: "speech",
  keys: ["speechSynthesis", "speechSynthesis.getVoices", "*.getVoices"],
  async run(): Promise<ProbeRow[]> {
    const rows: ProbeRow[] = [];
    const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    if (!synth) {
      rows.push(rowFromCatalog("speechSynthesis", { surface: "speechSynthesis", value: "absent", present: false, verdict: "suspect", note: "no speechSynthesis — headless tell" }));
      return rows;
    }
    let voices = synth.getVoices();
    if (voices.length === 0) {
      voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const to = setTimeout(() => resolve(synth.getVoices()), 600);
        synth.onvoiceschanged = () => {
          clearTimeout(to);
          resolve(synth.getVoices());
        };
      });
    }
    const names = voices.map((v) => `${v.name}|${v.lang}${v.default ? "|def" : ""}`).sort();
    const langs = [...new Set(voices.map((v) => v.lang))].sort();
    rows.push(rowFromCatalog("speechSynthesis.getVoices", {
      surface: "Speech voices",
      value: `${voices.length} voices, ${langs.length} langs, hash ${fnv1a(names.join(","))}`,
      present: true,
      verdict: voices.length === 0 ? "suspect" : "info",
      note: voices.length === 0 ? "no voices — common in headless/Linux containers" : undefined,
      signal: { name: "speechVoices", value: fnv1a(names.join(",")) },
    }));
    return rows;
  },
};

/** Battery status (level/charging) — present on Chromium, removed elsewhere. */
export const batteryProbe: Probe = {
  id: "battery",
  keys: ["navigator.getBattery"],
  async run(): Promise<ProbeRow[]> {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; chargingTime: number; dischargingTime: number }> }).getBattery;
    if (typeof getBattery !== "function") {
      return [rowFromCatalog("navigator.getBattery", { surface: "navigator.getBattery", value: "absent", present: false, note: "Battery API absent (Firefox/Safari removed it; presence implies Chromium)" })];
    }
    try {
      const b = await getBattery.call(navigator);
      return [rowFromCatalog("navigator.getBattery", {
        surface: "Battery status",
        value: `level ${b.level}, charging ${b.charging}, chargingTime ${b.chargingTime}, dischargingTime ${b.dischargingTime}`,
        present: true,
        verdict: b.level === 1 && b.charging === true && b.dischargingTime === Infinity ? "suspect" : "info",
        note: b.charging && b.level === 1 && b.dischargingTime === Infinity ? "level 1 / charging / Infinity discharge — common VM/headless default" : undefined,
        signal: { name: "battery", value: `${b.level}/${b.charging}` },
      })];
    } catch (e) {
      return [rowFromCatalog("navigator.getBattery", { surface: "navigator.getBattery", value: `error: ${String(e)}`, present: null })];
    }
  },
};

/** Error message / stack-trace format — differs across JS engines. */
export const errorEngineProbe: Probe = {
  id: "error-engine",
  keys: ["*.stack", "Error.captureStackTrace"],
  run(): ProbeRow[] {
    const samples: string[] = [];
    try { (null as unknown as { x: number }).x; } catch (e) { samples.push((e as Error).message); }
    try { (undefined as unknown as () => void)(); } catch (e) { samples.push((e as Error).message); }
    try { JSON.parse("{"); } catch (e) { samples.push((e as Error).message); }
    try { decodeURIComponent("%"); } catch (e) { samples.push((e as Error).message); }
    const hasCapture = typeof (Error as unknown as { captureStackTrace?: unknown }).captureStackTrace === "function";
    let stackShape = "";
    try { throw new Error("x"); } catch (e) { stackShape = ((e as Error).stack || "").split("\n")[1]?.trim().slice(0, 40) ?? ""; }
    return [
      rowFromCatalog("*.stack", {
        surface: "Error messages / engine signature",
        value: `hash ${fnv1a(samples.join("¦"))} · capture:${hasCapture ? "yes(V8)" : "no"}`,
        present: true,
        signal: { name: "errorEngine", value: fnv1a(samples.join("¦")) },
        note: hasCapture ? "Error.captureStackTrace present → V8 (Chromium/Node)" : undefined,
      }),
      rowFromCatalog("Error.captureStackTrace", { surface: "Error.captureStackTrace (V8)", value: hasCapture ? `present · stack[1]="${stackShape}"` : "absent", present: hasCapture }),
    ];
  },
};

/** getComputedStyle key count + a stable property digest. */
export const computedStyleProbe: Probe = {
  id: "computed-style",
  keys: ["getComputedStyle", "*.getComputedStyle", "*.getPropertyValue"],
  run(): ProbeRow[] {
    try {
      const cs = getComputedStyle(document.documentElement);
      const len = cs.length;
      const sample = ["color", "font-family", "-webkit-text-stroke", "accent-color", "appearance", "scrollbar-color"].map((p) => cs.getPropertyValue(p)).join("|");
      return [
        rowFromCatalog("getComputedStyle", {
          surface: "getComputedStyle key count + digest",
          value: `${len} properties, hash ${fnv1a(sample)}`,
          present: true,
          note: "the number of computed-style keys pins the engine version",
          signal: { name: "computedStyleKeys", value: String(len) },
        }),
        rowFromCatalog("*.getPropertyValue", { surface: "*.getPropertyValue", value: "exercised", present: true }),
      ];
    } catch (e) {
      return [rowFromCatalog("getComputedStyle", { surface: "getComputedStyle", value: `error: ${String(e)}`, present: null })];
    }
  },
};
