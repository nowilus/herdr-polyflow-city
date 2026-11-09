// What every person in the office carries, drawn the same in the tower and on the floors: a name tag that stays
// legible at any zoom (status = colour + symbol + word), a contact shadow, and calm mode (no decorative motion).
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, setShared } from "herdr";
import { META_KEY, detailsLine, metaOfAgent } from "./energy.js";
import { SUBAGENTS_KEY } from "./chat-model.js";
import { CALM_KEY, energyPill, placeEnergyPills } from "./energy-pill.js";
import { renderEnergyPill } from "./energy-pill-ui.js";
import { BODY_SIZE, UI_FONT } from "./ui-tokens.js";

const TAG_PX = BODY_SIZE; // the tag's text size; it does not shrink with the scene

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
// Local appHome only. The main office requests prefs writes; SCREEN applies reads without echoing them back.
export const setCalm = (on) => { calm = Boolean(on); setShared(CALM_KEY, calm); };
export const isCalm = () => shared(CALM_KEY) ?? calm;
export const motion = (el, prop, policy) => (isCalm() ? el : el.loop(prop, policy));

// Reading shared data during render is side-effect free. Internal helpers borrow their parent's window, not usage.
export const personMeta = (address) => metaOfAgent(address, shared(META_KEY)?.agents, shared(SUBAGENTS_KEY));

export function energyPills(entries, t, scale = 1) {
  const items = entries.map((entry) => {
    const meta = personMeta(entry.address);
    const stale = shared(META_KEY)?.stale === true || meta?.stale === true;
    const p = energyPill(meta, scale, { stale });
    return { ...entry, ...p, id: entry.address, meta, stale, x: entry.x - p.w / 2, y: entry.y - p.h - 6 };
  });
  return placeEnergyPills(items).map((p) => div().id(`energy-pill-${p.id}`).absolute().left(p.x).top(p.y).w(p.w).h(p.h)
    .transition("left", { duration: p.msX ?? 1, easing: "linear" })
    .transition("top", { duration: p.msY ?? 1, easing: p.easing ?? "linear" })
    .child(renderEnergyPill(p.meta, t, { id: `ctx-${p.id}`, scale, stale: p.stale, calm: isCalm() })));
}

// Name tag under a person: [mark] name, on a solid plate with a status-coloured edge.
export function nameTag(agent, address, t, maxW) {
  const look = statusLook(agent.status);
  const color = t[look.key] ?? t.foreground;
  const meta = personMeta(address);
  return h_flex().relative().flex_none().gap(4).items_center().max_w(maxW).px(5).py(1).bg(`${t.background}f2`).border_l(3).border_color(color)
    .tooltip(detailsLine(meta))
    .child(div().font_family(UI_FONT).text_size(TAG_PX).text_color(color).child(look.mark))
    .child(div().min_w(0).truncate().font_family(UI_FONT).text_size(TAG_PX).text_color(agent.status === "blocked" ? color : t.foreground)
      .child(agent.tab_name || address));
}

// The tooltip of a person: name, status word and what it is doing right now.
export function personTip(agent, address, doing) {
  const look = statusLook(agent.status);
  return `${agent.tab_name || address} - ${look.word}${doing ? `: ${doing}` : ""} · ${detailsLine(personMeta(address))}`;
}

// A soft dark ellipse on the floor under the feet (w, h in screen px), centred on (cx, cy) of its parent.
export const contactShadow = (cx, cy, w, h) =>
  div().absolute().left(cx - w / 2).top(cy - h / 2).w(w).h(h).rounded_full().bg("#00000073");
