// The chat's side panel: five sections (NOW, CHANGED, READ, PLAN, SESSION) with a header each that folds the section.
// It only draws: the data comes in `model`, every action goes out through `deps`, and it starts no process, timer or
// state (desk-chat.js owns those). Where it sits (beside the history, narrower, or in a drawer) is decided by
// chat-model.js panelLayout.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { contextLine, repoMark } from "./chat-model.js";
import { contextText } from "./energy.js";
import { BODY_SIZE, LABEL_SIZE, SIGN_FONT, SMALL_SIZE, UI_FONT } from "./ui-tokens.js";
import { uiButton } from "./ui-kit.js";

export const FILES_STEP = 30; // files shown at first in CHANGED and in READ, and how many more each "MORE" adds

const NO_DATA = "no data";
const count = (n) => (Number.isFinite(n) ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") : NO_DATA);
const text = (s, t, color = t.dim, size = SMALL_SIZE) => div().font_family(UI_FONT).text_size(size).text_color(color).child(s);

// The files of one list. A click on a file goes to the call that touched it (deps.jumpToFile); OPEN shows the file
// itself (deps.openFile), when its full path and a local machine are known. The whole path shows (the middle gives way
// when it is long; the tooltip has everything). A file's mark and colour say what happened to it; a failed edit is
// never shown as an edit. `list`: "changed" | "read"; shown: how many of them are listed; picked: the selected file.
function fileRows(files, list, shown, picked, note, t, empty, deps) {
  const tone = { edited: t.working, editing: t.working, "edit failed": t.blocked, "edit result unknown": t.dim, read: t.dim };
  if (files.length === 0) return text(empty, t);
  const isPicked = (f) => Boolean(picked) && picked.path === f.path && picked.messageId === f.messageId;
  const rows = files.slice(0, shown).map((f, i) => h_flex().id(`file-${list}-${i}`).flex_none().gap(6).items_center().px(2).py(1).cursor_pointer()
    .bg(isPicked(f) ? `${t.accent}26` : "#00000000")
    .on_click((_e, cx) => deps.jumpToFile(f, cx))
    .child(div().w(6).h(6).flex_none().bg(tone[f.verb] ?? t.dim))
    .child(div().flex_1().min_w(0).whitespace_nowrap().overflow_hidden().text_ellipsis_middle().font_family(UI_FONT).text_size(SMALL_SIZE)
      .text_color(f.verb === "read" ? t.muted : f.verb === "edit failed" ? t.blocked : t.foreground)
      .tooltip(`${f.verb}: ${f.full ?? f.path}`).child(`${f.verb === "edit failed" ? "✗ " : ""}${f.label}`))
    .when(Boolean(repoMark(f.repo)), (el) => el.child(div().flex_none().font_family(UI_FONT).text_size(SMALL_SIZE).text_color(t.dim).child(repoMark(f.repo))))
    .when(Boolean(f.full) && deps.canOpen, (el) => el.child(
      div().id(`open-${list}-${i}`).flex_none().px(5).font_family(SIGN_FONT).text_size(LABEL_SIZE).text_color(t.muted).border(1).border_color(t.border).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); deps.openFile(f, cx); })
        .tooltip("Show the file").child("OPEN"))));
  return v_flex().gap(2).children(rows)
    .when(Boolean(note), (el) => el.child(text(note, t)))
    .when(files.length > shown, (el) => el.child(
      div().id(`more-${list}`).font_family(SIGN_FONT).text_size(LABEL_SIZE).text_color(t.muted).cursor_pointer()
        .on_click((_e, cx) => deps.showMoreFiles(list, cx)).child(`SHOW ${Math.min(FILES_STEP, files.length - shown)} MORE (${shown}/${files.length})`)));
}

const PLAN_MARK = { completed: "✓", in_progress: "▸", pending: "○" };

// plan: undefined (an older reader: no data), null (no explicit plan in what was read) or a plan snapshot.
function planBody(plan, t, compact) {
  if (plan === undefined) return text(NO_DATA, t);
  if (plan === null) return text("no explicit plan in loaded history", t);
  if (plan.items.length === 0) return text("plan cleared", t);
  return v_flex().gap(3)
    .children(plan.items.map((item) => v_flex().gap(1)
      .child(h_flex().gap(6)
        .child(div().flex_none().font_family(UI_FONT).text_size(SMALL_SIZE).text_color(item.status === "in_progress" ? t.accent : item.status === "completed" ? t.working : t.dim).child(PLAN_MARK[item.status] ?? "○"))
        .child(div().flex_1().min_w(0).font_family(UI_FONT).text_size(SMALL_SIZE).text_color(item.status === "completed" ? t.muted : t.foreground).child(item.text)))
      .when(!compact && item.status === "in_progress" && Boolean(item.activeForm), (el) => el.child(div().pl(14).font_family(UI_FONT).text_size(SMALL_SIZE).text_color(t.dim).child(item.activeForm)))))
    .when(plan.omittedItems > 0, (el) => el.child(text(`${plan.omittedItems} more steps not shown`, t)));
}

// session: undefined (an older reader), or the reader's SessionInfo. Missing numbers are "no data", never 0.
// info: the energy view (desk-chat.js): { model, effort, context, energy: { freePct, level } }, from the provider's own
// figures (energy.js) where there are some and from the conversation otherwise.
const LEVEL_COLOR = { ok: "working", low: "accent", critical: "blocked" };

