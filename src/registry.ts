import type { Probe } from "./types.js";
import { buildAutoProbes } from "./probes/auto.js";
import { canvasProbe } from "./probes/canvas.js";
import { webglProbe } from "./probes/webgl.js";
import { audioProbe } from "./probes/audio.js";
import { fontsProbe } from "./probes/fonts.js";
import { navigatorProbe } from "./probes/navigator.js";
import { automationProbe } from "./probes/automation.js";
import { cssMediaProbe } from "./probes/cssmedia.js";
import { workerProbe } from "./probes/worker.js";
import { screenProbe, permissionsProbe, intlProbe, timingProbe, mathProbe } from "./probes/misc.js";
import { webrtcNetworkProbe, mediaDevicesProbe } from "./probes/network.js";
import { featuresProbe, domrectProbe, speechProbe, batteryProbe, errorEngineProbe, computedStyleProbe } from "./probes/extras.js";

/** Curated deep probes — depth + lie/consistency checks on marquee surfaces. */
export const CURATED_PROBES: Probe[] = [
  canvasProbe,
  webglProbe,
  audioProbe,
  fontsProbe,
  navigatorProbe,
  automationProbe,
  screenProbe,
  permissionsProbe,
  intlProbe,
  timingProbe,
  mathProbe,
  webrtcNetworkProbe,
  mediaDevicesProbe,
  cssMediaProbe,
  workerProbe,
  featuresProbe,
  domrectProbe,
  speechProbe,
  batteryProbe,
  errorEngineProbe,
  computedStyleProbe,
];

/** Catalog keys claimed by curated probes (so auto-probes don't duplicate). */
export function claimedKeys(): Set<string> {
  const s = new Set<string>();
  for (const p of CURATED_PROBES) for (const k of p.keys) s.add(k);
  return s;
}

/** The full probe set: curated probes + auto-probes for every remaining key. */
export function allProbes(): Probe[] {
  return [...CURATED_PROBES, ...buildAutoProbes(claimedKeys())];
}
