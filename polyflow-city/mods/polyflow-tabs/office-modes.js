// Office panel modes: which layout nodes show (the office's width is whatever the person dragged).
// Pure functions (no herdr / gpui-kit), so node can test them. polyflow-tabs keeps a byte-identical copy.

export const KEY = "polyflow-office";
export const CHAT_PLACES = ["bottom", "right", "float"];
export const MODES = ["off", "side", "full"];
export const DEFAULTS = Object.freeze({ mode: "off", chat: "bottom" });

// Layout node ids (layouts/polyflow-city.json).
export const NODES = Object.freeze({
  office: "office",
  main: "main",
  chatRight: "office-chat-right",
  chatBottom: "office-chat-bottom",
});

// Whatever shared state holds, return a valid state (unknown values fall back to the defaults).
export function officeState(stored) {
  const s = stored !== null && typeof stored === "object" ? stored : {};
  return {
    mode: MODES.includes(s.mode) ? s.mode : DEFAULTS.mode,
    chat: CHAT_PLACES.includes(s.chat) ? s.chat : DEFAULTS.chat,
  };
}

// The app commands that put the layout into a state, as [name, args] pairs, in order.
export function modeCommands(state) {
  const s = officeState(state);
  const hide = (id) => ["layout.hide", { id }];
  const show = (id) => ["layout.show", { id }];
  if (s.mode === "off") {
    return [hide(NODES.chatRight), hide(NODES.chatBottom), hide(NODES.office), show(NODES.main)];
  }
  // side: no resize, so the office keeps the width the person last dragged it to.
  if (s.mode === "side") {
    return [hide(NODES.chatRight), hide(NODES.chatBottom), show(NODES.main), show(NODES.office)];
  }
  // full: the office replaces the terminals; the chosen agent's terminal sits beside it.
  return [
    show(NODES.office),
    hide(NODES.main),
    s.chat === "right" ? show(NODES.chatRight) : hide(NODES.chatRight),
    s.chat === "bottom" ? show(NODES.chatBottom) : hide(NODES.chatBottom),
  ];
}

// Keep this module self-contained: tabs receives a byte-identical copy, not chat-model.
export function layoutCommands(state, child = "chat") {
  const s = officeState(state);
  const commands = modeCommands(s);
  if (s.mode === "full" && (s.chat === "bottom" || s.chat === "right")) {
    const root = `office-chat-${s.chat}`;
    commands.push(["layout.select", { stack: `${root}-body`, child: `${root}-${child === "terminal" ? "terminal" : "chat"}` }]);
  }
  return commands;
}

// The state after a user action; unknown actions leave it as it was.
export function nextState(state, action) {
  const s = officeState(state);
  switch (action?.type) {
    case "toggle":
      return { ...s, mode: s.mode === "off" ? "side" : "off" };
    case "full":
      return { ...s, mode: s.mode === "full" ? "side" : "full" };
    case "off":
      return { ...s, mode: "off" };
    case "chat":
      return CHAT_PLACES.includes(action.place) ? { ...s, chat: action.place } : s;
    default:
      return s;
  }
}

// keys.json commands (`polyflow-tabs.<name>`) mapped to actions. No keys are bound by default.
const COMMANDS = { "office-toggle": { type: "toggle" }, "office-full": { type: "full" }, "office-off": { type: "off" } };
export function commandAction(name) {
  return COMMANDS[name] ? { ...COMMANDS[name] } : null;
}

// SIDE permits an explicitly opened FLOAT; entering SIDE never opens it on its own.
export function allowsFloatingChat(state) {
  const s = officeState(state);
  return s.mode === "side" || (s.mode === "full" && s.chat === "float");
}
