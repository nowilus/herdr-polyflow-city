// One native text field for every box of the office: a card's message and rename, the new-agent form and the chat.
// It wraps Herdr's retained InputState / TextareaState (cursor, selection, paste, Unicode, several lines) and adds what
// the boxes share: change / submit / focus / blur callbacks set up once, a revision counter so a send can tell
// whether the text changed while it ran, and a release that is safe to call twice. Sending, drafts and focus rules
// stay with the owner of the field: this file knows nothing about agents.
//
// createTextField must run in `init` or in an event handler (the state needs a live host call), never in render.
// renderTextField only draws; it creates nothing, saves nothing and never takes the keyboard.
import { div } from "gpui-kit";
import { Input, InputState, Textarea, TextareaState } from "gpui-base";
import { fieldNavBindings, isNavRepeat } from "./form-model.js";
import { FIELD_SIZE, FOCUS, RADIUS, UI_FONT } from "./ui-tokens.js";

const TEXT_SIZE = FIELD_SIZE;

// opts: { id, mode: "single" | "multi", value, placeholder, rows: [min, max] (multi), onChange(value, cx),
//         onSubmit(snapshot, cx), onFocus(cx), onBlur(cx) }
// -> a handle: { id, mode, state, focused, released, value(), setValue(v, cx), snapshot(), clearIfUnchanged(snap, cx),
//                focus() }. The text lives in `state` only; `snapshot()` is { value, revision }.
export function createTextField(opts) {
  const { id, mode = "single", value = "", placeholder = "", rows = [1, 4] } = opts;
  const multi = mode === "multi";
  const state = multi ? TextareaState.new({ placeholder, value }) : InputState.new({ placeholder, value });
  if (multi) {
    state.set_auto_grow(rows[0], rows[1]);
    state.set_soft_wrap(true);
  }
  // Callbacks are dropped on release, so a late event can't reach an owner that is gone.
  let cb = { onChange: opts.onChange, onSubmit: opts.onSubmit, onFocus: opts.onFocus, onBlur: opts.onBlur };
  let last = value;
  let revision = 0;
  let focused = false;
  let released = false;

  // Whether the text differs from the last one seen; a different text is a new revision (editing and undoing
  // during a send are two changes, not none).
  const sync = () => {
    if (released) return false;
    const now = state.value();
    if (now === last) return false;
    last = now;
    revision += 1;
    return true;
  };
  const snapshot = () => {
    sync();
    return { value: last, revision };
  };
  const changed = (cx) => {
    if (sync()) cb.onChange?.(last, cx);
  };

  state.on("change", (_e, cx) => changed(cx));
  state.on("focus", (_e, cx) => {
    if (released) return;
    focused = true;
    cb.onFocus?.(cx);
  });
  state.on("blur", (_e, cx) => {
    if (released) return;
    focused = false;
    cb.onBlur?.(cx);
  });
  // Enter. In a multi-line field Shift+Enter is a new line (the host adds it): not a submit.
  state.on("submit", (e, cx) => {
    if (released) return;
    changed(cx);
    if (multi && e?.shift) return;
    cb.onSubmit?.(snapshot(), cx);
  });

  return {
    id,
    mode,
    state,
    get focused() { return focused; },
    get released() { return released; },
    value: () => (released ? last : (sync(), last)),
    setValue(next, cx) {
      if (released) return;
      state.set_value(next);
      changed(cx); // the host may not emit "change" for a value set from code
    },
    snapshot,
    // Empties the field only if it still holds exactly what was sent (same text, same revision).
    clearIfUnchanged(snap, cx) {
      if (released) return false;
      const now = snapshot();
      if (now.value !== snap?.value || now.revision !== snap?.revision) return false;
      state.set_value("");
      changed(cx);
      return true;
    },
    focus() {
      if (!released) state.focus();
    },
    // Internal: used by releaseTextField.
    _release() {
      if (released) return;
      released = true;
      focused = false;
      cb = {};
      state.release();
    },
  };
}

