// Pure contracts shared by the office coordinator, bars and chat copies.
import { internalOf } from "./chat-model.js";

export const PLACES = ["float", "bottom", "right", "screen"];
export const CHAT_TARGET_KEY = "polyflow-office.chat-target";
export const CHAT_FOCUS_KEY = "polyflow-office.chat-focus";
export const SCREEN_CHAT_KEY = "polyflow-office.screen-chat";
export const CHAT_OWNER_KEY = "polyflow-office.chat-owner";
export const CHAT_SEND_KEY = "polyflow-office.chat-send";
export const RETARGET_MS = 300;
export const SYNC_MS = 250;
export const FOCUS_REQUEST_MS = 5000;
// An owner left by a previous runtime: live copies of the old build release it on their next tick (SYNC_MS); after this
// nobody is left to, because a hot reload stops the old build without calling its close.
export const STALE_OWNER_MS = 4 * SYNC_MS;
export const PLACE_NODES = Object.freeze({
  bottom: { root: "office-chat-bottom", stack: "office-chat-bottom-body", chat: "office-chat-bottom-chat", terminal: "office-chat-bottom-terminal" },
  right: { root: "office-chat-right", stack: "office-chat-right-body", chat: "office-chat-right-chat", terminal: "office-chat-right-terminal" },
  screen: { root: "office-chat-bottom", stack: "office-chat-bottom-body", chat: "office-chat-bottom-chat", terminal: "office-chat-bottom-terminal" },
});

export function chatTargetOf({ agents = [], crew = [], focusedAgent, focusedTerminal, pick }) {
  const native = agents.filter(a => !a.address.startsWith("demo-"));
  const target = (typeof focusedAgent === "string" && !focusedAgent.startsWith("demo-") ? focusedAgent : null)
    ?? native.find(a => a.focused)?.address
    ?? native.find(a => a.address === focusedTerminal)?.address
    ?? native[0]?.address ?? null;
  if (!pick || typeof pick.address !== "string" || pick.address.startsWith("demo-")) return target;
  if (pick.address === target) return pick.address;
  const inner = internalOf(pick.address);
  if (inner && inner.parent === target && crew.some(a => a.address === pick.address)) return pick.address;
  return target;
}

export function placeShows(place, { state, screen, screenShown, view, internal, hasTarget, floatOpen }) {
  const child = !hasTarget || internal || view !== "terminal" ? "chat" : "terminal";
  const shown = place === "float" ? Boolean(floatOpen)
    : place === "screen" ? Boolean(screen && screenShown)
    : (place === "bottom" || place === "right") && !screen && state?.mode === "full" && state.chat === place;
  return { active: Boolean(shown && child === "chat"), child };
}

export function stackCommands(place, child) {
  const nodes = PLACE_NODES[place];
  return nodes ? [["layout.select", { stack: nodes.stack, child: nodes[child === "terminal" ? "terminal" : "chat"] }]] : [];
}

export function screenChatCommands(shown, child) {
  return [[shown ? "layout.show" : "layout.hide", { id: PLACE_NODES.screen.root }], ...stackCommands("screen", child)];
}

// SCREEN must be resolved before standalone (its layout has no City office node).
export function chatPlaceOf({ state, screen = false, standalone = false }) {
  if (screen) return "screen";
  if (standalone) return "float";
  if (state?.mode === "full") return state.chat;
  return state?.mode === "side" ? "float" : null;
}

// Only small, validated per-address state crosses a place boundary. Unknown entry fields remain in shared
// through patchChat; they are not copied onto the new session.
export function transferable(saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  const text = value => typeof value === "string" && value.length > 0 ? value : null;
  const a = s.anchor;
  const anchor = a && text(a.messageId) && text(a.file) && (a.epoch === null || text(a.epoch))
    ? { messageId: a.messageId, file: a.file, epoch: a.epoch } : null;
  return {
    draft: typeof s.draft === "string" ? s.draft : "", draftVersion: text(s.draftVersion),
    open: Array.isArray(s.open) ? s.open.filter(key => typeof key === "string") : [],
    pinned: typeof s.pinned === "boolean" ? s.pinned : true,
    seen: Number.isFinite(s.seen) && s.seen >= 0 ? s.seen : 0,
    seenSeq: Number.isSafeInteger(s.seenSeq) && s.seenSeq >= -1 ? s.seenSeq : -1,
    seenFile: text(s.seenFile), seenEpoch: text(s.seenEpoch), anchor,
  };
}
