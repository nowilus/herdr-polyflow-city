// The OPEN button's window: one file of the conversation's folder, as text you can select and copy. Read by
// hooks/file-preview.mjs (bounded, read-only, regular files only); shown in Herdr's read-only editor, as plain text
// (no Markdown, no highlighting). It is a window of its own and takes nothing from the chat: not its draft, not its
// keyboard.
import { div } from "gpui-kit";
import { Editor, EditorState, h_flex, v_flex } from "gpui-base";
import { closeOverlay, exec, openOverlay, props } from "herdr";
import { parseJson, sourceHome } from "./chat-io.js";
import { BUTTON, SIGN_FONT, SMALL_SIZE, TITLE_SIZE, UI_FONT } from "./ui-tokens.js";

const KEY = "polyflow-office-file-preview";

// spec: { address, cwd, path } — path is absolute. The window replaces the one open before it (same key).
export function openFilePreview(spec) {
  if (!spec?.path) return null;
  return openOverlay({ kind: "window", key: KEY, width: 0.65, height: 0.7, mod: "polyflow-office", props: { filePreview: spec } });
}

// view.preview: { spec, state: "loading" | "ready" | "error", real, truncated, error, closed }.
export function initFilePreview(view, spec, cx) {
  view.preview = { spec, state: "loading", real: null, truncated: false, error: null, closed: false };
  view.previewFocus = cx.focus_handle();
  view.previewFocus.focus();
  // The editor is made here, empty, and filled when the file has been read: nothing is created in render.
  view.previewEditor = EditorState.new({ readonly: true, line_numbers: true, folding: false, soft_wrap: true });
  cx.spawn(async (cx) => {
    let next;
    try {
      const home = await sourceHome();
      const r = await exec("node", [`${home}/mods/polyflow-office/hooks/file-preview.mjs`, spec.path]);
      const out = r.code === 0 ? parseJson(r.stdout) : null;
      if (typeof out?.text === "string" && out.error == null) next = { state: "ready", real: out.real ?? null, truncated: out.truncated === true, error: null, text: out.text };
      else next = { state: "error", error: out?.error ?? (r.stderr || "Can't read the file.").trim().slice(0, 120) };
    } catch (err) {
      next = { state: "error", error: `Can't read the file: ${String(err?.message ?? err).slice(0, 100)}` };
    }
    if (view.preview.closed) return;
    if (next.state === "ready") view.previewEditor.set_value(next.text);
    view.preview = { ...view.preview, ...next, text: undefined };
    cx.notify();
  });
}

// The window goes away: let go of the editor. Twice is fine.
export function closeFilePreview(view) {
  if (!view.preview || view.preview.closed) return;
  view.preview = { ...view.preview, closed: true };
  view.previewEditor.release();
}

const close = () => closeOverlay(props()?.overlay);

export function renderFilePreview(view, t, button) {
  const p = view.preview;
  const outside = p.real && p.state === "ready" && p.real.replace(/\\/g, "/") !== p.spec.path.replace(/\\/g, "/");
  const note = (s, color = t.dim) => div().font_family(UI_FONT).text_size(SMALL_SIZE).text_color(color).child(s);
  const body = p.state === "ready"
    ? div().id("preview-text").flex_1().min_h(0).child(Editor.new(view.previewEditor).size_full())
    : div().flex_1().p(12).child(note(p.state === "loading" ? "Reading…" : p.error, p.state === "error" ? t.blocked : t.dim));
  return v_flex().id("file-preview").track_focus(view.previewFocus)
    .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
    .size_full().bg(t.background).border(1).border_color(t.accent)
    .child(h_flex().px(10).py(6).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border) // a press here drags the window
      .child(div().font_family(SIGN_FONT).text_size(BUTTON.size).text_color(t.accent).child("FILE"))
      .child(div().flex_1().min_w(0).font_family(UI_FONT).text_size(TITLE_SIZE).text_color(t.foreground).whitespace_nowrap().overflow_hidden().text_ellipsis_start().tooltip(p.spec.path).child(p.spec.path))
      .child(button("preview-close", "X", () => close(), t, { title: "Close" })))
    .when(Boolean(p.spec.cwd), (el) => el.child(div().px(10).py(2).child(note(`conversation folder: ${p.spec.cwd}`, t.dim))))
    .when(Boolean(outside), (el) => el.child(div().px(10).py(2).child(note(`a link: this is ${p.real}`, t.blocked))))
    .when(p.truncated, (el) => el.child(div().px(10).py(2).child(note("Only the first 256 KiB are shown.", t.blocked))))
    .child(body);
}
