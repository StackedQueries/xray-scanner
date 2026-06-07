/**
 * Information architecture: a layered fingerprinting stack. Catalog categories
 * nest under one of five layers, and the page renders sections in this order —
 * from the network/transport layer up through browser APIs, automation tells,
 * session behaviour, and cross-surface coherence.
 */
export interface Layer {
  id: string;
  title: string;
  /** number/total shown as a section chip, e.g. "Browser APIs 02 / 05" */
  index: number;
  blurb: string;
  /** Whether surfaces in this layer are testable from a static page. */
  testable: "yes" | "partial" | "no";
  categories: string[];
}

export const LAYERS: Layer[] = [
  {
    id: "network",
    title: "Network identity",
    index: 1,
    testable: "no",
    blurb:
      "TLS (JA3/JA4, GREASE, ALPS), HTTP/2 SETTINGS + header order, IP/proxy reputation — the transport-layer identity established before any HTML is parsed.",
    categories: [],
  },
  {
    id: "browser-apis",
    title: "Browser APIs",
    index: 2,
    testable: "yes",
    blurb:
      "Environment fingerprinting via JS APIs — canvas, WebGL, audio, fonts, navigator, screen, WebRTC, timing, codecs, sensors. The core of what a static page measures.",
    categories: [
      "canvas",
      "webgl",
      "audio",
      "fonts",
      "navigator",
      "screen",
      "window",
      "webrtc",
      "intl",
      "math",
      "css",
      "dom-layout",
      "svg",
      "media",
      "media-capabilities",
      "sensors",
      "speech",
      "storage",
      "document",
      "extensions",
      "wasm",
      "workers",
    ],
  },
  {
    id: "automation",
    title: "Automation detection",
    index: 3,
    testable: "yes",
    blurb:
      "Tells that a browser is driven by automation — webdriver flags, CDP/Playwright/Selenium residue, command-line API exposure, and an integrity 'lies detector' (patched getters, non-native toString).",
    categories: ["headless-tells", "introspection", "anti-debug"],
  },
  {
    id: "behavior",
    title: "Session & behaviour",
    index: 4,
    testable: "partial",
    blurb:
      "Input dynamics (mouse/keyboard/scroll) and timing — captured as a short live sample from the page.",
    categories: ["events", "timing"],
  },
  {
    id: "coherence",
    title: "Coherence",
    index: 5,
    testable: "yes",
    blurb:
      "The part most tools miss: individual values matter less than whether the whole profile is consistent. Cross-surface checks that catch spoofers whose values are each plausible but mutually contradictory.",
    categories: [],
  },
];

const CATEGORY_TO_LAYER = new Map<string, string>();
for (const l of LAYERS) for (const c of l.categories) CATEGORY_TO_LAYER.set(c, l.id);

export function layerForCategory(category: string): string {
  return CATEGORY_TO_LAYER.get(category) ?? "browser-apis";
}
