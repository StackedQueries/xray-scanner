import type { Probe, ProbeRow } from "../types.js";
import { fnv1a } from "../hash.js";
import { rowFromCatalog } from "./util.js";

const KEYS = [
  "OfflineAudioContext",
  "AudioContext",
  "*.createOscillator",
  "*.createDynamicsCompressor",
  "*.getChannelData",
  "*.sampleRate",
  "*.startRendering",
];

export const audioProbe: Probe = {
  id: "audio",
  keys: KEYS,
  async run(): Promise<ProbeRow[]> {
    const rows: ProbeRow[] = [];
    const OAC = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
      ?? (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OAC) {
      rows.push(rowFromCatalog("OfflineAudioContext", { surface: "OfflineAudioContext", value: "absent", present: false, verdict: "suspect", note: "no OfflineAudioContext — VM/headless tell" }));
      return rows;
    }
    try {
      const ctx = new OAC(1, 44100, 44100);
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 10000;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -50;
      comp.knee.value = 40;
      comp.ratio.value = 12;
      comp.attack.value = 0;
      comp.release.value = 0.25;
      osc.connect(comp);
      comp.connect(ctx.destination);
      osc.start(0);
      const buf = await ctx.startRendering();
      const ch = buf.getChannelData(0);
      let sum = 0;
      for (let i = 4500; i < 5000; i++) sum += Math.abs(ch[i] ?? 0);
      const sig = sum.toString();
      rows.push(rowFromCatalog("OfflineAudioContext", {
        surface: "AudioContext DSP fingerprint (oscillator+compressor)",
        value: `sum ${sum.toFixed(6)}, hash ${fnv1a(sig)}`,
        present: true,
        signal: { name: "audioHash", value: fnv1a(sig) },
      }));
      rows.push(rowFromCatalog("*.sampleRate", { surface: "context.sampleRate", value: String(ctx.sampleRate), present: true, signal: { name: "sampleRate", value: ctx.sampleRate } }));
      for (const k of ["AudioContext", "*.createOscillator", "*.createDynamicsCompressor", "*.getChannelData", "*.startRendering"]) {
        rows.push(rowFromCatalog(k, { surface: k, value: "exercised", present: true }));
      }
    } catch (e) {
      rows.push(rowFromCatalog("OfflineAudioContext", { surface: "AudioContext", value: `error: ${String(e)}`, present: null }));
    }
    return rows;
  },
};
