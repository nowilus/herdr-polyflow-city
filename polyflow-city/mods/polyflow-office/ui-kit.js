// Stateless chrome only. Div buttons do not create keyboard focus handles or Tab stops.
import { div } from "gpui-kit";
import { motion } from "./labels.js";
import { BUTTON, FOCUS, INK_ON_ACCENT, LABEL_SIZE, RADIUS, SIGN_FONT } from "./ui-tokens.js";

const toneColor = (t, tone) => ["accent", "blocked", "solid", "working", "done", "idle", "dim", "muted", "foreground"].includes(tone) ? t[tone] : null;

export function uiButton(id, label, action, t, { on = false, title = null, tone = null, primary = false, disabled = false } = {}) {
  const color = toneColor(t, tone) ?? t.accent;
  const ink = !tone || tone === "accent" || !toneColor(t, tone) ? INK_ON_ACCENT : t.solid_foreground ?? t.background;
  return div().id(id).h(BUTTON.height).px(BUTTON.padX).flex().items_center().flex_none()
    .font_family(SIGN_FONT).text_size(BUTTON.size).rounded(RADIUS.control)
    .border(FOCUS.width).border_color(t.border)
    .bg(primary ? color : on ? `${color}26` : `${t.surface}e6`)
    .text_color(disabled ? t.dim : primary ? ink : on || toneColor(t, tone) ? color : t.muted)
    .opacity(disabled ? 0.5 : 1)
    .when(!disabled, el => el.cursor_pointer().hover(s => s.text_color(primary ? ink : t.foreground).border_color(color)))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((event, cx) => { if (!disabled) action(event, cx); })
    .when(Boolean(title), el => el.tooltip(title))
    .child(label);
}

export function uiBadge(text, t, { tone = null, pulse = false } = {}) {
  const color = toneColor(t, tone) ?? t.dim;
  const badge = div().flex_none().px(5).py(1).font_family(SIGN_FONT).text_size(LABEL_SIZE)
    .rounded(RADIUS.control).border(1).border_color(color).text_color(color).child(text);
  return pulse ? motion(badge, "opacity", { from: 0.35, to: 1, period: 900 }) : badge;
}

export function focusFrame(el, t, focused) {
  return el.border(FOCUS.width).border_color(focused ? t[FOCUS.key] : t.border);
}
