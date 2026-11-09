// Shared presentation of account usage, distinct from an agent's free-context energy. Pure: no host calls.
import { inText, limitsChip, limitsView } from "./energy.js";

export const LIMITS_SCREEN = Object.freeze({ x: 14, y: 32, w: 103, h: 48 });
const SLOTS = [["claude", "5H"], ["claude", "WEEK"], ["codex", "5H"], ["codex", "WEEK"]];
const known = (n) => typeof n === "number" && Number.isFinite(n);

export const usageColorKey = (pct) => !known(pct) ? "dim" : pct >= 90 ? "blocked" : pct >= 70 ? "accent" : "working";
export const usageText = (row) => known(row.usedPct) ? `${Math.round(row.usedPct)}%` : "—";

export function completeLimitRows(rows) {
  return SLOTS.map(([provider, window]) => rows.find((r) => r.provider === provider && r.window === window)
    ?? { provider, window, usedPct: null, resetsIn: null, expired: false, asOf: null, missing: true });
}

export function asOfText(row, now) {
  const date = known(row.asOf) ? new Date(row.asOf) : null;
  if (!date || !Number.isFinite(date.getTime())) return "as of unknown";
  const stamp = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const age = now < row.asOf ? "clock ahead" : `${inText(now - row.asOf)} ago`;
  return `as of ${stamp} · ${age}`;
}

export const resetText = (row) => row.expired ? "reset — no new data" : row.resetsIn ? `resets in ${row.resetsIn}` : "reset time unknown";
export const limitDescription = (row, now) => `${row.provider.toUpperCase()} ${row.window} · ${row.missing ? "no limits reported" : known(row.usedPct) ? `${usageText(row)} used` : "no data"} · ${resetText(row)} · ${asOfText(row, now)}`;

export function limitsChipView(limits, now) {
  const rows = limitsView(limits, now);
  const worst = rows.reduce((value, row) => known(row.usedPct) ? Math.max(value, row.usedPct) : value, 0);
  return { text: limitsChip(limits, now), colorKey: usageColorKey(worst), tooltip: completeLimitRows(rows).map((r) => limitDescription(r, now)).join("\n") };
}

// Four stable rows inside the sprite's safe screen rectangle; all returned geometry is scaled, sprite-local px.
export function boardRows(rows, screen = LIMITS_SCREEN, zoom = 1) {
  if (![screen.x, screen.y, screen.w, screen.h, zoom].every(known) || screen.w <= 0 || screen.h <= 0 || zoom <= 0) return [];
  const textVisible = 7 * zoom >= 7;
  const rowH = screen.h / 4;
  const pad = Math.min(2, screen.w / 20, rowH / 6);
  const rect = (x, y, w, h) => ({ x: x * zoom, y: y * zoom, w: w * zoom, h: h * zoom });
  return completeLimitRows(rows).map((row, i) => {
    const x = screen.x;
    const y = screen.y + i * rowH;
    const barX = textVisible ? screen.w * 0.46 : pad;
    const barW = textVisible ? screen.w * 0.29 : screen.w - pad * 2;
    return {
      ...row, ...rect(x, y, screen.w, rowH),
      label: `${row.provider.toUpperCase()} ${row.window === "WEEK" ? "WK" : row.window}`,
      percent: usageText(row), colorKey: usageColorKey(row.usedPct), textVisible, fontSize: 7 * zoom,
      bar: rect(x + barX, y + rowH * 0.4, barW, Math.min(3, rowH * 0.25)),
      labelBox: rect(x + pad, y + pad, screen.w * 0.44 - pad, rowH - pad * 2),
      percentBox: rect(x + screen.w * 0.77, y + pad, screen.w * 0.23 - pad, rowH - pad * 2),
      fill: known(row.usedPct) ? Math.max(0, Math.min(100, row.usedPct)) : null,
    };
  });
}
