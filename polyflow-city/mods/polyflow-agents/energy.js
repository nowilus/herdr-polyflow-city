// The office's "energy" of an agent (how much of its context window is still free), the line that describes it, and
// the account limits (5 hours, week) as rows and as a short chip. Pure (no host calls), so node can test it;
// polyflow-agents keeps a byte-identical copy (scripts/copies.mjs).
//
// The data is hooks/statusline.mjs (Claude Code) and hooks/agent-meta.mjs (Codex): files per terminal,
//   Meta:   { v: 1, at, provider, model, modelId?, effort, context: { usedPct, size, used? } }
//   Limits: { v: 1, at, asOf?, fiveHour: { usedPct, resetsAt (seconds) } | null, sevenDay: ... | null }
// Every field may be null (never 0 for "unknown"). Note: `at` of a meta file moves only when its content does, so it
// says nothing about how fresh the data is; nothing here treats it as freshness.

import { withHelpers } from "./activity.js";

export const META_KEY = "polyflow-office.meta"; // shared state: { agents: { [address]: Meta }, limits: { claude, codex }, at }
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// The reader's answer (hooks/agent-meta.mjs) -> { agents: { [address]: Meta }, limits: { claude, codex } }, or null if it
// isn't one.
export function metaFrom(out) {
  if (out === null || typeof out !== "object" || out.meta === null || typeof out.meta !== "object" || Array.isArray(out.meta)) return null;
  const l = out.limits && typeof out.limits === "object" ? out.limits : {};
  return { agents: out.meta, limits: { claude: l.claude ?? null, codex: l.codex ?? null } };
}

// The local terminals worth asking about: the agents Herdr knows and the hc helpers among its terminals (not terminals
// closed long ago, whose files are still on disk).
export function liveLocalTerminals(list, allTerminals) {
  return [...new Set(withHelpers(list ?? [], allTerminals ?? []).map((a) => a.address))].filter((id) => LOCAL_ID.test(id));
}

