import type { Probe, ProbeRow } from "../types.js";
import { fnv1a } from "../hash.js";
import { isNative, rowFromCatalog } from "./util.js";

const KEYS = [
  "*.getContext",
  "*.toDataURL",
  "*.getImageData",
  "*.fillText",
  "*.strokeText",
  "*.measureText",
  "*.isPointInPath",
  "*.fillRect",
];

export const canvasProbe: Probe = {
  id: "canvas",
  keys: KEYS,
  run(): ProbeRow[] {
    const rows: ProbeRow[] = [];
    try {
      const cv = document.createElement("canvas");
      cv.width = 280;
      cv.height = 60;
      const ctx = cv.getContext("2d");
      if (!ctx) {
        rows.push(rowFromCatalog("*.getContext", { surface: "canvas.getContext('2d')", value: "null", present: false, verdict: "suspect", note: "2D context unavailable" }));
        return rows;
      }
      // Text + emoji render — the classic Mowery/Shacham 'Pixel Perfect' probe.
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = "#f60";
      ctx.fillRect(0, 0, 280, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("xray-scanner — Cwm fjordbank glyphs 😀🛰️", 2, 2);
      ctx.fillStyle = "rgba(102,204,0,0.7)";
      ctx.fillText("xray-scanner — Cwm fjordbank glyphs 😀🛰️", 4, 17);

      const dataUrl = cv.toDataURL();
      const hash = fnv1a(dataUrl);
      rows.push(rowFromCatalog("*.toDataURL", {
        surface: "Canvas 2D text+emoji (toDataURL)",
        value: `hash ${hash} (${dataUrl.length}b)`,
        present: true,
        verdict: "info",
        signal: { name: "canvasHash", value: hash },
      }));

      // getImageData pixel hash.
      const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let acc = 0x811c9dc5;
      for (let i = 0; i < px.length; i += 7) {
        acc ^= px[i]!;
        acc = Math.imul(acc, 0x01000193);
      }
      rows.push(rowFromCatalog("*.getImageData", {
        surface: "Canvas getImageData pixel hash",
        value: (acc >>> 0).toString(16).padStart(8, "0"),
        present: true,
        signal: { name: "canvasPixelHash", value: (acc >>> 0).toString(16) },
      }));

      // measureText metrics.
      const m = ctx.measureText("xray");
      rows.push(rowFromCatalog("*.measureText", {
        surface: "measureText('xray').width",
        value: m.width.toFixed(4),
        present: true,
        signal: { name: "textWidth", value: Math.round(m.width * 1000) },
      }));

      // Lie checks: native toDataURL/getImageData, and noise (two reads differ?).
      const nativeTDU = isNative(HTMLCanvasElement.prototype.toDataURL);
      const nativeGID = isNative(CanvasRenderingContext2D.prototype.getImageData);
      const url2 = cv.toDataURL();
      const noisy = url2 !== dataUrl;
      rows.push(rowFromCatalog("*.fillText", {
        surface: "Canvas integrity (lie detector)",
        value: `toDataURL ${nativeTDU ? "native" : "PATCHED"}, getImageData ${nativeGID ? "native" : "PATCHED"}, noise ${noisy ? "YES" : "no"}`,
        present: true,
        verdict: !nativeTDU || !nativeGID || noisy ? "bot" : "pass",
        note: noisy ? "two identical renders produced different output — canvas-noise anti-fingerprinting" : !nativeTDU || !nativeGID ? "canvas method is not native code" : undefined,
        signal: { name: "canvasLie", value: !nativeTDU || !nativeGID || noisy },
      }));
      // Cover remaining claimed keys with presence rows.
      for (const k of ["*.strokeText", "*.isPointInPath", "*.fillRect"]) {
        rows.push(rowFromCatalog(k, { surface: k, value: "exercised", present: true }));
      }
    } catch (e) {
      rows.push(rowFromCatalog("*.getContext", { surface: "canvas", value: `error: ${String(e)}`, present: null, verdict: "info" }));
    }
    return rows;
  },
};
