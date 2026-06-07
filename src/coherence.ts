import type { Verdict } from "./types.js";

export interface CoherenceCheck {
  name: string;
  detail: string;
  ok: boolean | null; // null = couldn't evaluate
}

/**
 * Cross-surface consistency checks — the "coherence" layer. Each verifies that
 * independently-measured signals agree; a spoofer whose values are each
 * plausible but mutually contradictory fails here even when every per-surface
 * probe passes.
 */
export function runCoherence(signals: Map<string, unknown>): CoherenceCheck[] {
  const g = <T>(k: string): T | undefined => signals.get(k) as T | undefined;
  const checks: CoherenceCheck[] = [];

  const ua = g<string>("ua") ?? "";
  const platform = g<string>("platform") ?? "";
  const uaDataPlatform = g<string>("uaDataPlatform") ?? "";
  const renderer = g<string>("webglRenderer") ?? "";
  const timezone = g<string>("timezone") ?? "";
  const language = g<string>("language") ?? "";
  const intlLocale = g<string>("intlLocale") ?? "";
  const maxTouch = g<number>("maxTouchPoints") ?? 0;
  const pointer = g<boolean>("pointer"); // (pointer: coarse)
  const workerConsistent = g<boolean>("workerConsistent");
  const webdriver = g<boolean>("webdriver");
  const webdriverPatched = g<boolean>("webdriverGetterPatched");

  // 1. UA platform token vs navigator.platform.
  const uaSaysWin = /Windows/i.test(ua), uaSaysMac = /Mac OS X|Macintosh/i.test(ua), uaSaysLinux = /Linux|X11/i.test(ua) && !/Android/i.test(ua);
  const platWin = /Win/i.test(platform), platMac = /Mac/i.test(platform), platLinux = /Linux/i.test(platform);
  checks.push({
    name: "UA ↔ navigator.platform",
    detail: `UA="${osOf(ua)}" platform="${platform}"`,
    ok: !platform ? null : (uaSaysWin && platWin) || (uaSaysMac && platMac) || (uaSaysLinux && platLinux) || (!uaSaysWin && !uaSaysMac && !uaSaysLinux),
  });

  // 2. UA ↔ userAgentData.platform.
  checks.push({
    name: "UA ↔ userAgentData.platform",
    detail: `UA="${osOf(ua)}" uaData="${uaDataPlatform}"`,
    ok: !uaDataPlatform ? null : (uaSaysWin && /Windows/i.test(uaDataPlatform)) || (uaSaysMac && /macOS/i.test(uaDataPlatform)) || (uaSaysLinux && /Linux/i.test(uaDataPlatform)) || (!uaSaysWin && !uaSaysMac && !uaSaysLinux),
  });

  // 3. UA OS ↔ WebGL renderer OS hints.
  let rendererOk: boolean | null = null;
  if (renderer && renderer !== "(masked)" && (uaSaysWin || uaSaysMac || uaSaysLinux)) {
    const rWin = /Direct3D|ANGLE.*Direct|D3D11/i.test(renderer);
    const rMac = /Apple|Metal/i.test(renderer);
    const rLinuxOrSoft = /OpenGL|Mesa|llvmpipe|SwiftShader/i.test(renderer);
    rendererOk = (uaSaysWin && (rWin || rLinuxOrSoft)) || (uaSaysMac && (rMac || rLinuxOrSoft)) || (uaSaysLinux && rLinuxOrSoft) || (rWin || rMac || rLinuxOrSoft);
  }
  checks.push({ name: "UA OS ↔ WebGL renderer", detail: `${osOf(ua)} vs "${renderer}"`, ok: rendererOk });

  // 4. navigator.language ↔ Intl locale.
  checks.push({
    name: "navigator.language ↔ Intl locale",
    detail: `${language} vs ${intlLocale}`,
    ok: !language || !intlLocale ? null : intlLocale.toLowerCase().startsWith(language.toLowerCase().slice(0, 2)),
  });

  // 5. timezone present & plausible.
  checks.push({ name: "Intl timezone resolvable", detail: timezone || "(none)", ok: timezone ? /\//.test(timezone) || timezone === "UTC" : null });

  // 6. touch support ↔ pointer media coherence.
  let touchOk: boolean | null = null;
  if (pointer !== undefined) {
    // coarse pointer implies touch; fine/no-coarse with maxTouch>0 is fine too. Flag: coarse pointer but zero touch points.
    touchOk = !(pointer === true && maxTouch === 0);
  }
  checks.push({ name: "pointer media ↔ maxTouchPoints", detail: `coarse=${pointer} maxTouch=${maxTouch}`, ok: touchOk });

  // 7. worker navigator consistency.
  checks.push({ name: "WorkerNavigator ↔ main thread", detail: workerConsistent === undefined ? "(n/a)" : workerConsistent ? "consistent" : "MISMATCH", ok: workerConsistent ?? null });

  // 8. webdriver flag vs getter integrity (spoofers set flag false but leave a JS getter).
  checks.push({
    name: "webdriver flag ↔ getter integrity",
    detail: `flag=${webdriver} getterPatched=${webdriverPatched}`,
    ok: webdriverPatched === undefined ? null : !(webdriverPatched === true),
  });

  return checks;
}

function osOf(ua: string): string {
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Linux|X11/i.test(ua)) return "Linux";
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  return "?";
}

export function coherenceVerdict(checks: CoherenceCheck[]): { score: number; lies: number; verdict: Verdict } {
  const evaluated = checks.filter((c) => c.ok !== null);
  const passed = evaluated.filter((c) => c.ok === true).length;
  const lies = evaluated.filter((c) => c.ok === false).length;
  const score = evaluated.length ? Math.round((passed / evaluated.length) * 100) : 100;
  const verdict: Verdict = lies >= 2 ? "bot" : lies === 1 ? "suspect" : "pass";
  return { score, lies, verdict };
}
