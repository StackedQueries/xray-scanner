import type { Probe, ProbeRow } from "../types.js";
import { fnv1a } from "../hash.js";
import { rowFromCatalog } from "./util.js";

/**
 * Full WebRTC network probe — host/srflx IP discovery via STUN, ICE candidate
 * types, SDP codecs + header extensions, and RTP capabilities. This is the
 * network layer a normal fingerprint page surfaces: local IP (or mDNS-masked),
 * public IP via STUN, and the WebRTC codec/extension shape.
 */
const STUN = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];

interface Cand {
  type: string;
  address: string;
  protocol: string;
  port: number | null;
  foundation: string;
}

async function gatherWebRTC(timeoutMs: number): Promise<{
  cands: Cand[];
  sdp: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    let pc: RTCPeerConnection | null = null;
    const cands: Cand[] = [];
    let sdp = "";
    let done = false;
    const finish = (error?: string) => {
      if (done) return;
      done = true;
      try {
        pc?.close();
      } catch {
        /* ignore */
      }
      resolve({ cands, sdp, error });
    };
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: STUN }], iceCandidatePoolSize: 1 });
      pc.createDataChannel("xray");
      pc.onicecandidate = (e) => {
        const c = e.candidate;
        if (!c || !c.candidate) {
          // null candidate => gathering finished
          if (cands.some((x) => x.type === "srflx")) finish();
          return;
        }
        cands.push({
          type: (c.type as string) || parseType(c.candidate),
          address: (c.address as string) || parseField(c.candidate, 4) || "",
          protocol: (c.protocol as string) || "",
          port: c.port ?? null,
          foundation: (c.foundation as string) || "",
        });
        // Stop early once we have both a host and a server-reflexive candidate.
        if (cands.some((x) => x.type === "host") && cands.some((x) => x.type === "srflx")) finish();
      };
      pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true } as RTCOfferOptions)
        .then((offer) => {
          sdp = offer.sdp ?? "";
          return pc!.setLocalDescription(offer);
        })
        .catch((err) => finish(String(err)));
      setTimeout(() => finish(), timeoutMs);
    } catch (err) {
      finish(String(err));
    }
  });
}

function parseType(candidate: string): string {
  return (/ typ (\w+)/.exec(candidate) || [])[1] || "";
}
function parseField(candidate: string, idx: number): string {
  return candidate.split(" ")[idx] ?? "";
}

function sdpCodecs(sdp: string): string[] {
  return [...new Set((sdp.match(/a=rtpmap:\d+ ([^\s/]+)/g) || []).map((x) => x.replace(/a=rtpmap:\d+ /, "")))].sort();
}
function sdpExtensions(sdp: string): string[] {
  return [...new Set((sdp.match(/a=extmap:\d+ ([^\s\r\n]+)/g) || []).map((x) => x.replace(/a=extmap:\d+ /, "")))].sort();
}

