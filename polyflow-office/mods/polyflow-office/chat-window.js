// The floating chat: the agent's conversation as a chat (desk-chat.js), or its live terminal, in a window over the
// office, with a title bar on top that switches between the two. Herdr windows
// can be dragged but not resized, and a drag grip inside one never got the press, so the title bar has size
// buttons instead: each reopens the window (same key: same place) at the new size, kept as a share of the app.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, closeOverlay, openOverlay, props, run, setShared, shared, terminals } from "herdr";
import { withHelpers } from "./activity.js";
import { CHAT_HANDOFF_KEY, CHAT_STATE_KEY, HANDOFF_SHOWN_MS } from "./chat-model.js";

const KEY = "polyflow-office-chat";
const SIZE_KEY = "polyflow-office.chat-size";
const DEFAULT = { w: 0.42, h: 0.5 };
const MIN = { w: 0.2, h: 0.2 };
const BAR_PX = 26;
const HANDOFF_PX = 28;
const STEP = 0.08;
const BIG = { w: 1, h: 1 }; // the whole app window
const BIG_KEY = "polyflow-office-chat-big";
const BIG_FLAG = "polyflow-office.chat-big"; // the person chose "almost the whole window"
const OPEN_WHICH_KEY = "polyflow-office.chat-open-key"; // which of the two windows is open

// What the window shows: "chat" (the conversation) or "terminal" (the real one: approvals, questions, full output).
const VIEW_KEY = "polyflow-office.chat-view";
export const chatView = () => (shared(VIEW_KEY) === "terminal" ? "terminal" : "chat");

export function setChatView(address, view) {
  setShared(VIEW_KEY, view === "terminal" ? "terminal" : "chat");
  if (chatIsOpen()) openChat(address);
}

// The open chat window's id lives in shared state, so a reloaded mod still knows it (and can close it).
const OPEN_KEY = "polyflow-office.chat-open";

export function chatSize() {
  const s = shared(SIZE_KEY);
  const ok = (v) => typeof v === "number" && v >= 0.1 && v <= 1;
  return s && ok(s.w) && ok(s.h) ? s : DEFAULT;
}

export function openChat(address) {
  if (!address) return null;
  // "Almost the whole window" is a window of its own key: never dragged before, Herdr opens it centred, so it
  // grows symmetrically around the middle instead of from wherever the small one stood. Switching between the two
  // closes the other.
  const big = isBig();
  const key = big ? BIG_KEY : KEY;
  const size = big ? BIG : chatSize();
  const was = shared(OPEN_KEY);
  if (typeof was === "string" && shared(OPEN_WHICH_KEY) !== key) closeOverlay(was);
  const id = openOverlay({
    kind: "window",
    key,
    width: size.w,
    height: size.h,
    layout: {
      type: "column",
      children: [
        { type: "block", size: { px: BAR_PX }, content: { mod: "polyflow-office", props: { chatBar: address } } },
        ...(chatView() === "terminal" && handoffFor(address)
          ? [{ type: "block", size: { px: HANDOFF_PX }, content: { mod: "polyflow-office", props: { chatHandoff: address } } }]
          : []),
        { type: "block", content: chatView() === "terminal" ? { terminal: address } : { mod: "polyflow-office", props: { deskChat: address } } },
      ],
    },
  });
  setShared(OPEN_KEY, id);
  setShared(OPEN_WHICH_KEY, key);
  return id;
}

export function closeChat() {
  const id = shared(OPEN_KEY);
  if (typeof id === "string") closeOverlay(id);
  setShared(OPEN_KEY, null);
}

export const chatIsOpen = () => typeof shared(OPEN_KEY) === "string";

