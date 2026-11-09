// Live, code-drawn E battery. Shared with the tree through scripts/copies.mjs, not cross-mod imports.
import { div } from "gpui-kit";
import { detailsLine } from "./energy.js";
import { energyPill } from "./energy-pill.js";
import { ENERGY_RADIUS, UI_FONT } from "./ui-tokens.js";

export function renderEnergyPill(meta, t, opts = {}) {
  const p = energyPill(meta, opts.scale, opts);
  const color = p.level === "ok" ? "#57df9c" : p.level === "low" ? t.accent : p.level === "critical" ? t.blocked : t.dim;
  const pulse = p.level === "critical" && !opts.calm;
  const frameW = p.w - 3;
  const track = opts.compact ? { x: 25, y: 4, w: frameW - 29, h: 6 }
    : { x: 5, y: p.h >= 28 ? p.h - 8 : p.h - 6, w: frameW - 10, h: p.h >= 28 ? 5 : 4 };
  const text = (value, size) => div().font_family(UI_FONT).font_semibold().text_size(size).text_color("#e8f0f7").child(value);
  let outline = div().absolute().left(0).top(0).w(frameW).h(p.h).rounded(ENERGY_RADIUS).border(1).border_color(color);
  if (pulse) outline = outline.loop("opacity", { from: 0.25, to: 1, period: 900 });
  return div().id(opts.id ?? "context-pill").relative().flex_none().w(p.w).h(p.h).opacity(p.dim ? 0.4 : 1)
    .tooltip(detailsLine(meta)).accessibility_label(`Context: ${detailsLine(meta)}`)
    .child(div().absolute().right(0).top(Math.round(p.h * 0.35)).w(3).h(Math.round(p.h * 0.3)).bg(color))
    .child(div().absolute().left(0).top(0).w(frameW).h(p.h).rounded(ENERGY_RADIUS).bg("#0b151c").border(1).border_color("#394856"))
    .child(outline)
    .when(!opts.compact, (el) => el.child(text("CTX", p.h >= 28 ? 10 : 9).absolute().left(6).top(1)))
    .child(text(p.text, opts.compact ? 9 : p.h >= 28 ? 12 : 10).absolute().top(opts.compact ? 0 : 1)
      .when(opts.compact, (el) => el.left(4)).when(!opts.compact, (el) => el.right(9)))
    .child(div().absolute().left(track.x).top(track.y).w(track.w).h(track.h).bg("#283744").border(1).border_color("#6e8296")
      .child(div().h_full().w(`${p.fillPct}%`).bg(color)));
}
