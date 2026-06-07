/**
 * Cross-session / dynamic identity tracking — "does the page think you're a
 * new user or a returning one, even if you tried to look new?"
 *
 * Two independent re-identification mechanisms, combined:
 *
 *  1. A visitor ID written redundantly across many storage backends
 *     (localStorage, sessionStorage, cookie, IndexedDB, Cache Storage,
 *     window.name) — the evercookie pattern. Clearing *some* but not *all*
 *     of them (the common "I cleared my cookies" bot move) is detected: the
 *     ID is recovered from a survivor and re-propagated.
 *  2. The storage-independent **stable fingerprint**. If a visitor ID
 *     survives but the fingerprint changed, the environment is being spoofed;
 *     if the fingerprint matches a previously-seen one, we knew you anyway.
 *
 * Scope: a *full* wipe of all client storage on the same device looks like a
 * new visitor to a static, server-less page; persistent cross-device identity
 * is a server-side concern beyond this client-only scanner.
 */

export interface IdentityRecord {
  v: 1;
  visitorId: string;
  firstSeen: string;
  visits: number;
  fingerprints: string[];
  lastFingerprint: string;
}

export type IdentityVerdict = "new" | "returning" | "reset-attempt" | "spoof-suspect";

export interface BackendStatus {
  name: string;
  durable: boolean;
  present: boolean;
  error: boolean;
}

export interface IdentityReport {
  verdict: IdentityVerdict;
  visitorId: string;
  shortId: string;
  visits: number;
  firstSeen: string;
  currentFingerprint: string;
  fingerprintKnown: boolean;
  fingerprintChanged: boolean;
  knownFingerprints: number;
  backends: BackendStatus[];
  durableSurvivors: string[];
  durableCleared: string[];
  note: string;
}

interface Backend {
  name: string;
  durable: boolean;
  get(): Promise<IdentityRecord | null>;
  set(r: IdentityRecord): Promise<void>;
  clear(): Promise<void>;
}

const KEY = "xray:id";
const COOKIE = "xray_id";
const CACHE_NAME = "xray-id";
const CACHE_URL = "/__xray_identity";
const IDB_NAME = "xray";
const IDB_STORE = "id";

function parse(s: string | null): IdentityRecord | null {
  if (!s) return null;
  try {
    const r = JSON.parse(s) as IdentityRecord;
    return r && r.visitorId ? r : null;
  } catch {
    return null;
  }
}

const localBackend: Backend = {
  name: "localStorage",
  durable: true,
  async get() {
    return parse(localStorage.getItem(KEY));
  },
  async set(r) {
    localStorage.setItem(KEY, JSON.stringify(r));
  },
  async clear() {
    localStorage.removeItem(KEY);
  },
};

const sessionBackend: Backend = {
  name: "sessionStorage",
  durable: false, // per-tab; cleared on tab close — ephemeral
  async get() {
    return parse(sessionStorage.getItem(KEY));
  },
  async set(r) {
    sessionStorage.setItem(KEY, JSON.stringify(r));
  },
  async clear() {
    sessionStorage.removeItem(KEY);
  },
};

