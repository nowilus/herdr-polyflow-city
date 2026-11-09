// Account-limit surfaces. Render is descriptive only; the owner view starts readers/timers in init.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, openOverlay, props, shared } from "herdr";
import { META_KEY, limitsView } from "./energy.js";
import { LIMITS_SCREEN, asOfText, boardRows, completeLimitRows, limitDescription, limitsChipView, resetText, usageColorKey, usageText } from "./limits-layout.js";
import { SIGN_FONT, TITLE_SIZE, UI_FONT } from "./ui-tokens.js";

export const LIMITS_WINDOW_KEY = "polyflow-office-limits";

export const openLimits = () => openOverlay({ kind: "window", key: LIMITS_WINDOW_KEY, mod: "polyflow-office", width: 640, height: 460, props: { limitsWindow: true } });
const closeLimits = () => closeOverlay(props()?.overlay);

export function renderLimitsChip(t, now = Date.now()) {
  const info = limitsChipView(shared(META_KEY)?.limits, now);
  if (!info.text) return null;
  return div().id("office-limits-chip").min_w(0).max_w(300).h(22).px(6).flex().items_center()
    .border(1).border_color(t[info.colorKey]).bg(t.surface).font_family(UI_FONT).text_size(11).text_color(t[info.colorKey])
    .tooltip(info.tooltip).child(div().min_w(0).truncate().child(info.text));
}

export function renderLimitsBoard(object, zoom, now, t) {
  const rows = boardRows(limitsView(shared(META_KEY)?.limits, now), LIMITS_SCREEN, zoom);
  const place = (box) => div().absolute().left(box.x).top(box.y).w(box.w).h(box.h);
  return div().id("lobby-limits-board").absolute().left(object.x * zoom).top(object.y * zoom).w(object.w * zoom).h(object.h * zoom)
    .overflow_hidden().cursor_pointer().accessibility_label("Open account usage limits")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); openLimits(); })
    .tooltip(rows.map((r) => limitDescription(r, now)).join("\n"))
    .children(rows.flatMap((row) => {
      const elements = [place(row.bar).bg(t.border).opacity(row.fill === null ? 0.3 : 1)
        .when(row.fill !== null, (el) => el.child(div().h_full().w(`${row.fill}%`).bg(t[row.colorKey])))];
      if (row.textVisible) {
        const text = (box, value) => place(box).flex().items_center().font_family(UI_FONT).text_size(row.fontSize).text_color(t.foreground)
          .child(div().min_w(0).truncate().child(value));
        elements.push(text(row.labelBox, row.label), text(row.percentBox, row.percent));
      }
      return elements;
    }));
}

export function initLimitsWindow(view, cx) {
  view.limitsFocus = cx.focus_handle();
  view.limitsFocus.focus();
  // Reset countdowns and the age update even if no provider data changes. No resources are created by render.
  cx.timer.every(1000, (cx) => cx.notify());
}

export function renderLimitsWindow(view, t, button, now = Date.now()) {
  const rows = completeLimitRows(limitsView(shared(META_KEY)?.limits, now));
  const cell = (value, width, color = t.foreground) => div().w(width).flex_none().font_family(UI_FONT).text_size(13).text_color(color).child(value);
  return v_flex().id("account-limits-window").track_focus(view.limitsFocus).size_full().min_w(0).bg(t.background).border(1).border_color(t.accent)
    .on_key_down((event, cx) => { if (event.key === "escape") { closeLimits(); cx.stop_propagation(); } })
    .child(h_flex().px(12).py(8).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(div().flex_1().font_family(SIGN_FONT).text_size(TITLE_SIZE).text_color(t.accent).child("LIMITS // ACCOUNT USAGE"))
      .child(button("limits-close", "X", () => closeLimits(), t, { title: "Close account limits" })))
    .child(v_flex().flex_1().min_h(0).gap(10).p(12).overflow_y_scrollbar()
      .child(h_flex().gap(8).child(cell("PROVIDER", 78, t.dim)).child(cell("WINDOW", 60, t.dim)).child(cell("USED", 60, t.dim))
        .child(div().flex_1().font_family(UI_FONT).text_size(13).text_color(t.dim).child("RESET")))
      .children(rows.map((row) => v_flex().id(`limit-${row.provider}-${row.window}`).gap(5).p(8).bg(t.surface).border_l(3).border_color(t[usageColorKey(row.usedPct)])
        .child(h_flex().gap(8).items_center()
          .child(cell(row.provider.toUpperCase(), 78)).child(cell(row.window, 60))
          .child(cell(usageText(row), 60, t[usageColorKey(row.usedPct)]))
          .child(div().flex_1().min_w(0).font_family(UI_FONT).text_size(13).text_color(row.expired ? t.accent : t.foreground).child(resetText(row))))
        .child(div().h(5).w_full().bg(t.border).opacity(row.usedPct === null ? 0.3 : 1)
          .when(row.usedPct !== null, (el) => el.child(div().h_full().w(`${Math.max(0, Math.min(100, row.usedPct))}%`).bg(t[usageColorKey(row.usedPct)]))))
        .child(div().font_family(UI_FONT).text_size(12).text_color(t.dim).child(row.missing ? "no limits reported · as of unknown" : asOfText(row, now)))))
      .child(div().font_family(UI_FONT).text_size(12).text_color(t.dim)
        .child("Times use your local time and mark the last reported change, not a live account check. After a reset, usage stays unknown until a new report.")));
}
