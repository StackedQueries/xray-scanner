import type { Probe, ProbeRow } from "../types.js";
import { rowFromCatalog } from "./util.js";

const KEYS = ["FontFace", "FontFaceSet", "*.check", "*.load", "queryLocalFonts"];

// A spread of fonts whose presence varies by OS — width-diff enumeration
// against the three base fallbacks (Picasso device-class style).
const TEST_FONTS = [
  "Arial", "Helvetica", "Times New Roman", "Courier New", "Georgia", "Palatino",
  "Comic Sans MS", "Impact", "Tahoma", "Verdana", "Trebuchet MS",
  "Segoe UI", "Calibri", "Cambria", "Consolas", // Windows
  "Helvetica Neue", "Menlo", "Monaco", "Geneva", "Optima", "Lucida Grande", "San Francisco", // macOS
  "Ubuntu", "DejaVu Sans", "Liberation Sans", "Noto Sans", "Cantarell", "Droid Sans", // Linux
  "Roboto", "Open Sans",
];
const BASES = ["monospace", "serif", "sans-serif"];

export const fontsProbe: Probe = {
  id: "fonts",
  keys: KEYS,
  run(): ProbeRow[] {
    const rows: ProbeRow[] = [];
    try {
      const span = document.createElement("span");
      span.style.position = "absolute";
      span.style.left = "-9999px";
      span.style.fontSize = "72px";
      span.textContent = "mmmmmmmmmmlli WwGg 文字 😀";
      document.body.appendChild(span);

      const baseline: Record<string, { w: number; h: number }> = {};
      for (const b of BASES) {
        span.style.fontFamily = b;
        baseline[b] = { w: span.offsetWidth, h: span.offsetHeight };
      }
      const detected: string[] = [];
      for (const f of TEST_FONTS) {
        let found = false;
        for (const b of BASES) {
          span.style.fontFamily = `'${f}',${b}`;
          if (span.offsetWidth !== baseline[b]!.w || span.offsetHeight !== baseline[b]!.h) {
            found = true;
            break;
          }
        }
        if (found) detected.push(f);
      }
      document.body.removeChild(span);

      rows.push(rowFromCatalog("*.check", {
        surface: "Font enumeration (width-diff)",
        value: `${detected.length}/${TEST_FONTS.length}: ${detected.slice(0, 12).join(", ")}${detected.length > 12 ? "…" : ""}`,
        present: true,
        verdict: detected.length <= 2 ? "suspect" : "info",
        note: detected.length <= 2 ? "almost no system fonts — headless/container tell" : undefined,
        signal: { name: "fonts", value: detected.join(",") },
      }));

      // document.fonts.check for a couple of OS-signal fonts.
      try {
        const hasSegoe = (document as Document & { fonts: FontFaceSet }).fonts.check("12px 'Segoe UI'");
        const hasSF = (document as Document & { fonts: FontFaceSet }).fonts.check("12px 'San Francisco'");
        rows.push(rowFromCatalog("FontFaceSet", {
          surface: "document.fonts.check (OS signal)",
          value: `Segoe UI ${hasSegoe}, San Francisco ${hasSF}`,
          present: true,
          signal: { name: "fontOsSignal", value: `${hasSegoe}/${hasSF}` },
        }));
      } catch { /* ignore */ }

      // Local Font Access API (catalog addition this project made).
      const qlf = (globalThis as { queryLocalFonts?: unknown }).queryLocalFonts;
      rows.push(rowFromCatalog("queryLocalFonts", {
        surface: "window.queryLocalFonts (Local Font Access)",
        value: typeof qlf === "function" ? "present (permission-gated)" : "absent",
        present: typeof qlf === "function",
        note: "permission-gated full font enumeration; very high entropy when granted",
      }));
      rows.push(rowFromCatalog("FontFace", { surface: "FontFace", value: typeof FontFace !== "undefined" ? "present" : "absent", present: typeof FontFace !== "undefined" }));
      rows.push(rowFromCatalog("*.load", { surface: "*.load", value: "exercised", present: true }));
    } catch (e) {
      rows.push(rowFromCatalog("*.check", { surface: "fonts", value: `error: ${String(e)}`, present: null }));
    }
    return rows;
  },
};