// Title bar: which agent, and a close button. Presses on it move the window.
export function renderChatBar(address, t, button) {
  const a = withHelpers(agents(), terminals()).find((x) => x.address === address);
  const terminal = chatView() === "terminal";
  return h_flex().size_full().px(8).gap(6).items_center().bg(t.chrome).border_b(1).border_color(t.accent)
    .child(div().font_family("Silkscreen").text_size(10).text_color(t.accent).child("CHAT"))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(a?.tab_name || address))
    .child(button("chat-view", terminal ? "CHAT" : "TERMINAL", (_e, cx) => (terminal ? (setShared(CHAT_HANDOFF_KEY, null), setChatView(address, "chat")) : switchToTerminal(address, cx)), t,
      { on: terminal, title: terminal ? "Back to the conversation" : "The real terminal: approvals, questions, full output" }))
    .child(button("chat-smaller", "−", () => resizeChat(address, -STEP), t, { title: "Smaller" }))
    .child(button("chat-bigger", "+", () => resizeChat(address, STEP), t, { title: "Bigger" }))
    .child(button("chat-max", isBig() ? "▣" : "□", () => toggleBig(address), t, { on: isBig(), title: isBig() ? "Back to the last size" : "The whole window" }))
    .child(button("chat-close", "X", () => { closeOverlay(props()?.overlay); setShared(OPEN_KEY, null); }, t, { title: "Close the chat" }));
}

const clamp = (v, lo) => Math.max(lo, Math.min(1, v));
const LAST_KEY = "polyflow-office.chat-last-size"; // the size to go back to from "almost the whole window"

function setSize(address, size) {
  setShared(SIZE_KEY, { w: clamp(size.w, MIN.w), h: clamp(size.h, MIN.h) });
  openChat(address);
}

function resizeChat(address, by) {
  // From "almost the whole window", − and + start again from the last ordinary size.
  const base = isBig() ? lastSize() : chatSize();
  setShared(BIG_FLAG, false);
  setSize(address, { w: base.w + by, h: base.h + by });
}

const isBig = () => shared(BIG_FLAG) === true;

function lastSize() {
  const last = shared(LAST_KEY);
  return last && typeof last.w === "number" && typeof last.h === "number" ? last : chatSize();
}

function toggleBig(address) {
  if (isBig()) {
    setShared(BIG_FLAG, false);
    setSize(address, lastSize());
    return;
  }
  setShared(LAST_KEY, chatSize());
  setShared(BIG_FLAG, true);
  openChat(address);
}

// To the real terminal, taking what was typed in the chat along. A mod can't type into a given terminal's input
// line: hc only sends with Enter, its key names can't type "ą", and Herdr pastes only into the focused terminal,
// which the chat window's terminal can't be made from code (pasting there once landed in another agent's input).
// So the draft goes on the clipboard and a strip over the terminal says so: click in it and press Ctrl+V. The draft
// also stays in the chat.
export function switchToTerminal(address, cx) {
  const all = shared(CHAT_STATE_KEY);
  const draft = all && typeof all === "object" ? all[address]?.draft : "";
  const handoff = typeof draft === "string" && draft.trim() !== "";
  if (handoff) cx.write_to_clipboard(draft);
  setShared(CHAT_HANDOFF_KEY, handoff ? { address, at: Date.now() } : null);
  setChatView(address, "terminal");
  if (!chatIsOpen()) run("agent.focus", { terminal: address });
}

// Whether the strip "your chat text is on the clipboard" belongs over this agent's terminal.
export function handoffFor(address) {
  const h = shared(CHAT_HANDOFF_KEY);
  return Boolean(h && h.address === address && Date.now() - h.at < HANDOFF_SHOWN_MS);
}

// The strip itself (a block between the title bar and the terminal).
export function renderHandoff(address, t, button) {
  return h_flex().size_full().px(8).gap(8).items_center().bg(`${t.accent}26`).border_b(1).border_color(t.accent)
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground)
      .child("Your chat text is on the clipboard: click in the terminal and press Ctrl+V."))
    .child(button("handoff-close", "OK", () => { setShared(CHAT_HANDOFF_KEY, null); openChat(address); }, t, { title: "Hide this" }));
}
