/**
 * Script cross-reference. Paste a script you came across (a bot-detection
 * challenge, a tracker, a captured payload) and statically analyze it with
 * `script2builtins` — the same catalog xray-scanner probes. We then join the
 * catalog APIs the script *touches* against what this browser/bot actually
 * *returns* for each, so you can see, surface by surface, how your client
 * answers the exact questions a detector asks.
 */
// Static analyzer pulled from npm. Vite bundles it (acorn + the
// script2builtins-knowledge catalog) into the GitHub Pages build.
import { analyze } from "script2builtins";
import type { ProbeRow } from "./types.js";

export interface XrefRow {
  key: string;
  category: string;
  severity: string;
  tell: boolean;
  measured: boolean;
  ourValue: string;
  ourVerdict: string;
}

export interface XrefHazard {
  type: string;
  detail: string;
}

export interface XrefReport {
  ok: boolean;
  error?: string;
  surfaces: number;
  tells: number;
  measured: number;
  rows: XrefRow[];
  hazards: XrefHazard[];
  sinks: number;
  structural: string[];
  summary: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function crossReference(source: string, rowsByKey: Map<string, ProbeRow[]>): XrefReport {
  if (!source.trim()) {
    return { ok: false, error: "empty input", surfaces: 0, tells: 0, measured: 0, rows: [], hazards: [], sinks: 0, structural: [], summary: "" };
  }
  let report: any;
  try {
    report = analyze(source);
  } catch (e) {
    return { ok: false, error: String(e), surfaces: 0, tells: 0, measured: 0, rows: [], hazards: [], sinks: 0, structural: [], summary: "" };
  }
  if (report?.parse && report.parse.ok === false) {
    return { ok: false, error: `parse failed: ${(report.parse.errors || []).map((x: any) => x.message).join("; ") || "unknown"}`, surfaces: 0, tells: 0, measured: 0, rows: [], hazards: [], sinks: 0, structural: [], summary: "" };
  }

  const findings: any[] = report.findings || [];
  const rows: XrefRow[] = findings.map((f) => {
    const key = f.api.key as string;
    const our = rowsByKey.get(key);
    // Prefer a curated (non-auto) measured row when present.
    const best = our?.find((r) => !r.auto) ?? our?.[0];
    return {
      key,
      category: f.api.category,
      severity: f.api.severity,
      tell: !!f.api.botDetectionTell,
      measured: !!best && best.present !== false,
      ourValue: best ? best.value : "(not probed)",
      ourVerdict: best ? best.verdict : "info",
    };
  });
  rows.sort((a, b) => Number(b.tell) - Number(a.tell) || a.category.localeCompare(b.category) || a.key.localeCompare(b.key));

  const hazards: XrefHazard[] = (report.hazards || []).map((h: any) => ({ type: h.kind || h.type || "hazard", detail: h.detail || h.snippet || "" }));

  // Structural / vendor signals the analyzer surfaces.
  const structural: string[] = [];
  const s = report.structural || {};
  if (s.vmBytecode?.detected) structural.push("VM-bytecode pattern (Botguard/Turnstile-style attestation VM)");
  if (s.consistencyChecks?.length) structural.push(`${s.consistencyChecks.length} environment consistency-check pattern(s)`);
  if (s.highResTimer) structural.push("high-resolution timer / chronometric probe");
  if (s.cognitiveHoneypots?.length) structural.push(`${s.cognitiveHoneypots.length} honeypot pattern(s)`);
  for (const sink of report.networkSinks || []) {
    if (sink.classification && sink.classification !== "unknown") structural.push(`endpoint: ${sink.classification}`);
  }

  const tells = rows.filter((r) => r.tell).length;
  const measured = rows.filter((r) => r.measured).length;
  const summary =
    `Script touches ${rows.length} catalog surface${rows.length === 1 ? "" : "s"} (${tells} bot-detection tell${tells === 1 ? "" : "s"}); ` +
    `this client has a measured value for ${measured} of them. ` +
    `${hazards.length} dynamic-execution hazard${hazards.length === 1 ? "" : "s"}.`;

  return { ok: true, surfaces: rows.length, tells, measured, rows, hazards, sinks: (report.networkSinks || []).length, structural: [...new Set(structural)], summary };
}
