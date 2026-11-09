// "+ AGENT": a dialog that starts a new agent in a new tab (Herdr's tab.new). The office then sees it walk in
// through the lobby's front door and rest there until it has something to do. Until it shows up among the agents
// the office bar says it's connecting; if it never does, the bar says so and points at its tab.
//
// The name and first task are native text fields (text-field.js); the programs offered are those of the chosen
// space's machine (agent-programs.js). Starting re-checks everything at the moment of the click (form-model.js).
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, closeOverlay, machines, openOverlay, props, run, setShared, shared, spaces } from "herdr";
import { buildNewAgentArgs, launchGuard, machineLayout, nextFormField, validateAgentName } from "./form-model.js";
import { machineLabel, pickSpace, refreshPrograms, retryPrograms, watchPrograms } from "./agent-programs.js";
import { bindFieldKeys, createTextField, releaseTextField, renderTextField } from "./text-field.js";
import { SIGN_FONT, TITLE_SIZE, UI_FONT } from "./ui-tokens.js";

export const PENDING_KEY = "polyflow-office.pending-agent";
export const PENDING_MS = 45000;
const ENTER_GUARD_MS = 400; // a held or repeated Enter must not start a second agent

export function openNewAgent() {
  return openOverlay({ kind: "dialog", width: 460, height: 520, frame: "none", mod: "polyflow-office", props: { newAgent: true } });
}

// view.form: space, machine / machineKey (whose programs `programs` are), programs, programKey, missing,
// programsState (loading | ready | error | unavailable), programsError, requestId, checkedAt, layoutSeen, active (the
// field with the keyboard), nameError, error, starting, closed. The name and task are in view.formName / formTask.
export function initNewAgent(view, cx) {
  const space = spaces().find((s) => s.active) ?? spaces()[0] ?? null;
  view.form = { space: space?.id ?? null, machine: null, machineKey: null, programs: [], missing: 0, programKey: null, programsState: "loading", programsError: null,
    requestId: 0, checkedAt: 0, layoutSeen: null, active: "name", nameError: null, error: null, starting: false, closed: false };
  view.formStartAt = 0;
  view.formFocus = cx.focus_handle();
  bindFieldKeys(cx);
  view.formName = createTextField({
    id: "new-name", mode: "single", placeholder: "its tab's name",
    // Once an error is showing it follows what is typed.
    onChange: (v, cx) => { if (view.form.nameError) view.form = { ...view.form, nameError: validateAgentName(v, { optional: true }).error ?? null }; cx?.notify(); },
    onSubmit: (_snap, cx) => start(view, cx),
    onFocus: (cx) => { view.form = { ...view.form, active: "name" }; cx?.notify(); },
  });
  view.formTask = createTextField({
    id: "new-task", mode: "multi", rows: [1, 4], placeholder: "empty: it waits in the lobby",
    onSubmit: (_snap, cx) => start(view, cx),
    onFocus: (cx) => { view.form = { ...view.form, active: "task" }; cx?.notify(); },
  });
  view.formName.focus();
  // The list is asked for after the form is up, so the boxes work at once.
  refreshPrograms(view, space?.machine ?? null, cx);
  view.formTimers = [cx.timer.every(1000, (cx) => watchPrograms(view, cx))];
}

// The dialog goes away: stop the timer, let go of the fields, and let any answer still on its way fall on a closed form.
export function closeNewAgent(view) {
  if (!view.form || view.form.closed) return;
  view.form = { ...view.form, closed: true, requestId: view.form.requestId + 1 };
  for (const task of view.formTimers ?? []) task.cancel();
  releaseTextField(view.formName);
  releaseTextField(view.formTask);
}

// The new agent, as the office waits for it: { space, name, since, known: addresses already there }.
export function pendingAgent(now) {
  const p = shared(PENDING_KEY);
  if (!p || typeof p !== "object" || typeof p.since !== "number") return null;
  return { ...p, late: now - p.since > PENDING_MS };
}

// Called by the office's timer: the agent has arrived (a new address in its space) — stop waiting.
export function settlePending(now) {
  const p = pendingAgent(now);
  if (!p) return null;
  const known = new Set(p.known ?? []);
  // A new agent in that space; when it was given a name, the one with that name.
  const arrived = agents().find((a) => a.space === p.space && !known.has(a.address) && (!p.named || a.tab_name === p.name));
  if (arrived) {
    setShared(PENDING_KEY, null);
    return { arrived };
  }
  return { waiting: p };
}

function fail(view, patch, cx) {
  view.form = { ...view.form, ...patch };
  cx.notify();
}

// Start the agent: Enter in either box, the START button. Everything is checked as it is now (the space, its machine
// and layout, the program, the name); `starting` is set before anything else so a second press can't start another.
function start(view, cx) {
  const f = view.form;
  if (f.starting || f.closed || Date.now() - view.formStartAt < ENTER_GUARD_MS) return;
  view.formStartAt = Date.now();
  const spaceInfo = spaces().find((s) => s.id === f.space) ?? null;
  const guard = launchGuard({ spaceInfo, layout: machineLayout(machines(), spaceInfo?.machine ?? null), form: f });
  if (!guard.ok) {
    if (guard.refresh) refreshPrograms(view, spaceInfo.machine, cx);
    return fail(view, { error: guard.reason }, cx);
  }
  const built = buildNewAgentArgs({ space: f.space, program: guard.program, rawName: view.formName.value(), rawTask: view.formTask.value() });
  if (!built.ok) {
    if (built.field === "name") view.formName.focus();
    return fail(view, { nameError: built.field === "name" ? built.error : null, error: built.field === "name" ? null : built.error }, cx);
  }
  view.form = { ...f, starting: true, error: null, nameError: null };
  const known = agents().map((a) => a.address);
  try {
    run("tab.new", built.args);
  } catch (err) {
    return fail(view, { starting: false, error: `Couldn't start it: ${String(err?.message ?? err).slice(0, 120)}` }, cx);
  }
  setShared(PENDING_KEY, { space: f.space, name: built.args.name ?? guard.program.name, named: built.named, since: Date.now(), known });
  closeOverlay(props()?.overlay);
}

