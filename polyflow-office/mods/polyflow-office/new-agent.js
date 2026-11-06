// "+ AGENT": a dialog that starts a new agent in a new tab (Herdr's tab.new). The office then sees it walk in
// through the lobby's front door and rest there until it has something to do. Until it shows up among the agents
// the office bar says it's connecting; if it never does, the bar says so and points at its tab.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, closeOverlay, knownAgents, openOverlay, props, run, setShared, shared, spaces } from "herdr";

const UI_FONT = "Chakra Petch";
const SIGN_FONT = "Silkscreen";
export const PENDING_KEY = "polyflow-office.pending-agent";
export const PENDING_MS = 45000;
const FIELDS = ["name", "task"];

export function openNewAgent() {
  return openOverlay({ kind: "dialog", width: 460, height: 430, frame: "none", mod: "polyflow-office", props: { newAgent: true } });
}

export function initNewAgent(view, cx) {
  const active = spaces().find((s) => s.active) ?? spaces()[0] ?? null;
  view.form = { programs: null, missing: 0, pick: 0, space: active?.id ?? null, name: "", task: "", field: "name", error: null };
  view.formFocus = cx.focus_handle();
  view.formFocus.focus();
  cx.spawn(async (cx) => {
    const list = await knownAgents({ on: active?.machine ?? null }).catch(() => []);
    // Only what can start here; the rest is counted, not offered.
    const runnable = list.filter((p) => p.run?.length);
    const programs = runnable.filter((p) => p.installed);
    view.form = { ...view.form, programs, missing: runnable.length - programs.length, pick: 0 };
    cx.notify();
  });
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

function start(view) {
  const f = view.form;
  const program = f.programs?.[f.pick];
  if (!program) return;
  if (!f.space) {
    view.form = { ...f, error: "There's no space to start it in." };
    return;
  }
  const args = { space: f.space, argv: program.run };
  if (f.name.trim()) args.name = f.name.trim();
  if (f.task.trim()) args.task = f.task.trim();
  const known = agents().map((a) => a.address);
  try {
    run("tab.new", args);
  } catch (err) {
    view.form = { ...f, error: `Couldn't start it: ${String(err?.message ?? err).slice(0, 120)}` };
    return;
  }
  setShared(PENDING_KEY, { space: f.space, name: f.name.trim() || program.name, named: Boolean(f.name.trim()), since: Date.now(), known });
  closeOverlay(props()?.overlay);
}

export function newAgentKey(view, e, cx) {
  const f = view.form;
  const m = e.modifiers;
  if (e.key === "escape") closeOverlay(props()?.overlay);
  else if (e.key === "enter") start(view);
  else if (e.key === "tab") view.form = { ...f, field: FIELDS[(FIELDS.indexOf(f.field) + 1) % FIELDS.length] };
  else if (e.key === "up" || e.key === "down") {
    const n = f.programs?.length ?? 0;
    if (n) view.form = { ...f, pick: (f.pick + (e.key === "down" ? 1 : n - 1)) % n, error: null };
  } else if (e.key === "backspace") view.form = { ...f, [f.field]: f[f.field].slice(0, -1) };
  else if (e.key_char && !m.control && !m.platform) view.form = { ...f, [f.field]: f[f.field] + e.key_char };
  else return;
  cx.stop_propagation();
  cx.notify();
}

function label(text, t) {
  return div().font_family(SIGN_FONT).text_size(9).text_color(t.dim).child(text);
}

function input(view, id, placeholder, t) {
  const f = view.form;
  const on = f.field === id;
  const text = f[id];
  return h_flex().id(`new-${id}`).h(28).px(8).items_center().bg(t.canvas).border(1).border_color(on ? t.accent : t.border)
    .overflow_hidden().cursor_text().font_family(UI_FONT).text_size(13)
    .on_click((_e, cx) => { view.form = { ...view.form, field: id }; cx.notify(); })
    .child(div().text_color(text ? t.foreground : t.dim).child(text || placeholder))
    .when(on, (el) => el.child(div().w(1).h(15).bg(t.accent).loop("opacity", { from: 0, to: 1, period: 1000 })));
}

export function renderNewAgent(view, t, button) {
  const f = view.form;
  const list = f.programs;
  const programs = list === null
    ? div().font_family(UI_FONT).text_size(12).text_color(t.dim).child("Looking for agents…")
    : list.length === 0
      ? div().font_family(UI_FONT).text_size(12).text_color(t.dim).child("No installed agents found (programs.json).")
      : h_flex().flex_wrap().gap(6).children(list.map((p, i) => div().id(`prog-${i}`).h(26).px(8).flex().items_center()
        .font_family(UI_FONT).text_size(12).border(1)
        .border_color(i === f.pick ? t.accent : t.border).bg(i === f.pick ? `${t.accent}26` : `${t.surface}e6`)
        .text_color(i === f.pick ? t.accent : t.foreground).cursor_pointer()
        .tooltip(p.run.join(" "))
        .on_click((_e, cx) => { view.form = { ...view.form, pick: i, error: null }; cx.notify(); })
        .child(p.name)));
  const spaceList = h_flex().flex_wrap().gap(6).children(spaces().map((s) => div().id(`space-${s.id}`).h(24).px(8).flex().items_center()
    .font_family(UI_FONT).text_size(12).border(1)
    .border_color(s.id === f.space ? t.accent : t.border).bg(s.id === f.space ? `${t.accent}26` : `${t.surface}e6`)
    .text_color(s.id === f.space ? t.accent : t.foreground).cursor_pointer()
    .on_click((_e, cx) => { view.form = { ...view.form, space: s.id }; cx.notify(); })
    .child(s.name || `space ${s.index + 1}`)));
  return v_flex().id("new-agent").track_focus(view.formFocus).on_key_down((e, cx) => newAgentKey(view, e, cx))
    .size_full().p(14).gap(10).bg(`${t.popover}fa`).border(1).border_color(t.accent).border_t(3)
    .child(h_flex().items_center()
      .child(div().flex_1().font_family(SIGN_FONT).text_size(13).text_color(t.accent).child("+ NEW AGENT"))
      .child(div().font_family(UI_FONT).text_size(11).text_color(t.dim).child("it walks in through the lobby")))
    .child(v_flex().gap(4).child(label("AGENT", t)).child(programs)
      .when(f.missing > 0, (el) => el.child(div().font_family(UI_FONT).text_size(11).text_color(t.dim).child(`+${f.missing} more not installed here`))))
    .child(v_flex().gap(4).child(label("SPACE", t)).child(spaceList))
    .child(v_flex().gap(4).child(label("NAME (OPTIONAL)", t)).child(input(view, "name", "its tab's name", t)))
    .child(v_flex().gap(4).child(label("FIRST TASK (OPTIONAL)", t)).child(input(view, "task", "empty: it waits in the lobby", t)))
    .when(Boolean(f.error), (el) => el.child(div().font_family(UI_FONT).text_size(12).text_color(t.blocked).child(f.error)))
    .child(div().flex_1())
    .child(h_flex().gap(6).items_center()
      .child(div().flex_1().font_family(UI_FONT).text_size(11).text_color(t.dim).child("Enter starts · Tab next field · Esc closes"))
      .child(button("new-cancel", "CANCEL", (_e, cx) => { closeOverlay(props()?.overlay); cx.notify(); }, t))
      .child(button("new-start", "START", (_e, cx) => { start(view); cx.notify(); }, t, { on: true })));
}