function sessionBody(session, info, t, compact) {
  const k = session?.tokens ?? null;
  const known = session !== undefined || info.model || info.effort || info.energy.level !== "unknown";
  if (!known) return text(NO_DATA, t);
  const row = (label, value) => h_flex().gap(6).child(div().w(60).flex_none().font_family(UI_FONT).text_size(SMALL_SIZE).text_color(t.dim).child(label))
    .child(div().flex_1().min_w(0).font_family(UI_FONT).text_size(SMALL_SIZE).text_color(t.foreground).child(value));
  const free = info.energy.freePct;
  const used = contextText(info.context);
  const contextRow = used ? `${used}${free !== null ? ` · ${free}% free` : ""}` : free !== null ? `${free}% free` : contextLine(k) ?? NO_DATA;
  // The energy bar: the free part of the window, in the colour of its level.
  const bar = info.energy.level === "unknown" ? null
    : div().h(4).w_full().bg(t.border).child(div().h(4).w(`${free}%`).bg(t[LEVEL_COLOR[info.energy.level]]));
  // First how full the last request's context was, then (wide panels) what the session has processed in all.
  return v_flex().gap(2)
    .child(row("model", info.model ?? NO_DATA))
    .when(Boolean(info.effort), (el) => el.child(row("effort", info.effort)))
    .child(row("context", contextRow))
    .when(Boolean(bar), (el) => el.child(bar))
    .when(!compact, (el) => el.child(row("processed", k?.approximate ? `≈ ${count(k.total)}` : count(k?.total))))
    .child(row("in/out", k ? `${count(k.input)} / ${count(k.output)}` : NO_DATA))
    .when(!compact, (el) => el.child(row("cache", k ? `${count(k.cachedInput)} read · ${count(k.cacheWriteInput)} written` : NO_DATA)))
    .when(Boolean(k), (el) => el.child(text(`${k.scope === "session" ? "processed: whole session" : "processed: loaded part only"}${k.approximate ? " (approximate)" : ""}`, t)));
}

// The session numbers and, under them, what this window's reader costs (always there, also when the session has no data:
// that is when the figures are most wanted). Wide panels add what the whole office costs, from metrics.json.
function sessionWithReader(model, t, compact) {
  return v_flex().gap(4)
    .child(sessionBody(model.session, model.info, t, compact))
    .when(Boolean(model.reader), (el) => el.child(text(model.reader, t)))
    .when(!compact && Boolean(model.readerAll), (el) => el.child(text(model.readerAll, t, t.muted)));
}

// The office's line for what the agent is doing, and under it (when it is working in a tool) the tool and its time.
function nowBody(model, t) {
  return v_flex().gap(2)
    .child(div().font_family(UI_FONT).text_size(BODY_SIZE).text_color(model.status === "blocked" ? t.blocked : t.foreground).child(model.doing))
    .when(Boolean(model.tool), (el) => el.child(text(model.tool, t)));
}

// One section: a header that folds it (the arrow, the name, a count) and, when open, its body.
function section(key, title, n, folded, body, t, deps) {
  return v_flex().flex_none().gap(4)
    .child(h_flex().id(`panel-head-${key}`).gap(6).items_center().cursor_pointer()
      .on_click((_e, cx) => deps.toggleSection(key, cx))
      .child(div().font_family(UI_FONT).text_size(SMALL_SIZE).text_color(t.dim).child(folded ? "▸" : "▾"))
      .child(div().font_family(SIGN_FONT).text_size(LABEL_SIZE).text_color(t.dim).child(n === null ? title : `${title} (${n})`)))
    .when(!folded, (el) => el.child(body));
}

// model: { status, doing, tool, changed: [file], read: [file], shown: { changed, read }, picked (the selected file or
// null), repoNote (what the +/− marks are, or why there are none), plan, session, info (energy view) }; ui: { collapsed }; layout: panelLayout(); deps: { toggleSection(key, cx), jumpToFile(file, cx),
// openFile(file, cx), canOpen (OPEN may be offered), showMoreFiles(list, cx), closeDrawer(cx) | null }.
export function renderChatPanel(model, ui, layout, t, deps) {
  const folded = ui.collapsed;
  const body = v_flex().id("desk-panel-scroll").flex_1().min_h(0).gap(8).overflow_y_scrollbar()
    .child(section("now", "NOW", null, folded.now, nowBody(model, t), t, deps))
    .child(section("changed", "CHANGED", model.changed.length, folded.changed, fileRows(model.changed, "changed", model.shown.changed, model.picked, model.repoNote, t, "none in the loaded history", deps), t, deps))
    .child(section("read", "READ", model.read.length, folded.read, fileRows(model.read, "read", model.shown.read, model.picked, model.repoNote, t, "none in the loaded history", deps), t, deps))
    .child(section("plan", "PLAN", null, folded.plan, planBody(model.plan, t, layout.compact), t, deps))
    .child(section("session", "SESSION", null, folded.session, sessionWithReader(model, t, layout.compact), t, deps));
  return v_flex().id("desk-panel").w(layout.panelWidth).flex_none().h_full().p(10).gap(8).bg(layout.mode === "drawer" ? t.chrome : `${t.chrome}f0`).border_l(1).border_color(t.border)
    .when(Boolean(deps.closeDrawer), (el) => el.child(h_flex().items_center()
      .child(div().flex_1().font_family(SIGN_FONT).text_size(LABEL_SIZE).text_color(t.accent).child("DETAILS"))
      .child(uiButton("desk-panel-close", "X", (_e, cx) => deps.closeDrawer(cx), t))))
    .child(body);
}
