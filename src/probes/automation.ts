import type { Probe, ProbeRow } from "../types.js";
import { isNative, rowFromCatalog } from "./util.js";

/**
 * Automation-detection layer: an integrity "lies detector" plus CDP /
 * command-line-API residue left behind by headless and driver-controlled browsers.
 */
const KEYS = [
  "webdriver",
  "navigator.__proto__.webdriver",
  "getEventListeners",
  "window.chrome",
  "chrome.runtime",
  "Function.prototype.toString",
  "Object.getOwnPropertyDescriptor",
  "*.__lookupGetter__",
];

export const automationProbe: Probe = {
  id: "automation",
  keys: KEYS,
  run(): ProbeRow[] {
    const rows: ProbeRow[] = [];
    const w = globalThis as Record<string, unknown>;
    const n = navigator as Navigator & { webdriver?: boolean };

    // webdriver getter: is it a native getter or a JS-land spoof?
    let getterNative = true;
    try {
      const d = Object.getOwnPropertyDescriptor(Navigator.prototype, "webdriver");
      if (d?.get) getterNative = isNative(d.get);
    } catch { /* ignore */ }
    rows.push(rowFromCatalog("navigator.__proto__.webdriver", {
      surface: "webdriver getter integrity",
      value: `value=${n.webdriver}, getter ${getterNative ? "native" : "PATCHED"}`,
      present: true,
      verdict: !getterNative ? "bot" : "pass",
      note: !getterNative ? "navigator.webdriver getter has been overwritten in JS — spoofer artifact" : undefined,
      signal: { name: "webdriverGetterPatched", value: !getterNative },
    }));

    // getEventListeners — DevTools command-line API leaks a CDP eval context.
    const gel = w["getEventListeners"];
    rows.push(rowFromCatalog("getEventListeners", {
      surface: "getEventListeners (CDP command-line API)",
      value: gel === undefined ? "absent" : `present (${typeof gel})`,
      present: gel !== undefined,
      verdict: gel !== undefined ? "bot" : "pass",
      note: gel !== undefined ? "command-line API helper exposed → CDP/automation eval context" : undefined,
      signal: { name: "getEventListeners", value: gel !== undefined },
    }));

    // CDP / automation framework residue on the global.
    const residue = [
      "cdc_adoQpoasnfa76pfcZLmcfl_Array", "$cdc_asdjflasutopfhvcZLmcfl_",
      "__playwright__binding__", "__pwInitScripts", "__puppeteer_evaluation_script__",
      "__selenium_unwrapped", "__webdriver_evaluate", "_phantom", "callPhantom", "__nightmare", "domAutomation",
    ];
    const found = residue.filter((r) => r in w || r in (n as unknown as object));
    rows.push(rowFromCatalog("webdriver", {
      surface: "Automation-framework global residue",
      value: found.length ? found.join(", ") : "none",
      present: true,
      verdict: found.length ? "bot" : "pass",
      note: found.length ? "automation framework left global artifacts" : undefined,
      signal: { name: "automationResidue", value: found.join(",") },
    }));

    // window.chrome shape (real Chrome has chrome.runtime/.csi/.loadTimes).
    const chrome = w["chrome"] as { runtime?: unknown; csi?: unknown; loadTimes?: unknown } | undefined;
    const isChromeUA = /Chrome\//.test(navigator.userAgent) && !/Edg|OPR/.test(navigator.userAgent);
    const chromeShape = chrome ? Object.keys(chrome).join(",") : "(absent)";
    rows.push(rowFromCatalog("window.chrome", {
      surface: "window.chrome object shape",
      value: chromeShape,
      present: !!chrome,
      verdict: isChromeUA && !chrome ? "bot" : "info",
      note: isChromeUA && !chrome ? "UA claims Chrome but window.chrome is missing — headless tell" : undefined,
      signal: { name: "chromePresent", value: !!chrome },
    }));

    // Function.prototype.toString integrity (the meta-lie: is toString itself patched?).
    rows.push(rowFromCatalog("Function.prototype.toString", {
      surface: "Function.prototype.toString integrity",
      value: isNative(Function.prototype.toString) ? "native" : "PATCHED",
      present: true,
      verdict: isNative(Function.prototype.toString) ? "pass" : "bot",
      note: isNative(Function.prototype.toString) ? undefined : "toString itself is hooked — stealth framework hiding patches",
      signal: { name: "toStringPatched", value: !isNative(Function.prototype.toString) },
    }));

    rows.push(rowFromCatalog("Object.getOwnPropertyDescriptor", { surface: "Object.getOwnPropertyDescriptor", value: "exercised (lie detector)", present: true }));
    rows.push(rowFromCatalog("*.__lookupGetter__", { surface: "*.__lookupGetter__", value: "exercised (lie detector)", present: true }));
    rows.push(rowFromCatalog("chrome.runtime", { surface: "chrome.runtime", value: chrome?.runtime ? "present" : "absent", present: !!chrome?.runtime }));
    return rows;
  },
};
