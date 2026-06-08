# X-Ray Scanner

An interactive, **catalog-driven** fingerprint / bot-detection test page. It actively probes **every** surface in the bundled `script2builtins-knowledge` catalog, computes a deterministic fingerprint, and runs lie/consistency checks — so you can:

- run your bot against it and **diff the JSON** against a real browser to see exactly what leaks or differs,
- **benchmark anti-detect / bot tooling** on the same page,
- prove, via a coverage gate, that the page exercises 100% of the catalog.

The catalog snapshot (`src/catalog.generated.json`) is committed; the in-browser script analyzer is pulled from the [`script2builtins`](https://www.npmjs.com/package/script2builtins) npm package and bundled by Vite — `npm install` and go.

## Information architecture

The page is organised as a **layered fingerprinting stack**, not a flat list, so each signal sits next to the layer it belongs to:

1. **Network identity** — TLS/JA3/HTTP-2/IP. Established at the transport layer before any page script runs; shown for completeness.
2. **Browser APIs** — canvas, WebGL, audio, fonts, navigator, screen, WebRTC, timing, codecs, sensors…
3. **Automation detection** — webdriver, CDP/Playwright/Selenium residue, an integrity "lies detector".
4. **Session & behaviour** — input dynamics & timing, sampled live from the page.
5. **Coherence** — cross-surface consistency: the spoofer-catcher.

Each row shows **surface · measured value · severity · botDetectionTell · SoK layer · verdict (PASS/SUSPECT/BOT)**. The header shows the deterministic **fingerprint hash**, a **coherence score**, and a **lies-detected** count, with **Copy results JSON** / **Download JSON** for diffing. Categories are **collapsible, sorted cards** (paginated by category; auto-expanded when something is flagged) with **Expand all / Collapse all** controls.

### Get everything as JSON

Append **`?json`** to the URL (`…/xray-scanner/?json`) to render the entire dataset — all rows (with category), diagnostics, coherence, per-section hashes, reload-stability, and visitor-identity — as a single JSON document for automation harnesses. (There's also a **View as JSON** button.)

## Network / WebRTC

A full WebRTC network probe (`src/probes/network.ts`) surfaces what the transport layer leaks:

- **Host candidate (local IP)** — the LAN IP, or its **mDNS `.local` mask** (modern Chrome default). A raw private IP is flagged as a deanonymization vector.
- **Public IP via STUN (srflx)** — opens an `RTCPeerConnection` to `stun.l.google.com` and reports the **public egress IP** from the server-reflexive candidate. This bypasses page-level IP hiding.
- **ICE candidate types & foundations**, **SDP codecs** + **header extensions (extmap)**, full **SDP hash**, and **RTCRtpSender/Receiver capabilities**.
- **Media devices** (`enumerateDevices`) — kinds + counts (audioinput/audiooutput/videoinput), label exposure (permission tell).

Plus parity probes for everything else a full fingerprinter reports: **speech voices**, **battery** (VM-default detection), **DOMRect** sub-pixel geometry, **window-key / engine-version** hash, **error-engine** signature (V8 detection), and **computed-style** key count.

## Script cross-reference (script2builtins)

Paste a bot-detection challenge or tracker script into the **"Cross-reference a script"** panel. It's analyzed **in-browser** with the bundled `script2builtins` analyzer (the same catalog this page probes) to find every fingerprint API the script touches — seeing through string-array/JSFuck obfuscation and reflective getters — then **joined against what this client actually returns** for each surface. You get, row by row: the API the script probes, whether it's a bot-detection tell, and **this browser's measured value + verdict**. So you can take any detector's code and see exactly how your client answers each question it asks. Dynamic-execution hazards, network sinks, and VM-attestation patterns are surfaced too.

## Fingerprint diagnostics

A dedicated diagnostics panel gives the full breakdown of the fingerprint:

- **FP ID** — the composite device fingerprint (short + long composite id).
- **lies / errors / trash** triad — integrity violations (spoofing/coherence failures) · probes that threw · curated surfaces that returned no usable value. (Auto-coverage placeholders are excluded so the triad reflects real measurement quality.)
- **Fingerprint components** — every signal that composes the fingerprint, each with **its own hash** and raw value (`canvasHash`, `webglParamHash`, `audioHash`, `fonts`, `mathHash`, `rtcCodecs`, …) so any single component can be diffed in isolation across a real browser and a bot.
- **Section hashes** — a per-category digest (and each category card in the layer sections carries its own hash), so you can pinpoint exactly which subsystem differs.

## Reload & reconnection stability

A genuine browser reproduces the **same fingerprint** on every reload, in a new tab, and after a reconnect. A bot that injects **per-load noise** into canvas / audio / WebGL to dodge static fingerprinting produces a **different value each load** — and that instability is itself the tell. The **Reload & reconnection stability** panel makes this a first-class test:

- A baseline (the deterministic fingerprint + every stable per-surface signal) is persisted in **`localStorage`** — shared across reloads, tabs, and reconnects.
- Each run compares against the baseline and reports, per surface, **stable** vs **drift** (with the distinct values seen). Surfaces like `canvasHash`, `canvasPixelHash`, `audioHash`, `webglParamHash`, `webglRenderer`, `fonts`, `mathHash`, `rtcCodecs` are tracked.
- Header verdict: **STABLE across reloads** (real) vs **FINGERPRINT DRIFT** (randomizing bot).
- Controls: **Reload & re-test**, **Re-run probes (no reload)** (intra-session stability), **Reset baseline**.
- The fingerprint is computed over **stable signals only** — inherently volatile values (clock skew, timer jitter) are excluded so a real browser never looks like it drifts.

Workflow: open in your real browser → reload a couple of times (should stay STABLE) → run the same baseline in your bot → if any surface drifts, that surface is being randomized per-load.

## Visitor identity — new vs returning (cross-session tracking)

Tells you, at the top of the page, **whether it thinks you're a new user or a returning one — even if you cleared storage to look new.** Two re-identification mechanisms are combined:

1. **Redundant visitor ID (evercookie).** A visitor ID is written to many backends — `localStorage`, `sessionStorage`, `cookie`, `IndexedDB`, `Cache Storage`, `window.name` — and re-propagated ("healed") on every visit. Clearing *some* but not *all* of them is detected: the ID is recovered from a survivor.
2. **Storage-independent fingerprint.** The stable fingerprint is cross-checked against previously-seen ones, so a surviving ID with a *changed* fingerprint is flagged as spoofing.

**Verdicts** (header chip + headline):

| Verdict | Meaning |
|---|---|
| **NEW VISITOR** | No prior identity in any client store. |
| **RETURNING VISITOR** | Visitor ID present and fingerprint matches. |
| **RESET ATTEMPT — NOT A NEW USER** | You cleared some storage but the ID was recovered from a deeper backend. The page lists which backends you cleared and which gave you away. |
| **RETURNING — FINGERPRINT SPOOFED** | Same stored ID, but the device fingerprint changed since last visit. |

A per-backend table shows exactly what survived a clear (durable vs ephemeral), plus visits count and first-seen. Controls: **Simulate new user (clear common storage)** — clears the naive "I cleared my cookies" set (localStorage/session/cookie) and leaves the deep backends, so the next load still recognises you; **Full reset (wipe all backends)** — genuinely resets.

**Scope:** a *full* wipe of **all** client storage on the same device is, for a static server-less page, indistinguishable from a new visitor — and the page says so. Closing that gap would require server-side identity correlation, which is out of scope for a client-only scanner.

## Run / build / deploy

```sh
npm install
npm run dev        # local dev server
npm run coverage   # the coverage gate (also runs automatically before build)
npm run build      # tsc --noEmit + vite build → dist/
npm run preview    # serve the built dist
```

### GitHub Pages
`vite.config.ts` sets `base: '/xray-scanner/'`. The included workflow `.github/workflows/deploy.yml` runs the coverage gate, builds, and publishes `dist/` to Pages on push to `main`/`master`. For hosting elsewhere, build with `BASE=/ npm run build`.

## Coverage gate (proof, not assertion)

`npm run coverage` (→ `scripts/coverage-check.ts`, also wired as `prebuild`) loads `ALL_APIS` and the probe registry and **fails the build** if any catalog key has no probe. Current state — **546 / 546 catalog keys covered (100%)**, 0 missing, via **20 curated deep probes** (102 keys) + **444 auto-probes** (464 probes total). Machine-readable detail in [`coverage.json`](coverage.json).

Curated probes do real fingerprinting + lie/consistency checks; auto-probes generically resolve every remaining key to guarantee coverage. Per-category breakdown (`rich` = curated deep probe, `auto` = generic presence/value):

| Category | Keys | Rich | Auto |
|---|--:|--:|--:|
| `anti-debug` | 24 | 0 | 24 |
| `audio` | 25 | 7 | 18 |
| `canvas` | 30 | 8 | 22 |
| `css` | 9 | 3 | 6 |
| `document` | 23 | 0 | 23 |
| `dom-layout` | 11 | 4 | 7 |
| `events` | 31 | 0 | 31 |
| `extensions` | 10 | 0 | 10 |
| `fonts` | 5 | 5 | 0 |
| `headless-tells` | 39 | 3 | 36 |
| `intl` | 11 | 4 | 7 |
| `introspection` | 38 | 5 | 33 |
| `math` | 24 | 8 | 16 |
| `media` | 9 | 2 | 7 |
| `media-capabilities` | 7 | 0 | 7 |
| `navigator` | 73 | 13 | 60 |
| `screen` | 13 | 7 | 6 |
| `sensors` | 13 | 0 | 13 |
| `speech` | 6 | 3 | 3 |
| `storage` | 19 | 0 | 19 |
| `svg` | 7 | 0 | 7 |
| `timing` | 14 | 5 | 9 |
| `wasm` | 18 | 0 | 18 |
| `webgl` | 32 | 11 | 21 |
| `webrtc` | 27 | 10 | 17 |
| `window` | 23 | 5 | 18 |
| `workers` | 10 | 4 | 6 |

> Categories at `rich = 0` are fully auto-covered (present/value rows). They're the natural next targets for deeper probes; coverage is still 100% because every key is exercised.

## Beyond-catalog probes

Probes worth running that have **no corresponding catalog key** are still implemented, but clearly flagged (`beyond-catalog` chip in the UI, `beyondCatalog: true` in the JSON):

- **CSS media-feature values** (`src/probes/cssmedia.ts`) — `prefers-color-scheme`, `prefers-reduced-motion`, `prefers-contrast`, `forced-colors`, `inverted-colors`, `dynamic-range`, `color-gamut`, `any-pointer`, `any-hover`, `pointer`, `hover`, `update`. These are high-entropy display/OS/a11y signals queried through `matchMedia(...)`. The **`matchMedia` API is catalogued** (`dom-layout`), but the catalog is API-granular, not media-query-argument-granular, so the individual feature *values* are not separate catalog entries. **Candidate catalog home:** a `css`/`dom-layout` note, or argMatch-style entries on `matchMedia`.

If you add a probe for a surface the catalog lacks, either add a catalog entry (preferred, in `script2builtins-knowledge`) or flag it here.

## Layout

```
src/
  catalog.generated.json   # committed catalog snapshot (self-contained for GH Pages)
  scriptXref.ts            # static analysis via the script2builtins npm package
  catalog.ts  types.ts  layers.ts  hash.ts  coherence.ts  runner.ts
  probes/                  # auto.ts (coverage backbone) + curated deep probes
  ui/render.ts             # layered-IA renderer
scripts/
  coverage-check.ts        # the coverage gate
```

## Determinism

All probe values are stable across runs (hashes, not raw pixel buffers), so two runs — real browser vs bot — diff cleanly. The fingerprint is FNV-1a over sorted per-layer hashes.