const cookieBackend: Backend = {
  name: "cookie",
  durable: true,
  async get() {
    const m = document.cookie.split("; ").find((c) => c.startsWith(COOKIE + "="));
    return m ? parse(decodeURIComponent(m.slice(COOKIE.length + 1))) : null;
  },
  async set(r) {
    document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(r))}; path=/; max-age=31536000; SameSite=Lax`;
  },
  async clear() {
    document.cookie = `${COOKIE}=; path=/; max-age=0`;
  },
};

const windowNameBackend: Backend = {
  name: "window.name",
  durable: false, // survives same-tab navigation/reload; cleared on new tab
  async get() {
    return window.name.startsWith("xray:") ? parse(window.name.slice(5)) : null;
  },
  async set(r) {
    window.name = "xray:" + JSON.stringify(r);
  },
  async clear() {
    if (window.name.startsWith("xray:")) window.name = "";
  },
};

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function openIdb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const o = indexedDB.open(IDB_NAME, 1);
    o.onupgradeneeded = () => o.result.createObjectStore(IDB_STORE);
    o.onsuccess = () => res(o.result);
    o.onerror = () => rej(o.error);
  });
}
const idbBackend: Backend = {
  name: "IndexedDB",
  durable: true,
  async get() {
    const db = await openIdb();
    try {
      const v = await idbReq(db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get("record"));
      return parse(typeof v === "string" ? v : null);
    } finally {
      db.close();
    }
  },
  async set(r) {
    const db = await openIdb();
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(JSON.stringify(r), "record");
      await new Promise<void>((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } finally {
      db.close();
    }
  },
  async clear() {
    const db = await openIdb();
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete("record");
      await new Promise<void>((res) => {
        tx.oncomplete = () => res();
        tx.onerror = () => res();
      });
    } finally {
      db.close();
    }
  },
};

const cacheBackend: Backend = {
  name: "Cache Storage",
  durable: true,
  async get() {
    if (!("caches" in window)) return null;
    const c = await caches.open(CACHE_NAME);
    const r = await c.match(CACHE_URL);
    return r ? parse(await r.text()) : null;
  },
  async set(r) {
    if (!("caches" in window)) return;
    const c = await caches.open(CACHE_NAME);
    await c.put(CACHE_URL, new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } }));
  },
  async clear() {
    if (!("caches" in window)) return;
    await caches.delete(CACHE_NAME);
  },
};

const BACKENDS: Backend[] = [localBackend, sessionBackend, cookieBackend, windowNameBackend, idbBackend, cacheBackend];

/** Durable backends a naive "clear my cookies" reset leaves behind, for the demo. */
const COMMON_RESET_BACKENDS = new Set(["localStorage", "sessionStorage", "cookie"]);

function uuid(): string {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  const b = new Uint8Array(16);
  (crypto?.getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => (b[i] = Math.floor(Math.random() * 256))));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function safeGet(b: Backend): Promise<{ rec: IdentityRecord | null; error: boolean }> {
  try {
    return { rec: await b.get(), error: false };
  } catch {
    return { rec: null, error: true };
  }
}

/** Read all backends, decide new vs returning, heal (respawn) the record. */
export async function identify(currentFingerprint: string, nowIso: string): Promise<IdentityReport> {
  const reads = await Promise.all(BACKENDS.map(async (b) => ({ b, ...(await safeGet(b)) })));

  const found = reads.filter((r) => r.rec).map((r) => r.rec!) as IdentityRecord[];
  const durableReads = reads.filter((r) => r.b.durable && !r.error);
  const durableSurvivors = durableReads.filter((r) => r.rec).map((r) => r.b.name);
  const durableCleared = durableReads.filter((r) => !r.rec).map((r) => r.b.name);

  let record: IdentityRecord;
  let verdict: IdentityVerdict;
  let note = "";

  if (found.length === 0) {
    // No surviving identity anywhere → genuinely new (or a full wipe, which a
    // static page cannot distinguish — noted honestly).
    record = { v: 1, visitorId: uuid(), firstSeen: nowIso, visits: 1, fingerprints: [currentFingerprint], lastFingerprint: currentFingerprint };
    verdict = "new";
    note =
      "No prior identity in any client store. Treated as a NEW visitor. (A full wipe of all client storage on a returning device is indistinguishable from new without a server-side fingerprint graph.)";
  } else {
    // Merge surviving records: authoritative = most visits, earliest firstSeen.
    const auth = found.slice().sort((a, b) => b.visits - a.visits || a.firstSeen.localeCompare(b.firstSeen))[0]!;
    const allFps = new Set<string>();
    for (const r of found) for (const f of r.fingerprints) allFps.add(f);
    const fingerprintKnown = allFps.has(currentFingerprint);
    allFps.add(currentFingerprint);

    record = {
      v: 1,
      visitorId: auth.visitorId,
      firstSeen: found.map((r) => r.firstSeen).sort()[0]!,
      visits: Math.max(...found.map((r) => r.visits)) + 1,
      fingerprints: [...allFps].slice(-12),
      lastFingerprint: currentFingerprint,
    };

    const fingerprintChanged = auth.lastFingerprint !== currentFingerprint;

    if (durableSurvivors.length > 0 && durableCleared.length > 0) {
      verdict = "reset-attempt";
      note = `Recovered your visitor ID from ${durableSurvivors.join(", ")} after ${durableCleared.join(", ")} ${durableCleared.length === 1 ? "was" : "were"} cleared. You are NOT a new user — this is a storage-reset attempt.`;
    } else if (!fingerprintKnown && fingerprintChanged) {
      verdict = "spoof-suspect";
      note = "Same stored visitor ID, but the device fingerprint changed since the last visit — the environment is being spoofed across sessions.";
    } else {
      verdict = "returning";
      note = "Known visitor ID present in client storage and the fingerprint matches. Returning user.";
    }
  }

  // Heal / respawn: write the (updated) record back to every backend so the
  // identity gets *harder* to clear over time.
  await Promise.all(BACKENDS.map((b) => b.set(record).catch(() => {})));

  return {
    verdict,
    visitorId: record.visitorId,
    shortId: record.visitorId.replace(/-/g, "").slice(0, 12),
    visits: record.visits,
    firstSeen: record.firstSeen,
    currentFingerprint,
    fingerprintKnown: found.some((r) => r.fingerprints.includes(currentFingerprint)),
    fingerprintChanged: found.length > 0 && !found.some((r) => r.lastFingerprint === currentFingerprint),
    knownFingerprints: record.fingerprints.length,
    backends: reads.map((r) => ({ name: r.b.name, durable: r.b.durable, present: !!r.rec, error: r.error })),
    durableSurvivors,
    durableCleared,
    note,
  };
}

/** Demo: clear the stores a naive "I'll look like a new user" reset clears,
 * leaving the deeper evercookie backends — so the next load still recognises you. */
export async function simulateNewUser(): Promise<void> {
  for (const b of BACKENDS) if (COMMON_RESET_BACKENDS.has(b.name)) await b.clear().catch(() => {});
}

/** Genuinely wipe every identity backend (and let the caller clear the FP baseline). */
export async function fullReset(): Promise<void> {
  await Promise.all(BACKENDS.map((b) => b.clear().catch(() => {})));
}
