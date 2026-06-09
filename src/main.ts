import "./style.css";
import { runAll, resultObject, scoreOf } from "./runner.js";
import { stabilityScoreFrom } from "./scoring.js";
import { render } from "./ui/render.js";
import { recordRun, resetHistory } from "./persistence.js";
import { identify, simulateNewUser, fullReset } from "./identity.js";

const root = document.getElementById("app")!;
const JSON_MODE = new URLSearchParams(location.search).has("json");

async function runAndRender(): Promise<void> {
  const res = await runAll();
  const stability = recordRun(res.fingerprint, res.stableSignals);
  const identity = await identify(res.fingerprint, new Date().toISOString());
  const stabilityScore = stabilityScoreFrom(stability);

  if (JSON_MODE) {
    // ?json — emit the entire dataset as JSON for automation harnesses.
    const blob = { ...resultObject(res, stabilityScore), stability, identity };
    document.body.innerHTML = "";
    const pre = document.createElement("pre");
    pre.className = "json-dump";
    pre.textContent = JSON.stringify(blob, null, 2);
    document.body.appendChild(pre);
    (window as unknown as { __xray: unknown }).__xray = blob;
    return;
  }
  render(root, res, stability, identity, stabilityScore, {
    onReload: () => location.reload(),
    onRerun: () => void runAndRender(),
    onReset: () => {
      resetHistory();
      void runAndRender();
    },
    onSimulateNewUser: async () => {
      await simulateNewUser();
      location.reload();
    },
    onFullReset: async () => {
      resetHistory();
      await fullReset();
      location.reload();
    },
  });
  // Expose for console / automation harnesses.
  (window as unknown as { __xray: unknown }).__xray = { ...res, score: scoreOf(res, stabilityScore), stability, identity };
}

root.innerHTML = '<div class="loading">Running probes…</div>';
runAndRender().catch((e) => {
  root.innerHTML = `<pre class="error">xray-scanner failed: ${String(e)}\n${(e as Error)?.stack ?? ""}</pre>`;
});