// Free context: green from 30%, yellow from 10%, red below.
export const OK_FREE_PCT = 30;
export const LOW_FREE_PCT = 10;

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 950, 312k, 1M, 1.05M
export function shortCount(n) {
  if (!finite(n) || n < 0) return null;
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(2))}M`;
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
}

// How much of the window is used (0..100), from the percentage the provider gave or from used / size; null if neither.
export function usedPctOf(context) {
  if (!context || typeof context !== "object") return null;
  if (finite(context.usedPct)) return clamp(context.usedPct, 0, 100);
  if (finite(context.used) && finite(context.size) && context.size > 0) return clamp((context.used / context.size) * 100, 0, 100);
  return null;
}

// -> { freePct (whole number, or null), level: "ok" | "low" | "critical" | "unknown", stale }.
// `nowMs` is part of the signature for the callers that have it; the level does not depend on time. `stale` is true
// only when the caller says so (opts.stale): the data has no freshness of its own (see the note at the top).
export function energyOf(meta, nowMs, opts = {}) {
  const stale = opts?.stale === true;
  const used = usedPctOf(meta?.context);
  if (used === null) return { freePct: null, level: "unknown", stale };
  const freePct = clamp(Math.round(100 - used), 0, 100);
  return { freePct, level: freePct >= OK_FREE_PCT ? "ok" : freePct >= LOW_FREE_PCT ? "low" : "critical", stale };
}

// The tokens in use, when known: given, or worked out from the percentage and the window.
export function usedCount(context) {
  if (!context) return null;
  if (finite(context.used)) return context.used;
  const pct = finite(context.usedPct) ? context.usedPct : null;
  return pct !== null && finite(context.size) ? Math.round((pct / 100) * context.size) : null;
}

// The tokens in use against the window: "312k / 1M", "312k used" (no window), or null when the count is unknown.
export function contextText(context) {
  const used = shortCount(usedCount(context));
  const size = shortCount(context?.size);
  return used && size ? `${used} / ${size}` : used ? `${used} used` : null;
}

// "Claude Opus 5.5 · effort high · 312k / 1M · 69% free"; a part that isn't known is left out; nothing known says so.
// A subagent's line ends with "subagent".
export function detailsLine(meta) {
  if (!meta || typeof meta !== "object") return "no data yet";
  const free = energyOf(meta).freePct;
  const parts = [
    meta.model || meta.modelId || null,
    meta.effort ? `effort ${meta.effort}` : null,
    contextText(meta.context),
    free !== null ? `${free}% free` : null,
  ].filter(Boolean);
  if (parts.length === 0) return "no data yet";
  return (meta.subagent ? [...parts, "subagent"] : parts).join(" · ");
}

// The meta of an agent by its address: its own, or for an internal subagent ("<agent>~<id>") one made from what
// hooks/subagents.mjs found (the size of its last request) and its agent's model and window. null when there is none.
// agentsMeta: shared META_KEY's `agents`; subagents: shared SUBAGENTS_KEY ({ [agent]: [{ id, context }] }).
export function metaOfAgent(address, agentsMeta, subagents) {
  const own = agentsMeta?.[address];
  if (own && typeof own === "object") return own;
  const m = typeof address === "string" ? address.match(/^([A-Za-z0-9][\w-]*)~([\w-]{1,64})$/) : null;
  if (!m) return null;
  const used = (subagents?.[m[1]] ?? []).find((s) => s?.id === m[2])?.context?.used;
  if (!finite(used) || used < 0) return null;
  const parent = agentsMeta?.[m[1]];
  return { v: 1, at: null, provider: parent?.provider ?? null, model: parent?.model ?? null, effort: null, context: { usedPct: null, size: parent?.context?.size ?? null, used }, source: "subagent", subagent: true };
}

// "<1 min", "14 min", "2 h 14 min", "3 d 4 h"
export function inText(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

const WINDOWS = [["fiveHour", "5H", "5H"], ["sevenDay", "WEEK", "WK"]];
const PROVIDERS = [["claude", "C"], ["codex", "X"]];

// One window of one provider as the board shows it. A window whose reset time has passed holds numbers from before
// the reset: they are not shown (usedPct null) and the row says so.
function windowRow(provider, label, w, limits, nowMs) {
  const resetsMs = finite(w.resetsAt) ? w.resetsAt * 1000 : null;
  const over = resetsMs !== null && resetsMs <= nowMs;
  return {
    provider, window: label, usedPct: over ? null : finite(w.usedPct) ? w.usedPct : null,
    resetsIn: over ? "reset — no new data" : resetsMs !== null ? inText(resetsMs - nowMs) : null,
    expired: over, asOf: finite(limits.asOf) ? limits.asOf : finite(limits.at) ? limits.at : null,
  };
}

// limits: { claude, codex } (agent-meta.mjs's) -> rows { provider, window: "5H" | "WEEK", usedPct, resetsIn, expired, asOf }
// in the order claude 5H, claude WEEK, codex 5H, codex WEEK. A provider or window without data has no row.
export function limitsView(limits, nowMs) {
  const rows = [];
  for (const [provider] of PROVIDERS) {
    const l = limits?.[provider];
    if (!l || typeof l !== "object") continue;
    for (const [key, label] of WINDOWS) if (l[key] && typeof l[key] === "object") rows.push(windowRow(provider, label, l[key], l, nowMs));
  }
  return rows;
}

// A short text for the office bar: "C 5H 35% · WK 21% | X 5H 12% · WK 40%". A provider with nothing to say is left out,
// and so is a window that has been reset since the numbers were taken; no data at all is "".
export function limitsChip(limits, nowMs) {
  const rows = limitsView(limits, nowMs).filter((r) => r.usedPct !== null);
  const segments = [];
  for (const [provider, letter] of PROVIDERS) {
    const own = rows.filter((r) => r.provider === provider);
    if (own.length === 0) continue;
    segments.push(`${letter} ${own.map((r) => `${WINDOWS.find((w) => w[1] === r.window)[2]} ${Math.round(r.usedPct)}%`).join(" · ")}`);
  }
  return segments.join(" | ");
}

// What the chat's SESSION shows: the provider's meta where there is some, the conversation's own figures as a fallback.
// session: chat-model.js's SessionInfo or undefined. -> { model, effort, context: { usedPct, size, used } }
export function sessionContext(meta, session) {
  const tokens = session?.tokens ?? null;
  const fallback = { usedPct: null, size: finite(tokens?.contextWindow) ? tokens.contextWindow : null, used: finite(tokens?.context) ? tokens.context : null };
  const own = meta?.context && (usedPctOf(meta.context) !== null || finite(meta.context.size)) ? meta.context : null;
  return {
    model: meta?.model || meta?.modelId || session?.model || null,
    effort: meta?.effort || null,
    context: own ?? fallback,
  };
}
