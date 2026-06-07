import type { Probe, ProbeRow } from "../types.js";
import { fnv1a } from "../hash.js";
import { rowFromCatalog } from "./util.js";

/** Screen / window geometry. */
export const screenProbe: Probe = {
  id: "screen",
  keys: ["screen.width", "screen.height", "screen.availWidth", "screen.availHeight", "screen.colorDepth", "screen.pixelDepth", "screen.orientation", "devicePixelRatio", "innerWidth", "outerWidth"],
  run(): ProbeRow[] {
    const s = screen;
    const rows: ProbeRow[] = [];
    rows.push(rowFromCatalog("screen.width", { surface: "screen WxH / avail", value: `${s.width}x${s.height}, avail ${s.availWidth}x${s.availHeight}`, present: true, signal: { name: "screen", value: `${s.width}x${s.height}` } }));
    rows.push(rowFromCatalog("screen.colorDepth", { surface: "colorDepth / pixelDepth", value: `${s.colorDepth} / ${s.pixelDepth}`, present: true, verdict: s.colorDepth < 24 ? "suspect" : "info", note: s.colorDepth < 24 ? "low color depth — VM tell" : undefined, signal: { name: "colorDepth", value: s.colorDepth } }));
    rows.push(rowFromCatalog("devicePixelRatio", { surface: "devicePixelRatio", value: String(devicePixelRatio), present: true, signal: { name: "dpr", value: devicePixelRatio } }));
    rows.push(rowFromCatalog("innerWidth", { surface: "inner / outer", value: `inner ${innerWidth}x${innerHeight}, outer ${outerWidth}x${outerHeight}`, present: true, verdict: outerWidth === 0 || outerHeight === 0 ? "bot" : "info", note: outerWidth === 0 ? "outer dimensions 0 — headless" : undefined, signal: { name: "outer", value: `${outerWidth}x${outerHeight}` } }));
    rows.push(rowFromCatalog("screen.orientation", { surface: "screen.orientation.type", value: s.orientation?.type ?? "(absent)", present: !!s.orientation }));
    for (const k of ["screen.height", "screen.availWidth", "screen.availHeight", "screen.pixelDepth", "outerWidth"]) rows.push(rowFromCatalog(k, { surface: k, value: "measured", present: true }));
    return rows;
  },
};

/** Intl / timezone / locale coherence inputs. */
export const intlProbe: Probe = {
  id: "intl",
  keys: ["Intl.DateTimeFormat", "*.resolvedOptions", "Intl.NumberFormat", "Intl.Locale", "*.getTimezoneOffset"],
  run(): ProbeRow[] {
    const rows: ProbeRow[] = [];
    const ro = Intl.DateTimeFormat().resolvedOptions();
    rows.push(rowFromCatalog("Intl.DateTimeFormat", { surface: "Intl timezone / locale / calendar", value: `${ro.timeZone} · ${ro.locale} · ${ro.calendar}/${ro.numberingSystem}`, present: true, signal: { name: "timezone", value: ro.timeZone } }));
    rows.push(rowFromCatalog("*.resolvedOptions", { surface: "resolvedOptions.locale", value: ro.locale, present: true, signal: { name: "intlLocale", value: ro.locale } }));
    const offset = new Date().getTimezoneOffset();
    rows.push(rowFromCatalog("*.getTimezoneOffset", { surface: "Date.getTimezoneOffset()", value: `${offset} min`, present: true, signal: { name: "tzOffset", value: offset } }));
    rows.push(rowFromCatalog("Intl.NumberFormat", { surface: "Intl.NumberFormat", value: new Intl.NumberFormat().format(1234567.89), present: true }));
    rows.push(rowFromCatalog("Intl.Locale", { surface: "Intl.Locale", value: typeof Intl.Locale !== "undefined" ? "present" : "absent", present: typeof Intl.Locale !== "undefined" }));
    return rows;
  },
};

/** Timing / clock-skew red pills. */
export const timingProbe: Probe = {
  id: "timing",
  keys: ["performance.now", "performance.timeOrigin", "Date.now", "*.measureUserAgentSpecificMemory"],
  run(): ProbeRow[] {
    const rows: ProbeRow[] = [];
    // performance.now resolution (clamped/jittered in some hardened browsers).
    let minDelta = Infinity;
    let last = performance.now();
    for (let i = 0; i < 5000; i++) {
      const t = performance.now();
      const d = t - last;
      if (d > 0 && d < minDelta) minDelta = d;
      last = t;
    }
    rows.push(rowFromCatalog("performance.now", { surface: "performance.now() resolution", value: `min Δ ${minDelta === Infinity ? "n/a" : minDelta.toFixed(5)}ms`, present: true, note: minDelta >= 0.1 ? "coarse timer — anti-timing hardening" : undefined, signal: { name: "perfResolution", value: Math.round(minDelta * 1e6) } }));
    const skew = Date.now() - (performance.timeOrigin + performance.now());
    rows.push(rowFromCatalog("performance.timeOrigin", { surface: "clock skew (Date.now vs timeOrigin+now)", value: `${skew.toFixed(2)}ms`, present: true, signal: { name: "clockSkew", value: Math.round(skew) } }));
    rows.push(rowFromCatalog("Date.now", { surface: "Date.now", value: String(Date.now()), present: true }));
    rows.push(rowFromCatalog("*.measureUserAgentSpecificMemory", { surface: "*.measureUserAgentSpecificMemory", value: "performance.measureUserAgentSpecificMemory" in performance ? "present" : "absent", present: "measureUserAgentSpecificMemory" in performance }));
    return rows;
  },
};

/** Math engine fingerprint (libm/ULP differences across platforms). */
export const mathProbe: Probe = {
  id: "math",
  keys: ["Math.acos", "Math.acosh", "Math.atanh", "Math.cosh", "Math.sinh", "Math.tanh", "Math.expm1", "Math.cbrt"],
  run(): ProbeRow[] {
    const vals = [
      Math.acos(0.123456789), Math.acosh(1.5), Math.atanh(0.5), Math.cosh(10),
      Math.sinh(2), Math.tanh(0.5), Math.expm1(1), Math.cbrt(100), Math.pow(Math.PI, -100),
    ];
    const sig = vals.map((v) => v.toExponential(15)).join("|");
    return [rowFromCatalog("Math.acos", { surface: "Math transcendental ULP fingerprint", value: `hash ${fnv1a(sig)}`, present: true, signal: { name: "mathHash", value: fnv1a(sig) } })];
  },
};

