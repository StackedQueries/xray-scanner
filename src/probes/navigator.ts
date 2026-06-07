import type { Probe, ProbeRow } from "../types.js";
import { preview, rowFromCatalog } from "./util.js";

const KEYS = [
  "navigator.userAgent",
  "navigator.userAgentData",
  "navigator.platform",
  "navigator.language",
  "navigator.languages",
  "navigator.hardwareConcurrency",
  "navigator.deviceMemory",
  "navigator.plugins",
  "navigator.mimeTypes",
  "navigator.maxTouchPoints",
  "navigator.vendor",
  "navigator.webdriver",
];

export const navigatorProbe: Probe = {
  id: "navigator",
  keys: KEYS,
  async run(): Promise<ProbeRow[]> {
    const rows: ProbeRow[] = [];
    const n = navigator as Navigator & {
      deviceMemory?: number;
      userAgentData?: { brands?: unknown; mobile?: boolean; platform?: string; getHighEntropyValues?: (h: string[]) => Promise<Record<string, unknown>> };
    };

    const ua = n.userAgent;
    rows.push(rowFromCatalog("navigator.userAgent", { surface: "navigator.userAgent", value: ua, present: true, signal: { name: "ua", value: ua } }));
    rows.push(rowFromCatalog("navigator.platform", { surface: "navigator.platform", value: n.platform, present: true, signal: { name: "platform", value: n.platform } }));
    rows.push(rowFromCatalog("navigator.vendor", { surface: "navigator.vendor", value: n.vendor, present: true, signal: { name: "vendor", value: n.vendor } }));
    rows.push(rowFromCatalog("navigator.language", { surface: "navigator.language", value: n.language, present: true, signal: { name: "language", value: n.language } }));

    const langs = n.languages ?? [];
    rows.push(rowFromCatalog("navigator.languages", {
      surface: "navigator.languages",
      value: preview(langs),
      present: true,
      verdict: langs.length === 0 ? "bot" : "info",
      note: langs.length === 0 ? "empty languages — classic headless tell" : undefined,
      signal: { name: "languages", value: langs.join(",") },
    }));

    rows.push(rowFromCatalog("navigator.hardwareConcurrency", { surface: "navigator.hardwareConcurrency", value: String(n.hardwareConcurrency), present: true, signal: { name: "hardwareConcurrency", value: n.hardwareConcurrency } }));
    rows.push(rowFromCatalog("navigator.deviceMemory", { surface: "navigator.deviceMemory", value: String(n.deviceMemory ?? "(absent)"), present: n.deviceMemory != null, signal: { name: "deviceMemory", value: n.deviceMemory ?? null } }));
    rows.push(rowFromCatalog("navigator.maxTouchPoints", { surface: "navigator.maxTouchPoints", value: String(n.maxTouchPoints), present: true, signal: { name: "maxTouchPoints", value: n.maxTouchPoints } }));

    const plugins = n.plugins;
    rows.push(rowFromCatalog("navigator.plugins", {
      surface: "navigator.plugins.length",
      value: `${plugins?.length ?? 0} plugins`,
      present: true,
      verdict: (plugins?.length ?? 0) === 0 ? "suspect" : "info",
      note: (plugins?.length ?? 0) === 0 ? "zero plugins — default headless Chrome" : undefined,
      signal: { name: "pluginCount", value: plugins?.length ?? 0 },
    }));
    rows.push(rowFromCatalog("navigator.mimeTypes", { surface: "navigator.mimeTypes.length", value: `${n.mimeTypes?.length ?? 0}`, present: true }));

    // webdriver — the hard tell.
    const wd = (n as Navigator & { webdriver?: boolean }).webdriver;
    rows.push(rowFromCatalog("navigator.webdriver", {
      surface: "navigator.webdriver",
      value: String(wd),
      present: true,
      verdict: wd === true ? "bot" : "pass",
      note: wd === true ? "WebDriver/CDP automation flag is true" : undefined,
      signal: { name: "webdriver", value: wd === true },
    }));

    // userAgentData + high-entropy values, cross-checked against UA.
    if (n.userAgentData) {
      let hev: Record<string, unknown> = {};
      try {
        hev = (await n.userAgentData.getHighEntropyValues?.(["platform", "platformVersion", "architecture", "model", "uaFullVersion", "bitness"])) ?? {};
      } catch { /* ignore */ }
      rows.push(rowFromCatalog("navigator.userAgentData", {
        surface: "userAgentData.getHighEntropyValues",
        value: preview({ mobile: n.userAgentData.mobile, platform: n.userAgentData.platform, ...hev }, 160),
        present: true,
        signal: { name: "uaDataPlatform", value: String(n.userAgentData.platform ?? "") },
      }));
    } else {
      rows.push(rowFromCatalog("navigator.userAgentData", { surface: "navigator.userAgentData", value: "(absent)", present: false, note: "no UA-CH — non-Chromium or stripped" }));
    }
    return rows;
  },
};
