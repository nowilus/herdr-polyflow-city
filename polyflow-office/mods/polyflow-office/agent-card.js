// The agent card: what a click (or right-click) on an agent opens, in the tower, on a floor or in a list. The click
// has already focused the agent; the card says what it is doing and offers the next steps: its terminal, the
// floating chat, a quick message, stop, rename and close. A popup at the pointer, drawn by this same mod.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, closeOverlay, hc, openOverlay, panes, props, run, spaces, terminals } from "herdr";
import { withHelpers } from "./activity.js";
import { lifeOf } from "./chat-model.js";

const W = 330;
const H = 236;
const UI_FONT = "Chakra Petch";
const SIGN_FONT = "Silkscreen";
const STATUS = { working: "WORKING", blocked: "NEEDS YOU", done: "DONE", idle: "IDLE" };
const TONE = { working: "working", blocked: "blocked", done: "done" };

// card: { address, demo, name, status, doing } — a snapshot, so demo agents (not in agents()) get a card too.
export function openAgentCard(card) {
  if (!card?.address) return null;
  return openOverlay({ kind: "popup", at: "pointer", width: W, height: H, frame: "none", mod: "polyflow-office", props: { agentCard: card } });
}

// The card's own state on the view: which step is showing and what is being typed.
export function initCard(view, cx) {
  view.card = { step: "menu", text: "", note: null, busy: false };
  view.cardFocus = cx.focus_handle();
  view.cardFocus.focus();
  // The card may stay open while the agent changes (status, name) or goes away.
  cx.timer.every(1000, (cx) => cx.notify());
}

const live = (address) => withHelpers(agents(), terminals()).find((a) => a.address === address) ?? null;

function step(view, name, text = "") {
  view.card = { ...view.card, step: name, text, note: null };
}

async function sendMessage(view, address, cx) {
  const text = view.card.text.trim();
  if (!text || view.card.busy) return;
  // Enter on an approval menu would pick an option: no typing into a waiting agent.
  if (live(address)?.status === "blocked") {
    view.card = { ...view.card, note: "It's waiting for your answer: answer in its terminal." };
    cx.notify();
    return;
  }
  view.card = { ...view.card, busy: true };
  cx.notify();
  const r = await hc(["send", address, text]).catch((e) => ({ code: 1, stderr: String(e) }));
  const queued = live(address)?.status === "working";
  // Sent: clear only the text that went (anything typed meanwhile stays); keep whatever step the person is on now.
  const now = view.card;
  view.card = r.code === 0
    ? { ...now, step: now.step === "message" ? "menu" : now.step, text: now.text.trim() === text ? "" : now.text, busy: false, note: queued ? "Sent while it works, just as if typed in its terminal." : "Sent." }
    : { ...now, busy: false, note: `Not sent: ${(r.stderr || "hc send failed").trim().slice(0, 120)}` };
  cx.notify();
}

async function stopAgent(view, address, cx) {
  view.card = { ...view.card, busy: true };
  cx.notify();
  const r = await hc(["interrupt", address]).catch((e) => ({ code: 1, stderr: String(e) }));
  view.card = { ...view.card, busy: false, note: r.code === 0 ? "Stop key sent." : `Couldn't stop: ${(r.stderr || "").trim().slice(0, 120)}` };
  cx.notify();
}

// Both act on the agent as it is at the click (its tab may have changed since the card was drawn).
function rename(view, address) {
  const agent = live(address);
  const name = view.card.text.trim();
  if (agent && name && !agent.paneless) run("tab.rename", { id: agent.tab, name });
  step(view, "menu");
}

// Helpers without a pane of their own that live in this agent's tab: closing the tab would end them too.
const tabHelpers = (agent) => withHelpers(agents(), terminals()).filter((a) => a.paneless && a.tab === agent.tab);

// Its tab goes only when it holds nothing else (no other pane, terminal or mod, and no helper); otherwise only its
// terminal ends.
function closeAgent(address) {
  const agent = live(address);
  if (!agent) return;
  if (agent.paneless) return run("terminal.kill", { terminal: agent.address });
  const others = panes().some((p) => p.tab === agent.tab && p.pane !== agent.pane);
  if (others || tabHelpers(agent).length) run("terminal.kill", { terminal: agent.address });
  else run("tab.close", { id: agent.tab, confirmed: true });
}

// Typing in the message and rename steps (Enter: do it, Esc: back to the menu).
export function cardKey(view, e, cx, card, deps) {
  const s = view.card.step;
  const close = () => closeOverlay(props()?.overlay);
  if (e.key === "escape") {
    if (s === "menu") close();
    else step(view, "menu");
  } else if (s === "message" || s === "rename") {
    const agent = live(card.address);
    if (e.key === "enter") {
      if (!agent) return;
      if (s === "message") sendMessage(view, card.address, cx);
      else rename(view, card.address);
    } else if (e.key === "backspace") view.card = { ...view.card, text: view.card.text.slice(0, -1) };
    else if (e.key_char && !e.modifiers.control && !e.modifiers.platform) view.card = { ...view.card, text: view.card.text + e.key_char };
    else return;
  } else if (s === "menu" && e.key === "enter") {
    deps.showTerminal(card.address);
    close();
  } else return;
  cx.stop_propagation();
  cx.notify();
}

