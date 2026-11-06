// What every person in the office carries, drawn the same in the tower and on the floors: a name tag that stays
// legible at any zoom (status = colour + symbol + word), a contact shadow, and calm mode (no decorative motion).
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";

const UI_FONT = "Chakra Petch";
const TAG_PX = 12; // the tag's text size; it does not shrink with the scene

// Status: colour key in the theme, a symbol and a word (never colour alone).
const LOOK = {
  working: { key: "working", mark: ">", word: "WORKING" },
  blocked: { key: "blocked", mark: "!", word: "NEEDS YOU" },
  done: { key: "done", mark: "+", word: "DONE" },
  idle: { key: "dim", mark: "-", word: "IDLE" },
};
export const statusLook = (status) => LOOK[status] ?? LOOK.idle;

// Calm mode turns off decorative loops (LEDs, glows, pulses, blinking bubbles); state stays readable without them.
let calm = false;
export const setCalm = (on) => { calm = Boolean(on); };
export const isCalm = () => calm;
export const motion = (el, prop, policy) => (calm ? el : el.loop(prop, policy));

// Name tag under a person: [mark] name, on a solid plate with a status-coloured edge.
export function nameTag(agent, address, t, maxW) {
  const look = statusLook(agent.status);
  const color = t[look.key] ?? t.foreground;
  return h_flex().flex_none().gap(4).items_center().max_w(maxW).px(5).py(1).bg(`${t.background}f2`).border_l(3).border_color(color)
    .child(div().font_family(UI_FONT).text_size(TAG_PX).text_color(color).child(look.mark))
    .child(div().min_w(0).truncate().font_family(UI_FONT).text_size(TAG_PX).text_color(agent.status === "blocked" ? color : t.foreground)
      .child(agent.tab_name || address));
}

// The tooltip of a person: name, status word and what it is doing right now.
export function personTip(agent, address, doing) {
  const look = statusLook(agent.status);
  return `${agent.tab_name || address} - ${look.word}${doing ? `: ${doing}` : ""}`;
}

// A soft dark ellipse on the floor under the feet (w, h in screen px), centred on (cx, cy) of its parent.
export const contactShadow = (cx, cy, w, h) =>
  div().absolute().left(cx - w / 2).top(cy - h / 2).w(w).h(h).rounded_full().bg("#00000073");
