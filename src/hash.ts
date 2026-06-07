/**
 * Deterministic, dependency-free hashing so two runs (real browser vs bot)
 * produce diffable, stable fingerprints. FNV-1a (32-bit) rendered as 8 hex
 * chars — not cryptographic, just a stable content digest.
 */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Hash a list of {key,value} pairs in a stable (sorted) order. */
export function hashPairs(pairs: Array<{ key: string; value: string }>): string {
  const sorted = [...pairs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return fnv1a(sorted.map((p) => `${p.key}=${p.value}`).join("\n"));
}