function field(view, t, placeholder) {
  const text = view.card.text;
  return h_flex().h(26).px(6).items_center().bg(t.canvas).border(1).border_color(t.accent).overflow_hidden()
    .font_family(UI_FONT).text_size(12)
    .child(div().text_color(text ? t.foreground : t.dim).child(text || placeholder))
    .child(div().w(1).h(14).bg(t.accent).loop("opacity", { from: 0, to: 1, period: 1000 }));
}

// deps: { button(id, label, action, t, opts), showTerminal(address), openChatFor(address) | null }
export function renderAgentCard(view, t, deps) {
  const card = props()?.agentCard ?? {};
  const agent = card.demo ? null : live(card.address);
  const status = agent?.status ?? card.status ?? "idle";
  const name = agent?.tab_name || card.name || card.address;
  const space = agent ? spaces().find((s) => s.id === agent.space)?.name : null;
  const tone = t[TONE[status]] ?? t.dim;
  const close = () => closeOverlay(props()?.overlay);
  const act = (fn) => (_e, cx) => { fn(cx); cx.notify(); };
  const b = (id, label, fn, opts) => deps.button(`card-${id}`, label, act(fn), t, opts);
  const s = view.card.step;

  const head = v_flex().gap(2)
    .child(h_flex().gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().font_family(UI_FONT).text_size(15).text_color(t.foreground).child(name))
      .child(div().px(5).py(1).font_family(SIGN_FONT).text_size(9).text_color(tone).border(1).border_color(tone).child(STATUS[status] ?? status.toUpperCase())))
    .child(div().truncate().font_family(UI_FONT).text_size(11).text_color(t.dim)
      .child([agent?.program?.name, space, card.address].filter(Boolean).join(" · ")));
  const doing = div().font_family(UI_FONT).text_size(12).text_color(t.muted)
    .child(card.doing ?? (status === "blocked" ? "Waiting for your answer: open its terminal." : status === "working" ? "working" : "resting"));

  let body;
  if (card.demo) {
    body = div().font_family(UI_FONT).text_size(12).text_color(t.dim).child("A made-up demo agent: nothing to open.");
  } else if (!agent) {
    body = div().font_family(UI_FONT).text_size(12).text_color(t.dim)
      .child(lifeOf(card.address, agents(), terminals()) === "ended" ? "This agent has ended." : "This agent has gone.");
  } else if (s === "message") {
    body = v_flex().gap(6)
      .child(field(view, t, "message, then Enter"))
      .child(h_flex().gap(6).child(b("send", view.card.busy ? "SENDING…" : "SEND", (cx) => sendMessage(view, card.address, cx), { on: true }))
        .child(b("back", "BACK", () => step(view, "menu"))));
  } else if (s === "rename") {
    body = v_flex().gap(6)
      .child(field(view, t, "new name, then Enter"))
      .child(h_flex().gap(6).child(b("rename-ok", "RENAME", () => rename(view, card.address), { on: true }))
        .child(b("back", "BACK", () => step(view, "menu"))));
  } else if (s === "close") {
    body = v_flex().gap(6)
      .child(div().font_family(UI_FONT).text_size(12).text_color(status === "working" ? t.blocked : t.muted)
        .child(`${status === "working" ? "It's working: closing stops that work. " : ""}Close this agent and its terminal?${tabHelpers(agent).length ? ` Its ${tabHelpers(agent).length} helper(s) end too.` : ""}`))
      .child(h_flex().gap(6).child(b("close-ok", "CLOSE IT", () => { closeAgent(card.address); close(); }, { on: true }))
        .child(b("back", "KEEP", () => step(view, "menu"))));
  } else {
    body = v_flex().gap(6)
      .child(h_flex().gap(6).flex_wrap()
        .child(b("terminal", "TERMINAL", () => { deps.showTerminal(card.address); close(); }, { on: true, title: "Its real terminal (Enter)" }))
        .when(Boolean(deps.openChatFor), (el) => el.child(b("chat", "CHAT", () => { deps.openChatFor(card.address); close(); }, { title: "Its conversation in the chat window" })))
        .when(status !== "blocked", (el) => el.child(b("message", "MESSAGE", () => step(view, "message"), { title: "Type a message for it" })))
        .when(status === "working" || status === "blocked", (el) => el.child(b("stop", "STOP", (cx) => stopAgent(view, card.address, cx), { title: "Press its stop key" }))))
      .child(h_flex().gap(6)
        .when(!agent.paneless, (el) => el.child(b("rename", "RENAME", () => step(view, "rename", agent.tab_name ?? ""), { title: "Rename its tab" })))
        .child(b("close", "CLOSE…", () => step(view, "close"), { title: "End it (asks first)" })));
  }

  return v_flex().id("agent-card").track_focus(view.cardFocus).on_key_down((e, cx) => cardKey(view, e, cx, card, deps))
    .size_full().p(10).gap(8).bg(`${t.popover}f8`).border(1).border_color(t.accent).border_l(3)
    .child(head).child(doing).child(body)
    .when(Boolean(view.card.note), (el) => el.child(div().font_family(UI_FONT).text_size(11).text_color(t.accent).child(view.card.note)));
}
