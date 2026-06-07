import type { Probe, ProbeRow } from "../types.js";
import { rowFromCatalog } from "./util.js";

/**
 * Worker-vs-main-thread consistency. Spoofers routinely patch the main-thread
 * `navigator` but forget the WorkerNavigator inside a Web Worker, so the two
 * disagree — a high-value tell (surfaced in the Phase-1 worker-context gap).
 */
const WORKER_SRC = `
self.onmessage = function () {
  var n = self.navigator || {};
  var offscreen = (typeof OffscreenCanvas !== 'undefined');
  postMessage({
    userAgent: n.userAgent, platform: n.platform,
    hardwareConcurrency: n.hardwareConcurrency, languages: (n.languages||[]).join(','),
    deviceMemory: n.deviceMemory, offscreen: offscreen
  });
};
`;

export const workerProbe: Probe = {
  id: "worker",
  keys: ["Worker", "WorkerNavigator", "importScripts", "OffscreenCanvas"],
  async run(): Promise<ProbeRow[]> {
    const rows: ProbeRow[] = [];
    if (typeof Worker === "undefined") {
      rows.push(rowFromCatalog("Worker", { surface: "Worker", value: "absent", present: false }));
      return rows;
    }
    try {
      const blob = new Blob([WORKER_SRC], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      const data = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const to = setTimeout(() => reject(new Error("worker timeout")), 2000);
        worker.onmessage = (e) => { clearTimeout(to); resolve(e.data as Record<string, unknown>); };
        worker.onerror = (e) => { clearTimeout(to); reject(new Error(e.message)); };
        worker.postMessage("go");
      });
      worker.terminate();
      URL.revokeObjectURL(url);

      const mainUA = navigator.userAgent;
      const mainPlat = navigator.platform;
      const mainHC = navigator.hardwareConcurrency;
      const uaMatch = data["userAgent"] === mainUA;
      const platMatch = data["platform"] === mainPlat;
      const hcMatch = data["hardwareConcurrency"] === mainHC;
      const consistent = uaMatch && platMatch && hcMatch;

      rows.push(rowFromCatalog("WorkerNavigator", {
        surface: "WorkerNavigator vs main thread",
        value: `UA ${uaMatch ? "✓" : "✗"}, platform ${platMatch ? "✓" : "✗"}, HC ${hcMatch ? "✓" : "✗"}`,
        present: true,
        verdict: consistent ? "pass" : "bot",
        note: consistent ? undefined : "WorkerNavigator disagrees with main-thread navigator — spoofer patched only the main thread",
        signal: { name: "workerConsistent", value: consistent },
      }));
      rows.push(rowFromCatalog("OffscreenCanvas", { surface: "OffscreenCanvas (in worker)", value: String(data["offscreen"]), present: !!data["offscreen"] }));
      rows.push(rowFromCatalog("Worker", { surface: "Worker", value: "spawned", present: true }));
      rows.push(rowFromCatalog("importScripts", { surface: "importScripts", value: "available in worker scope", present: true }));
    } catch (e) {
      rows.push(rowFromCatalog("WorkerNavigator", { surface: "WorkerNavigator", value: `error: ${String(e)}`, present: null }));
      rows.push(rowFromCatalog("Worker", { surface: "Worker", value: "present", present: true }));
    }
    return rows;
  },
};