// Idempotent: the native state is released once.
export function releaseTextField(field) {
  field?._release?.();
}

// Esc and Tab as key bindings scoped to the field's own key context, so they reach the owner even when the native
// editor or the host would take a plain key press first. Call once from a view's `init` (the keymap is the app's and
// binding is illegal in render). Safe to call again; answers whether the bindings are in. Without them
// renderTextField falls back to plain key handlers.
const CONTEXT_CANCEL = "PolyflowField";
const CONTEXT_NAV = "PolyflowFieldNav"; // a field whose Tab / Shift+Tab move through a form
const ACTION_CANCEL = "polyflow-field-cancel";
const ACTION_NEXT = "polyflow-field-next";
const ACTION_PREV = "polyflow-field-prev";
let keysBound = false;
let lastNavAt = NaN;
export function bindFieldKeys(cx) {
  if (keysBound) return true;
  try {
    cx.bind_keys([
      { keystroke: "escape", action: ACTION_CANCEL, context: CONTEXT_CANCEL },
      ...fieldNavBindings({ nav: CONTEXT_NAV, cancel: ACTION_CANCEL, next: ACTION_NEXT, prev: ACTION_PREV }),
    ]);
    keysBound = true;
  } catch {
    keysBound = false;
  }
  return keysBound;
}

// Draws the field in a framed box. Only Esc and Tab are handled here (form navigation); every other key belongs to
// the native editor, and the mouse too: a press inside the box is the editor's (cursor, drag to select). The box only
// keeps the press from reaching the window around it (a floating window would take a drag as a move); it doesn't
// focus the editor itself (doing so on every press undid the drag selection). opts: { onCancel(cx), onTab(direction: 1 | -1, cx) }; look: { radius, frame (a colour that is the
// border even without the keyboard), font (null: the window's own) } for a box that has to match its surroundings.
export function renderTextField(field, t, { onCancel = null, onTab = null, look = {} } = {}) {
  const input = field.mode === "multi" ? Textarea.new(field.state) : Input.new(field.state);
  let box = div().id(`field-${field.id}`).w_full().min_w(0).px(8).py(4).bg(t.canvas).border(FOCUS.width)
    .border_color(look.frame ?? (field.focused ? t[FOCUS.key] : t.border)).cursor_text()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation());
  if (look.font !== null) box = box.font_family(look.font ?? UI_FONT);
  box = box.rounded(look.radius ?? RADIUS.field);
  const guard = (fn) => (_e, cx) => { if (!field.released) { fn(cx); cx.stop_propagation(); } };
  // One Tab press may reach us as an action and as a key event; the second one is the same press.
  const go = (direction, cx) => {
    const now = Date.now();
    if (isNavRepeat(lastNavAt, now)) return;
    lastNavAt = now;
    onTab(direction, cx);
  };
  if (keysBound) {
    // The bindings turn the keys into actions. Esc is only an action; Tab is also taken from the key event, in case
    // the editor under the box swallowed the binding (go() ignores the repeat).
    if (onCancel || onTab) box = box.key_context(onTab ? CONTEXT_NAV : CONTEXT_CANCEL);
    if (onCancel) box = box.on_action(ACTION_CANCEL, guard(onCancel));
    if (onTab) box = box.on_action(ACTION_NEXT, guard((cx) => go(1, cx))).on_action(ACTION_PREV, guard((cx) => go(-1, cx)));
  }
  box = box.on_key_down((e, cx) => {
    if (field.released) return;
    const m = e.modifiers ?? {};
    if (e.key === "escape" && onCancel && !keysBound) guard(onCancel)(e, cx);
    else if (e.key === "tab" && onTab && !m.control && !m.alt && !m.platform) guard((c) => go(m.shift ? -1 : 1, c))(e, cx);
  });
  return box.child(input.w_full().text_size(TEXT_SIZE).text_color(t.foreground));
}
