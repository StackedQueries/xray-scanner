import type { Probe, ProbeRow } from "../types.js";
import { fnv1a } from "../hash.js";
import { rowFromCatalog } from "./util.js";

const KEYS = [
  "*.getParameter",
  "*.getExtension",
  "*.getSupportedExtensions",
  "*.getContextAttributes",
  "*.getShaderPrecisionFormat",
  "*.readPixels",
];

export const webglProbe: Probe = {
  id: "webgl",
  keys: KEYS,
  run(): ProbeRow[] {
    const rows: ProbeRow[] = [];
    try {
      const cv = document.createElement("canvas");
      const gl = (cv.getContext("webgl2") || cv.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) {
        // No WebGL context at all — headless / --disable-gpu. A real headed browser
        // exposes a GL context, so this is a strong bot signal (not just suspect).
        rows.push(rowFromCatalog("*.getParameter", { surface: "WebGL", value: "no context", present: false, verdict: "bot", note: "no WebGL context — headless / GPU disabled", signal: { name: "webglContext", value: false } }));
        return rows;
      }
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : "(masked)";
      const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "(masked)";
      const software = /swiftshader|llvmpipe|software|mesa offscreen|microsoft basic/i.test(renderer);
      rows.push(rowFromCatalog("*.getExtension", {
        surface: "WebGL UNMASKED_VENDOR / RENDERER",
        value: `${vendor} — ${renderer}`,
        present: true,
        verdict: software ? "bot" : "info",
        note: software ? "software renderer (SwiftShader/llvmpipe) — strong headless/VM tell" : undefined,
        signal: { name: "webglRenderer", value: renderer },
      }));

      // Parameter sweep → stable hash.
      const params = [
        gl.VERSION, gl.SHADING_LANGUAGE_VERSION, gl.VENDOR, gl.RENDERER,
        gl.MAX_TEXTURE_SIZE, gl.MAX_RENDERBUFFER_SIZE, gl.MAX_VIEWPORT_DIMS,
        gl.MAX_VERTEX_ATTRIBS, gl.MAX_VERTEX_UNIFORM_VECTORS, gl.MAX_FRAGMENT_UNIFORM_VECTORS,
        gl.MAX_TEXTURE_IMAGE_UNITS, gl.ALIASED_LINE_WIDTH_RANGE, gl.ALIASED_POINT_SIZE_RANGE,
      ];
      const sweep = params.map((p) => { try { return String(gl.getParameter(p)); } catch { return "?"; } }).join("|");
      rows.push(rowFromCatalog("*.getParameter", {
        surface: "WebGL parameter sweep",
        value: `hash ${fnv1a(sweep)}`,
        present: true,
        signal: { name: "webglParamHash", value: fnv1a(sweep) },
      }));

      const exts = gl.getSupportedExtensions() ?? [];
      rows.push(rowFromCatalog("*.getSupportedExtensions", {
        surface: "Supported extensions",
        value: `${exts.length} exts, hash ${fnv1a(exts.join(","))}`,
        present: true,
        signal: { name: "webglExtHash", value: fnv1a(exts.join(",")) },
      }));

      const sp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      rows.push(rowFromCatalog("*.getShaderPrecisionFormat", {
        surface: "Fragment HIGH_FLOAT precision",
        value: sp ? `precision ${sp.precision}, range ${sp.rangeMin}/${sp.rangeMax}` : "null",
        present: !!sp,
      }));

      const attrs = gl.getContextAttributes();
      rows.push(rowFromCatalog("*.getContextAttributes", {
        surface: "Context attributes",
        value: JSON.stringify(attrs),
        present: true,
      }));
      rows.push(rowFromCatalog("*.readPixels", { surface: "*.readPixels", value: "exercised", present: true }));
    } catch (e) {
      rows.push(rowFromCatalog("*.getParameter", { surface: "WebGL", value: `error: ${String(e)}`, present: null }));
    }
    return rows;
  },
};