// Tab / Shift+Tab between the two boxes.
function moveField(view, direction, cx) {
  const next = nextFormField(view.form.active, direction);
  (next === "task" ? view.formTask : view.formName).focus();
  cx.notify();
}

const closeForm = () => closeOverlay(props()?.overlay);

// The dialog's own keys: Esc closes, Enter starts when no box has the keyboard (a click on a chip). Typing and Enter
// inside a box belong to the box.
export function newAgentKey(view, e, cx) {
  const inBox = view.formName?.focused || view.formTask?.focused;
  if (e.key === "escape") closeForm();
  else if (e.key === "enter" && !inBox && !e.modifiers?.shift && !e.is_held) start(view, cx);
  else return;
  cx.stop_propagation();
  cx.notify();
}

function label(text, t) {
  return div().font_family(SIGN_FONT).text_size(9).text_color(t.dim).child(text);
}

const note = (text, t, color = t.dim) => div().font_family(UI_FONT).text_size(12).text_color(color).child(text);

// Chips for the programs, or what stands in their place (checking, error with RETRY, nothing installed).
function programList(view, t, button) {
  const f = view.form;
  const where = machineLabel(f.machine);
  if (f.programsState === "unavailable") return note(f.programsError ?? `${where} isn't available.`, t, t.blocked);
  if (f.programsState === "error") {
    return h_flex().gap(8).items_center().child(div().flex_1().child(note(f.programsError, t, t.blocked)))
      .child(button("programs-retry", "RETRY", (_e, cx) => { retryPrograms(view, cx); }, t));
  }
  if (f.programs.length === 0) return note(f.programsState === "loading" ? `Checking programs on ${where}…` : `No installed launchable programs on ${where}.`, t);
  // While a refresh runs the old list stays on show but is dimmed: it can't start yet.
  const ready = f.programsState === "ready";
  return h_flex().flex_wrap().gap(6).children(f.programs.map((p) => {
    const on = p.key === f.programKey;
    return button(`prog-${p.key}`, p.name, (_e, cx) => { view.form = { ...view.form, programKey: p.key, error: null }; cx.notify(); }, t,
      { on, title: p.run.join(" ") }).opacity(ready ? 1 : 0.5);
  }));
}

export function renderNewAgent(view, t, button) {
  const f = view.form;
  const spaceList = h_flex().flex_wrap().gap(6).children(spaces().map((s) =>
    button(`space-${s.id}`, s.name || `space ${s.index + 1}`, (_e, cx) => { pickSpace(view, s.id, cx); }, t, { on: s.id === f.space })));
  const fieldKeys = { onCancel: closeForm, onTab: (direction, cx) => moveField(view, direction, cx) };
  return v_flex().id("new-agent").track_focus(view.formFocus).on_key_down((e, cx) => newAgentKey(view, e, cx))
    .size_full().p(14).gap(10).bg(`${t.popover}fa`).border(1).border_color(t.accent).border_t(3)
    .child(h_flex().items_center()
      .child(div().flex_1().font_family(SIGN_FONT).text_size(TITLE_SIZE).text_color(t.accent).child("+ NEW AGENT"))
      .child(div().font_family(UI_FONT).text_size(11).text_color(t.dim).child("it walks in through the lobby")))
    .child(v_flex().gap(4).child(label(`AGENT · PROGRAMS ON: ${machineLabel(f.machine).toUpperCase()}`, t)).child(programList(view, t, button))
      .when(f.programsState === "ready" && f.missing > 0, (el) => el.child(div().font_family(UI_FONT).text_size(11).text_color(t.dim).child(`+${f.missing} more not installed here`))))
    .child(v_flex().gap(4).child(label("SPACE", t)).child(spaceList))
    .child(v_flex().gap(4).child(label("NAME (OPTIONAL)", t)).child(renderTextField(view.formName, t, fieldKeys))
      .child(div().h(14).font_family(UI_FONT).text_size(11).text_color(t.blocked).child(f.nameError ?? "")))
    .child(v_flex().gap(4).child(label("FIRST TASK (OPTIONAL)", t)).child(renderTextField(view.formTask, t, fieldKeys)))
    .when(Boolean(f.error), (el) => el.child(div().font_family(UI_FONT).text_size(12).text_color(t.blocked).child(f.error)))
    .child(div().flex_1())
    .child(h_flex().gap(6).items_center()
      .child(div().flex_1().font_family(UI_FONT).text_size(11).text_color(t.dim).child("Enter starts · Shift+Enter new line · Tab next box · Esc closes"))
      .child(button("new-cancel", "CANCEL", (_e, cx) => { closeForm(); cx.notify(); }, t))
      .child(button("new-start", "START", (_e, cx) => { start(view, cx); }, t, { on: f.programsState === "ready" })));
}
