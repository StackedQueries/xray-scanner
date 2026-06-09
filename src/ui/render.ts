import type { ProbeRow, Verdict } from "../types.js";
import type { RunResult } from "../runner.js";
import type { StabilityReport } from "../persistence.js";
import type { IdentityReport, IdentityVerdict } from "../identity.js";
import { LAYERS } from "../layers.js";
import { entry } from "../catalog.js";
import { resultJson, scoreOf } from "../runner.js";
import type { ScoreResult } from "../scoring.js";
import { hashPairs } from "../hash.js";
import { crossReference, type XrefReport } from "../scriptXref.js";

const XREF_EXAMPLE = `// paste a bot-detection challenge / tracker script — it is analyzed locally
var _0x=['webdriver','userAgent','plugins'];
if (navigator[_0x[0]]) flagBot();
var ua = navigator[_0x[1]];
document.createElement('canvas').getContext('2d').toDataURL();
var pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
Object.getOwnPropertyDescriptor(navigator,'webdriver').get.call(navigator);
navigator[_0x[2]].length;`;

export interface Handlers {
  onReload: () => void;
  onRerun: () => void;
  onReset: () => void;
  onSimulateNewUser: () => void;
  onFullReset: () => void;
}

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// L1–L4 defense-in-depth framework — a vendor-neutral way to classify each
// probe by where in the stack it operates. Shown as hover info on each probe
// row's layer badge.
const LAYER_INFO: Record<string, string> = {
  L1a:
    "L1a — Static Environmental Introspection. Probes static browser properties for forgery artifacts: navigator, WebGL/Canvas, AudioContext, font enumeration, screen, DOM prototype-chain integrity.",
  L1b:
    "L1b — Dynamic Sensor Telemetry (behavioural biometrics). Real-time human motor signatures: mouse velocity/acceleration, click timing, scroll micro-patterns, touch pressure, device motion/orientation.",
  L2:
    "L2 — Code Obfuscation & Polymorphism. Self-modifying opcodes, bytecode rotation, AST obfuscation that raise an attacker's reverse-engineering cost.",
  L3:
    "L3 — Execution Traps & Anti-Introspection. Console traps, anti-debugger hooks, prototype-integrity checks, DevTools-open detection, and decoy-overlay honeypots.",
  L4:
    "L4 — Chronometric Integrity. performance.now() timing-delta checks for instrumentation, plus macroscopic inference-latency detection (multi-second per-action delays vs sub-200ms for a human).",
};

function layerCell(layer: string | null): HTMLElement {
  const cell = el("div", "c-layer", layer ?? "");
  const info = layer ? LAYER_INFO[layer] : undefined;
  if (info) cell.title = info;
  return cell;
}

function verdictBadge(v: Verdict): HTMLElement {
  const labels: Record<Verdict, string> = { pass: "PASS", suspect: "SUSPECT", bot: "BOT", info: "·" };
  return el("span", `badge v-${v}`, labels[v]);
}

function row(r: ProbeRow): HTMLElement {
  const tr = el("div", "row");
  const surface = el("div", "c-surface");
  surface.append(el("span", "surface-label", r.surface));
  if (r.beyondCatalog) surface.append(el("span", "chip beyond", "beyond-catalog"));
  if (r.note) surface.append(el("div", "note", r.note));
  tr.append(surface);
  tr.append(el("div", "c-value mono", r.value));
  tr.append(el("div", `c-sev sev-${r.severity}`, r.severity));
  tr.append(el("div", "c-tell", r.botDetectionTell ? "tell" : ""));
  tr.append(layerCell(r.layer));
  const v = el("div", "c-verdict");
  v.append(verdictBadge(r.verdict));
  tr.append(v);
  return tr;
}