export const webrtcNetworkProbe: Probe = {
  id: "webrtc-network",
  keys: [
    "RTCPeerConnection",
    "*.createDataChannel",
    "*.createOffer",
    "*.setLocalDescription",
    "*.onicecandidate",
    "*.candidate",
    "*.sdp",
    "*.localDescription",
    "*.iceGatheringState",
    "*.getCapabilities",
  ],
  async run(): Promise<ProbeRow[]> {
    const rows: ProbeRow[] = [];
    if (typeof RTCPeerConnection === "undefined") {
      rows.push(rowFromCatalog("RTCPeerConnection", { surface: "WebRTC", value: "RTCPeerConnection absent", present: false, verdict: "suspect", note: "WebRTC disabled — privacy browser or stripped automation env" }));
      return rows;
    }
    const { cands, sdp, error } = await gatherWebRTC(3000);

    const host = [...new Set(cands.filter((c) => c.type === "host").map((c) => c.address).filter(Boolean))];
    const srflx = [...new Set(cands.filter((c) => c.type === "srflx").map((c) => c.address).filter(Boolean))];
    const relay = [...new Set(cands.filter((c) => c.type === "relay").map((c) => c.address).filter(Boolean))];
    const types = [...new Set(cands.map((c) => c.type).filter(Boolean))].sort();
    const mdns = host.some((h) => /\.local$/i.test(h));

    // Host candidate (local IP or mDNS-masked).
    rows.push(rowFromCatalog("*.candidate", {
      surface: "WebRTC host candidate (local IP)",
      value: host.length ? host.join(", ") : error ? `error: ${error}` : "(none)",
      present: host.length > 0,
      verdict: host.some((h) => /^\d+\.\d+\.\d+\.\d+$/.test(h)) ? "suspect" : "info",
      note: mdns ? "local IP is mDNS-masked (.local) — modern Chrome default" : host.some((h) => /^\d+\.\d+\.\d+\.\d+$/.test(h)) ? "raw private IP exposed — deanonymization vector" : undefined,
      signal: { name: "webrtcHostIp", value: host.join(",") },
    }));

    // Server-reflexive candidate — the PUBLIC IP via STUN.
    rows.push(rowFromCatalog("RTCPeerConnection", {
      surface: "WebRTC public IP (STUN / srflx)",
      value: srflx.length ? srflx.join(", ") : "(none — STUN unreachable or blocked)",
      present: srflx.length > 0,
      verdict: srflx.length ? "info" : "info",
      note: srflx.length ? "public egress IP discovered via STUN — bypasses page-level IP hiding" : "no srflx candidate (sandbox / no network / blocked STUN)",
      signal: { name: "webrtcPublicIp", value: srflx.join(",") },
    }));

    rows.push(rowFromCatalog("*.iceGatheringState", {
      surface: "ICE candidate types",
      value: types.length ? types.join(", ") + (relay.length ? ` (relay: ${relay.join(",")})` : "") : "(none)",
      present: types.length > 0,
      signal: { name: "iceCandidateTypes", value: types.join(",") },
    }));

    rows.push(rowFromCatalog("*.candidate", {
      surface: "ICE foundations",
      value: [...new Set(cands.map((c) => c.foundation).filter(Boolean))].join(", ") || "(none)",
      present: cands.length > 0,
    }));

    // SDP — codecs + header extensions.
    const codecs = sdpCodecs(sdp);
    const exts = sdpExtensions(sdp);
    rows.push(rowFromCatalog("*.sdp", {
      surface: "SDP codecs (capabilities)",
      value: codecs.length ? `${codecs.length} codecs, hash ${fnv1a(codecs.join(","))}: ${codecs.slice(0, 8).join(", ")}${codecs.length > 8 ? "…" : ""}` : "(no SDP)",
      present: codecs.length > 0,
      signal: { name: "sdpCodecs", value: fnv1a(codecs.join(",")) },
    }));
    rows.push(rowFromCatalog("*.localDescription", {
      surface: "SDP header extensions (extmap)",
      value: exts.length ? `${exts.length} exts, hash ${fnv1a(exts.join(","))}` : "(none)",
      present: exts.length > 0,
      signal: { name: "sdpExtensions", value: fnv1a(exts.join(",")) },
    }));
    rows.push(rowFromCatalog("*.sdp", {
      surface: "Full SDP hash",
      value: sdp ? `${fnv1a(sdp)} (${sdp.length}b)` : "(none)",
      present: !!sdp,
      signal: { name: "sdpHash", value: sdp ? fnv1a(sdp) : "" },
    }));

    // Instance-free RTP capabilities (sender + receiver).
    const sender = (globalThis as { RTCRtpSender?: { getCapabilities?: (k: string) => { codecs?: Array<{ mimeType: string }> } | null } }).RTCRtpSender;
    if (sender?.getCapabilities) {
      const v = (sender.getCapabilities("video")?.codecs ?? []).map((c) => c.mimeType);
      const a = (sender.getCapabilities("audio")?.codecs ?? []).map((c) => c.mimeType);
      rows.push(rowFromCatalog("*.getCapabilities", {
        surface: "RTCRtpSender.getCapabilities (video/audio)",
        value: `video ${v.length} / audio ${a.length}, hash ${fnv1a([...v, ...a].join(","))}`,
        present: true,
        signal: { name: "rtcCodecs", value: fnv1a([...v, ...a].join(",")) },
      }));
    }

    rows.push(rowFromCatalog("*.createDataChannel", { surface: "*.createDataChannel", value: "exercised", present: true }));
    rows.push(rowFromCatalog("*.createOffer", { surface: "*.createOffer", value: "exercised", present: true }));
    rows.push(rowFromCatalog("*.setLocalDescription", { surface: "*.setLocalDescription", value: "exercised", present: true }));
    rows.push(rowFromCatalog("*.onicecandidate", { surface: "*.onicecandidate", value: `${cands.length} candidates gathered`, present: true }));
    return rows;
  },
};

/** Media devices — kinds + counts via enumerateDevices (labels gated by permission). */
export const mediaDevicesProbe: Probe = {
  id: "media-devices",
  keys: ["*.enumerateDevices", "*.getUserMedia"],
  async run(): Promise<ProbeRow[]> {
    const rows: ProbeRow[] = [];
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) {
      rows.push(rowFromCatalog("*.enumerateDevices", { surface: "mediaDevices.enumerateDevices", value: "absent", present: false, verdict: "suspect", note: "no mediaDevices — headless/stripped" }));
      return rows;
    }
    try {
      const devices = await md.enumerateDevices();
      const kinds = devices.map((d) => d.kind).sort();
      const counts: Record<string, number> = {};
      for (const k of kinds) counts[k] = (counts[k] ?? 0) + 1;
      const labeled = devices.filter((d) => d.label).length;
      rows.push(rowFromCatalog("*.enumerateDevices", {
        surface: "Media devices (enumerateDevices)",
        value: `${devices.length} devices: ${Object.entries(counts).map(([k, n]) => `${k}×${n}`).join(", ") || "none"}${labeled ? ` · ${labeled} labeled` : ""}`,
        present: true,
        verdict: devices.length === 0 ? "suspect" : "info",
        note: devices.length === 0 ? "zero media devices — common headless tell" : labeled ? "device labels exposed — camera/mic permission granted" : undefined,
        signal: { name: "mediaDeviceKinds", value: kinds.join(",") },
      }));
      rows.push(rowFromCatalog("*.getUserMedia", { surface: "getUserMedia", value: typeof md.getUserMedia === "function" ? "present" : "absent", present: typeof md.getUserMedia === "function" }));
    } catch (e) {
      rows.push(rowFromCatalog("*.enumerateDevices", { surface: "mediaDevices", value: `error: ${String(e)}`, present: null }));
    }
    return rows;
  },
};