function layerSection(layerId: string, title: string, idx: number, blurb: string, testable: string, rows: ProbeRow[]): HTMLElement {
  const sec = el("section", `layer layer-${layerId} testable-${testable}`);
  const head = el("div", "layer-head");
  head.append(el("span", "chip", `${title} ${String(idx).padStart(2, "0")} / 05`));
  if (testable !== "yes") head.append(el("span", `chip t-${testable}`, testable === "no" ? "transport layer" : "live sample"));
  head.append(el("h2", undefined, title));
  head.append(el("p", "blurb", blurb));
  sec.append(head);

  if (layerId === "network") {
    const note = el("div", "static-gap");
    note.textContent =
      "TLS (JA3/JA4), HTTP/2 SETTINGS, and IP/proxy reputation are established at the transport layer, " +
      "before any page script runs. They're shown here for completeness as part of the layered model.";
    sec.append(note);
    return sec;
  }

  // Group rows by category for readability.
  const byCat = new Map<string, ProbeRow[]>();
  for (const r of rows) {
    const cat = r.beyondCatalog && r.key.startsWith("beyond:media") ? "css (media features)" : entry(r.key)?.category ?? "other";
    (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(r);
  }
  for (const [cat, crows] of [...byCat].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Each category is a collapsible, sorted "page" (paginate-by-category).
    const group = el("details", "cat-group") as HTMLDetailsElement;
    const tells = crows.filter((r) => r.verdict === "bot" || r.verdict === "suspect").length;
    group.open = tells > 0; // auto-expand only categories with something flagged
    const catHash = hashPairs(crows.map((r) => ({ key: r.key + "#" + r.surface, value: r.value })));
    const ch = el("summary", "cat-head");
    ch.append(el("span", undefined, `${cat} · ${crows.length} surface${crows.length === 1 ? "" : "s"}${tells ? ` · ${tells} flagged` : ""}`));
    ch.append(el("span", "cat-hash mono", catHash));
    group.append(ch);
    crows
      .sort((a, b) => rank(b.verdict) - rank(a.verdict))
      .forEach((r) => group.append(row(r)));
    sec.append(group);
  }
  return sec;
}

function rank(v: Verdict): number {
  return v === "bot" ? 3 : v === "suspect" ? 2 : v === "info" ? 0 : 1;
}

function coherencePanel(res: RunResult): HTMLElement {
  const sec = el("section", "layer layer-coherence testable-yes");
  const head = el("div", "layer-head");
  head.append(el("span", "chip", "Coherence 05 / 05"));
  head.append(el("h2", undefined, "Coherence"));
  head.append(el("p", "blurb", "Cross-surface consistency — individual values matter less than whether the whole profile agrees."));
  sec.append(head);
  for (const c of res.coherence) {
    const r = el("div", "row");
    r.append(el("div", "c-surface", c.name));
    r.append(el("div", "c-value mono", c.detail));
    r.append(el("div", "c-sev", ""));
    r.append(el("div", "c-tell", ""));
    r.append(el("div", "c-layer", ""));
    const v = el("div", "c-verdict");
    v.append(verdictBadge(c.ok === null ? "info" : c.ok ? "pass" : "bot"));
    r.append(v);
    sec.append(r);
  }
  return sec;
}

function renderXref(container: HTMLElement, rep: XrefReport): void {
  container.innerHTML = "";
  if (!rep.ok) {
    container.append(el("div", "static-gap", rep.error ? `Could not analyze: ${rep.error}` : "Paste a script and analyze."));
    return;
  }
  container.append(el("p", "blurb", rep.summary));
  const triad = el("div", "stab-summary");
  triad.append(kv("surfaces touched", String(rep.surfaces)));
  triad.append(kv("bot-detection tells", String(rep.tells), rep.tells ? "warn" : "good"));
  triad.append(kv("we measured", String(rep.measured), "good"));
  triad.append(kv("hazards", String(rep.hazards.length), rep.hazards.length ? "warn" : "good"));
  container.append(triad);

  if (rep.structural.length) {
    const n = el("div", "static-gap");
    n.innerHTML = "<strong>Detected:</strong> " + rep.structural.map((s) => `<span class="chip">${s}</span>`).join(" ");
    container.append(n);
  }
  if (rep.hazards.length) {
    const g = el("div", "cat-group");
    g.append(el("div", "cat-head", `dynamic-execution hazards · ${rep.hazards.length}`));
    for (const h of rep.hazards.slice(0, 12)) {
      const r = el("div", "diag-row");
      r.append(el("div", "d-name", h.type));
      r.append(el("div", "d-val mono", h.detail.slice(0, 90)));
      g.append(r);
    }
    container.append(g);
  }
  // The join: each surface the script probes, and how THIS client answers it.
  const head = el("div", "row");
  for (const t of ["surface (script probes)", "our value", "sev", "tell", "", "verdict"]) head.append(el("div", "c-head-cell", t));
  head.className = "row row-head";
  container.append(head);
  for (const r of rep.rows) {
    const row = el("div", "row");
    const s = el("div", "c-surface");
    s.append(el("span", "surface-label", r.key));
    s.append(el("span", "chip", r.category));
    row.append(s);
    row.append(el("div", "c-value mono", r.measured ? r.ourValue : "(not measured here)"));
    row.append(el("div", `c-sev sev-${r.severity}`, r.severity));
    row.append(el("div", "c-tell", r.tell ? "tell" : ""));
    row.append(el("div", "c-layer", ""));
    const v = el("div", "c-verdict");
    v.append(verdictBadge(r.ourVerdict as Verdict));
    row.append(v);
    container.append(row);
  }
}

function xrefPanel(rowsByKey: Map<string, ProbeRow[]>): HTMLElement {
  const sec = el("section", "layer layer-xref testable-yes");
  const head = el("div", "layer-head");
  head.append(el("span", "chip", "Script cross-reference (script2builtins)"));
  head.append(el("h2", undefined, "Cross-reference a script against this client"));
  head.append(el("p", "blurb", "Paste a bot-detection challenge or tracker script. It's statically analyzed in-browser with script2builtins (the same catalog this page probes) to find every fingerprint API it touches — then joined against what THIS client actually returns for each. Sees through string-array / JSFuck obfuscation and reflective getters."));
  sec.append(head);

  const ta = document.createElement("textarea");
  ta.className = "xref-input mono";
  ta.spellcheck = false;
  ta.value = XREF_EXAMPLE;
  sec.append(ta);

  const ctrls = el("div", "actions stab-actions");
  const analyze = el("button", "btn", "Analyze & cross-reference");
  const clear = el("button", "btn ghost", "Clear");
  ctrls.append(analyze, clear);
  sec.append(ctrls);

  const results = el("div", "xref-results");
  sec.append(results);

  analyze.addEventListener("click", () => renderXref(results, crossReference(ta.value, rowsByKey)));
  clear.addEventListener("click", () => {
    ta.value = "";
    results.innerHTML = "";
  });
  // Auto-run the seeded example so the feature is visible on load.
  renderXref(results, crossReference(ta.value, rowsByKey));
  return sec;
}

function diagnosticsPanel(res: RunResult): HTMLElement {
  const d = res.diagnostics;
  const sec = el("section", "layer layer-diag testable-yes");
  const head = el("div", "layer-head");
  head.append(el("span", "chip", "Fingerprint diagnostics"));
  head.append(el("h2", undefined, "Fingerprint"));
  const fp = el("div", "fpid");
  fp.append(el("span", "fpid-label", "FP ID"));
  fp.append(el("span", "fpid-hash mono", d.fpId));
  fp.append(el("span", "fpid-long mono", d.fpIdLong));
  head.append(fp);
  head.append(el("p", "blurb", "The composite device fingerprint, the lies / errors / trash diagnostic triad, and the per-component and per-section hashes that compose it — so any one component can be diffed across a real browser and a bot."));
  sec.append(head);

  // lies / errors / trash triad.
  const triad = el("div", "stab-summary");
  triad.append(kv("lies", String(d.lies), d.lies ? "bad" : "good"));
  triad.append(kv("errors", String(d.errors), d.errors ? "warn" : "good"));
  triad.append(kv("trash (absent/empty)", String(d.trash), d.trash ? "warn" : "good"));
  triad.append(kv("coherence", `${res.coherenceScore}%`, res.coherenceScore >= 100 ? "good" : "bad"));
  triad.append(kv("components", String(d.components.length)));
  sec.append(triad);

  // Component breakdown — every fingerprint signal with its own hash.
  const comps = el("div", "cat-group");
  comps.append(el("div", "cat-head", `fingerprint components · ${d.components.length}`));
  for (const c of d.components) {
    const row = el("div", "diag-row");
    row.append(el("div", "d-name", c.name));
    row.append(el("div", "d-hash mono", c.hash));
    row.append(el("div", "d-val mono", c.value));
    comps.append(row);
  }
  sec.append(comps);

  // Per-section (per-category) hashes — a per-card digest.
  const secs = el("div", "cat-group");
  secs.append(el("div", "cat-head", "section hashes"));
  const grid = el("div", "hash-grid");
  for (const [cat, hash] of Object.entries(res.categoryHashes).sort()) {
    const cell = el("div", "hash-cell");
    cell.append(el("span", "hc-name", cat));
    cell.append(el("span", "hc-hash mono", hash));
    grid.append(cell);
  }
  secs.append(grid);
  sec.append(secs);

  // Lie / error detail lists (only when present).
  if (d.lieList.length) {
    const g = el("div", "cat-group");
    g.append(el("div", "cat-head", `lies · ${d.lieList.length}`));
    for (const l of d.lieList) {
      const r = el("div", "diag-row");
      r.append(el("div", "d-name", l.surface));
      r.append(el("div", "d-val", l.note));
      g.append(r);
    }
    sec.append(g);
  }
  if (d.errorList.length) {
    const g = el("div", "cat-group");
    g.append(el("div", "cat-head", `errors · ${d.errorList.length}`));
    for (const e of d.errorList.slice(0, 30)) {
      const r = el("div", "diag-row");
      r.append(el("div", "d-name", e.surface));
      r.append(el("div", "d-val mono", e.value));
      g.append(r);
    }
    sec.append(g);
  }
  return sec;
}

function identityPanel(id: IdentityReport, h: Handlers): HTMLElement {
  const labels: Record<IdentityVerdict, string> = {
    "new": "NEW VISITOR",
    "returning": "RETURNING VISITOR",
    "reset-attempt": "RESET ATTEMPT — NOT A NEW USER",
    "spoof-suspect": "RETURNING — FINGERPRINT SPOOFED",
  };
  const tone: Record<IdentityVerdict, Verdict> = { "new": "pass", "returning": "info", "reset-attempt": "bot", "spoof-suspect": "bot" };
  const sec = el("section", "layer layer-identity testable-yes");
  const head = el("div", "layer-head");
  head.append(el("span", "chip", "Visitor identity — new vs returning"));
  head.append(el("span", `chip v-${tone[id.verdict]}`, labels[id.verdict]));
  head.append(el("h2", undefined, `The page thinks you are: ${labels[id.verdict]}`));
  head.append(el("p", "blurb", "Cross-session re-identification. A visitor ID is stored redundantly across many backends (evercookie) and cross-checked against the storage-independent fingerprint — so clearing some storage to ‘look new’ is caught."));
  sec.append(head);

  if (id.note) {
    const n = el("div", "static-gap");
    n.textContent = id.note;
    sec.append(n);
  }

  const sum = el("div", "stab-summary");
  sum.append(kv("visitor id", id.shortId));
  sum.append(kv("visits", String(id.visits), id.visits > 1 ? "warn" : "good"));
  sum.append(kv("first seen", id.firstSeen.replace("T", " ").slice(0, 19)));
  sum.append(kv("fingerprint known", id.fingerprintKnown ? "yes" : "no", id.fingerprintKnown ? "warn" : "good"));
  sum.append(kv("fingerprint changed", id.fingerprintChanged ? "YES" : "no", id.fingerprintChanged ? "bad" : "good"));
  sec.append(sum);

  // Storage-backend survival table — shows exactly what survived a clear.
  for (const b of id.backends) {
    const row = el("div", "row");
    const s = el("div", "c-surface");
    s.append(el("span", "surface-label", b.name));
    s.append(el("span", "chip", b.durable ? "durable" : "ephemeral"));
    row.append(s);
    row.append(el("div", "c-value mono", b.error ? "unavailable" : b.present ? "id present" : "absent / cleared"));
    row.append(el("div", "c-sev", ""));
    row.append(el("div", "c-tell", b.present && b.durable ? "survivor" : ""));
    row.append(el("div", "c-layer", ""));
    const vc = el("div", "c-verdict");
    vc.append(verdictBadge(b.error ? "info" : b.present ? "pass" : "suspect"));
    row.append(vc);
    sec.append(row);
  }

  const ctrls = el("div", "actions stab-actions");
  const sim = el("button", "btn", "Simulate new user (clear common storage)");
  sim.addEventListener("click", h.onSimulateNewUser);
  const full = el("button", "btn ghost", "Full reset (wipe all backends)");
  full.addEventListener("click", h.onFullReset);
  ctrls.append(sim, full);
  sec.append(ctrls);
  return sec;
}

function stabilityPanel(s: StabilityReport, h: Handlers): HTMLElement {
  const sec = el("section", "layer layer-stability testable-yes");
  const head = el("div", "layer-head");
  head.append(el("span", "chip", "Reload & reconnection stability"));
  const overall: Verdict = !s.meaningful ? "info" : s.fingerprintStable && s.driftCount === 0 ? "pass" : "bot";
  const v = el("span", `chip v-${overall}`, !s.meaningful ? "baseline captured" : overall === "pass" ? "STABLE across reloads" : "FINGERPRINT DRIFT");
  head.append(v);
  head.append(el("h2", undefined, "Reload & reconnection stability"));
  head.append(
    el(
      "p",
      "blurb",
      "A genuine browser reproduces the same fingerprint on every reload, new tab, and reconnect. A bot that injects per-load canvas/audio/WebGL noise drifts — which is the tell. Baseline persists in localStorage (shared across tabs/reloads).",
    ),
  );
  sec.append(head);

  // Summary row.
  const sum = el("div", "stab-summary");
  sum.append(kv("stable fingerprint", s.fingerprint));
  sum.append(kv("runs recorded", `${s.runs}${s.sessionRuns > 1 ? ` (${s.sessionRuns} this session)` : ""}`));
  sum.append(kv("distinct fingerprints", String(s.distinctFingerprints), s.distinctFingerprints === 1 ? "good" : "bad"));
  sum.append(kv("drifting surfaces", String(s.driftCount), s.driftCount === 0 ? "good" : "bad"));
  sum.append(kv("first seen", s.firstSeen.replace("T", " ").slice(0, 19)));
  sec.append(sum);

  if (!s.available) {
    sec.append(el("div", "static-gap", "localStorage is unavailable (private mode / sandbox) — reload stability can't persist across loads this session."));
  } else if (!s.meaningful) {
    sec.append(el("div", "static-gap", "Baseline captured. Click ‘Reload & re-test’ (or open this page in a new tab) to compare — same values = stable, changed values = a per-load-randomizing bot."));
  }

  // Per-surface stability rows.
  for (const r of s.rows) {
    const row = el("div", "row");
    row.append(el("div", "c-surface", r.name));
    const valCell = el("div", "c-value mono", trunc(r.current, 56));
    if (!r.stable) {
      const d = el("div", "note", `${r.distinctCount} distinct values seen: ${r.values.map((x) => trunc(x, 24)).join(" · ")}`);
      valCell.append(d);
    }
    row.append(valCell);
    row.append(el("div", "c-sev", ""));
    row.append(el("div", "c-tell", r.stable ? "" : "tell"));
    row.append(el("div", "c-layer", `${r.distinctCount}×`));
    const vc = el("div", "c-verdict");
    vc.append(verdictBadge(!s.meaningful ? "info" : r.stable ? "pass" : "bot"));
    row.append(vc);
    sec.append(row);
  }

  // Controls.
  const ctrls = el("div", "actions stab-actions");
  const reload = el("button", "btn", "Reload & re-test");
  reload.addEventListener("click", h.onReload);
  const rerun = el("button", "btn ghost", "Re-run probes (no reload)");
  rerun.addEventListener("click", h.onRerun);
  const reset = el("button", "btn ghost", "Reset baseline");
  reset.addEventListener("click", h.onReset);
  ctrls.append(reload, rerun, reset);
  sec.append(ctrls);
  return sec;
}

function kv(label: string, value: string, tone?: string): HTMLElement {
  const d = el("div", `stab-kv ${tone ? "tone-" + tone : ""}`);
  d.append(el("div", "stab-kv-val mono", value));
  d.append(el("div", "stab-kv-label", label));
  return d;
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function render(root: HTMLElement, res: RunResult, stability: StabilityReport, identity: IdentityReport, stabilityScore: number | null, handlers: Handlers): void {
  root.innerHTML = "";
  const sc = scoreOf(res, stabilityScore);

  const header = el("header", "header");
  header.append(el("div", "breadcrumb", "xray-scanner — catalog-driven fingerprint / bot-detection probe"));
  header.append(el("h1", undefined, "X-Ray Scanner"));
  header.append(el("p", "sub", `Probes every surface in the script2builtins catalog. ${res.stats.probes} probes · ${res.stats.rows} surfaces measured.`));

  // Headline stealth score — higher = harder to detect. Hard-fails cap it low.
  header.append(scoreChip(sc));

  const stats = el("div", "stats");
  stats.append(stat("fingerprint", res.fingerprint));
  stats.append(stat("coherence", `${res.coherenceScore}%`, res.coherenceScore >= 100 ? "good" : res.coherenceScore >= 75 ? "warn" : "bad"));
  stats.append(stat("lies detected", String(res.liesDetected), res.liesDetected === 0 ? "good" : "bad"));
  stats.append(stat("bot/suspect rows", `${res.stats.bot} / ${res.stats.suspect}`, res.stats.bot ? "bad" : res.stats.suspect ? "warn" : "good"));
  header.append(stats);

  const btns = el("div", "actions");
  const copyBtn = el("button", "btn", "Copy results JSON");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(resultJson(res));
      copyBtn.textContent = "Copied ✓";
      setTimeout(() => (copyBtn.textContent = "Copy results JSON"), 1500);
    } catch {
      copyBtn.textContent = "Clipboard blocked — see console";
      console.log(resultJson(res));
    }
  });
  const dlBtn = el("button", "btn ghost", "Download JSON");
  dlBtn.addEventListener("click", () => {
    const blob = new Blob([resultJson(res)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `xray-${res.fingerprint}.json`;
    a.click();
  });
  const expandBtn = el("button", "btn ghost", "Expand all");
  expandBtn.addEventListener("click", () => root.querySelectorAll("details.cat-group").forEach((d) => ((d as HTMLDetailsElement).open = true)));
  const collapseBtn = el("button", "btn ghost", "Collapse all");
  collapseBtn.addEventListener("click", () => root.querySelectorAll("details.cat-group").forEach((d) => ((d as HTMLDetailsElement).open = false)));
  const jsonBtn = el("button", "btn ghost", "View as JSON (?json)");
  jsonBtn.addEventListener("click", () => {
    const u = new URL(location.href);
    u.searchParams.set("json", "1");
    location.href = u.toString();
  });
  btns.append(copyBtn, dlBtn, expandBtn, collapseBtn, jsonBtn);
  header.append(btns);
  root.append(header);

  // Fingerprint diagnostics — FP ID, lies/errors/trash, component & section hashes.
  root.append(diagnosticsPanel(res));

  // Visitor identity — new vs returning, even across a storage reset.
  root.append(identityPanel(identity, handlers));

  // Reload / reconnection stability — the per-load-randomization detector.
  root.append(stabilityPanel(stability, handlers));

  // Script cross-reference — analyze a pasted script vs this client's outputs.
  const rowsByKey = new Map<string, ProbeRow[]>();
  for (const r of res.rows) (rowsByKey.get(r.key) ?? rowsByKey.set(r.key, []).get(r.key)!).push(r);
  root.append(xrefPanel(rowsByKey));

  // Layers in IA order; coherence rendered from its dedicated panel.
  for (const layer of LAYERS) {
    if (layer.id === "coherence") {
      root.append(coherencePanel(res));
      continue;
    }
    const rows = res.rowsByLayer.get(layer.id) ?? [];
    root.append(layerSection(layer.id, layer.title, layer.index, layer.blurb, layer.testable, rows));
  }

  const footer = el("footer", "footer");
  footer.append(el("p", undefined, "Run this in a real browser and your bot, then diff the JSON. Catalog: script2builtins-knowledge."));
  root.append(footer);
}

// Headline stealth score panel: the big number, a tone band, the hard-fail
// list (what capped it), and per-layer detectability bars.
function scoreChip(sc: ScoreResult): HTMLElement {
  const tone = sc.stealthScore >= 80 ? "good" : sc.stealthScore >= 50 ? "warn" : "bad";
  const panel = el("div", `score-panel tone-${tone}`);

  const head = el("div", "score-head");
  const big = el("div", "score-big mono", String(sc.stealthScore));
  head.append(big);
  const meta = el("div", "score-meta");
  meta.append(el("div", "score-title", "stealth score"));
  meta.append(el("div", "score-sub", sc.hardFails.length ? `capped — ${sc.hardFails.length} hard automation tell${sc.hardFails.length === 1 ? "" : "s"}` : "higher = harder to detect"));
  if (sc.stabilityScore !== null) meta.append(el("div", "score-sub", `reload stability ${sc.stabilityScore}%`));
  head.append(meta);
  panel.append(head);

  if (sc.hardFails.length) {
    const hf = el("div", "score-hardfails");
    hf.append(el("span", "score-hf-label", "hard-fails:"));
    for (const k of sc.hardFails) hf.append(el("span", "chip hf", k));
    panel.append(hf);
  }

  const layers = Object.entries(sc.byLayer).sort((a, b) => b[1] - a[1]);
  if (layers.length) {
    const max = Math.max(...layers.map(([, v]) => v));
    const bars = el("div", "score-bars");
    for (const [layer, v] of layers) {
      const b = el("div", "score-bar-row");
      b.append(el("span", "score-bar-label mono", layer));
      const track = el("div", "score-bar-track");
      const fill = el("div", "score-bar-fill");
      fill.style.width = `${Math.round((v / max) * 100)}%`;
      track.append(fill);
      b.append(track);
      b.append(el("span", "score-bar-val mono", String(Math.round(v * 10) / 10)));
      bars.append(b);
    }
    panel.append(bars);
  }
  return panel;
}

function stat(label: string, value: string, tone?: string): HTMLElement {
  const d = el("div", `stat ${tone ? "tone-" + tone : ""}`);
  d.append(el("div", "stat-value mono", value));
  d.append(el("div", "stat-label", label));
  return d;
}
