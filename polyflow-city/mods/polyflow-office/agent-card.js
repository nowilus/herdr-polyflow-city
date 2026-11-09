// The agent card: what a click (or right-click) on an agent opens, in the tower, on a floor or in a list. The click
// has already focused the agent; the card says what it is doing and offers the next steps: its terminal, the
// floating chat, a quick message, stop, rename and close. A popup at the pointer, drawn by this same mod.
//
// The message and rename boxes are native text fields (text-field.js). The card's own draft is kept per agent under
// CARD_DRAFTS_KEY, apart from the chat's. Everything that finishes later (hc, the activity read) is applied only if
// the card still shows the same agent and the same opening (address + epoch), so an old answer never touches a card
// that moved on.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, closeOverlay, hc, openOverlay, panes, props, run, setShared, shared, spaces, terminals } from "herdr";
import { crewOf, doingText, subagentRecords, withHelpers } from "./activity.js";
import { readActivity } from "./activity-reader.js";
import { isCalm, statusLook } from "./labels.js";
import { CARD_DRAFTS_KEY, SUBAGENTS_KEY, chatAccess, clockStepMs, internalOf, lifeOf, nowCall, patchEntry, toolLine } from "./chat-model.js";
import { sendCompletionDecision, validateAgentName } from "./form-model.js";
import { createTextField, releaseTextField, renderTextField } from "./text-field.js";
import { SIGN_FONT, TITLE_SIZE, UI_FONT } from "./ui-tokens.js";
import { uiBadge } from "./ui-kit.js";

const W = 330;
const H = 320; // room for a three-line message, its error and the buttons
const RECORD_MS = 1000;
const SAVE_MS = 150;
const ENTER_GUARD_MS = 400; // the Enter that submitted a box must not also press TERMINAL on the menu it returns to

// card: { address, demo, name, status, doing } — a snapshot, so demo agents (not in agents()) get a card too.
export function openAgentCard(card) {
  if (!card?.address) return null;
  return openOverlay({ kind: "popup", at: "pointer", width: W, height: H, frame: "none", mod: "polyflow-office", props: { agentCard: card } });
}

// The card's own state on the view: view.card { address, epoch, step: menu | message | rename | close, note, nameError,
// busy, closed }, the two text fields (made when their step is first entered) and whether the draft needs saving.
export function initCard(view, cx) {
  view.card = { address: props()?.agentCard?.address ?? null, epoch: 0, step: "menu", note: null, nameError: null, busy: false, closed: false };
  view.cardMessage = null;
  view.cardRename = null;
  view.cardDirty = false;
  view.cardSubmitAt = 0;
  view.cardFocus = cx.focus_handle();
  view.cardFocus.focus();
  // The card may stay open while the agent changes (status, name, what it is doing) or goes away.
  view.cardRecord = null;
  view.cardLiveKey = null;
  syncCardClock(view, cx);
  let reading = false; // one read at a time: an older one can't land after a newer one
  const tick = (cx) => {
    syncCardTarget(view);
    syncCardClock(view, cx);
    if (reading || view.card.closed) return;
    const owner = ownerOf(view);
    reading = true;
    cx.spawn(async (cx) => {
      let record;
      try {
        // An internal subagent's record comes with the office's list of them (it has no hook file of its own).
        if (internalOf(owner.address)) record = subagentRecords(shared(SUBAGENTS_KEY))[owner.address] ?? null;
        else if (!props()?.agentCard?.demo) record = await readActivity(owner.address);
      } finally {
        reading = false;
      }
      if (!isOwner(view, owner)) return;
      if (record !== undefined) view.cardRecord = record;
      const card = props()?.agentCard ?? {};
      const agent = live(owner.address);
      const key = JSON.stringify({ record: view.cardRecord, name: agent?.tab_name, status: agent?.status,
        life: cardLife(owner.address), doing: doingOf(view, card, agent?.status ?? card.status ?? "idle") });
      // A repeated record must not turn the reader into a one-second presentation clock.
      if (key !== view.cardLiveKey) { view.cardLiveKey = key; cx.notify(); }
    });
  };
  tick(cx);
  view.cardTimers = [
    cx.timer.every(RECORD_MS, tick),
    cx.timer.every(SAVE_MS, cx => { syncCardTarget(view); syncCardClock(view, cx); if (view.cardDirty) flushCardDraft(view); }),
  ];
}

function cardCall(view) {
  const card = props()?.agentCard ?? {};
  return nowCall([], view.cardRecord, { status: live(view.card.address)?.status ?? card.status, life: cardLife(view.card.address) });
}

function syncCardClock(view, cx) {
  if (view.card.closed) return;
  const step = clockStepMs(isCalm());
  if (view.cardClockStep === step && view.cardClockTimer) return;
  view.cardClockTimer?.cancel();
  view.cardClockStep = step;
  view.cardClockTimer = cx.timer.every(step, cx => {
    if (!view.card.closed && Number.isFinite(cardCall(view)?.startedAt)) cx.notify();
  });
}

// The card goes away (its window closed): keep the draft, stop the timers, release the fields. Safe to call twice.
export function closeCard(view) {
  if (!view.card || view.card.closed) return;
  flushCardDraft(view);
  view.card = { ...view.card, closed: true, epoch: view.card.epoch + 1 };
  for (const task of view.cardTimers ?? []) task.cancel();
  view.cardClockTimer?.cancel();
  view.cardClockTimer = null;
  releaseFields(view);
}

const ownerOf = (view) => ({ address: view.card.address, epoch: view.card.epoch });
const isOwner = (view, owner) => !view.card.closed && view.card.address === owner.address && view.card.epoch === owner.epoch;

function releaseFields(view) {
  releaseTextField(view.cardMessage);
  releaseTextField(view.cardRename);
  view.cardMessage = null;
  view.cardRename = null;
}

// The overlay's props can name another agent while the view lives on: start over for it (menu, no fields, its own
// draft later). The old agent's draft is saved first. Nothing is created here, so it is safe from any timer.
function syncCardTarget(view) {
  const address = props()?.agentCard?.address;
  if (!address || view.card.closed || address === view.card.address) return;
  flushCardDraft(view);
  releaseFields(view);
  view.cardRecord = null;
  view.cardLiveKey = null;
  view.card = { address, epoch: view.card.epoch + 1, step: "menu", note: null, nameError: null, busy: false, closed: false };
}

const savedDraft = (address) => {
  const entry = shared(CARD_DRAFTS_KEY)?.[address];
  return typeof entry?.draft === "string" ? entry.draft : "";
};

// Write the message box into its agent's entry now (read back just before, so other agents' drafts stay).
function flushCardDraft(view) {
  view.cardDirty = false;
  const field = view.cardMessage;
  if (!field || field.released || !view.card.address) return;
  setShared(CARD_DRAFTS_KEY, patchEntry(shared(CARD_DRAFTS_KEY), view.card.address, { draft: field.value() }));
}

// What the card says the agent is doing: the same line as the chat's NOW and the office (activity.js doingText),
// read live; a demo agent keeps the line it was opened with.
function doingOf(view, card, status) {
  if (card.demo) return card.doing ?? doingText(status, null, 0);
  return doingText(status, view.cardRecord, Math.floor(Date.now() / 1000), lifeOf(card.address, crewOf(agents(), terminals(), shared(SUBAGENTS_KEY)), terminals()));
}

const live = (address) => crewOf(agents(), terminals(), shared(SUBAGENTS_KEY)).find((a) => a.address === address) ?? null;
const cardLife = address => internalOf(address) && !live(address) ? "ended"
  : lifeOf(address, crewOf(agents(), terminals(), shared(SUBAGENTS_KEY)), terminals());

// Why nothing may be typed into this agent now (null: it may). Checked again when a message is sent.
function refusalOf(address) {
  if (props()?.agentCard?.demo) return "A made-up demo agent: nothing to send.";
  const agent = live(address);
  return chatAccess({ bound: "env", status: agent?.status, life: cardLife(address), internal: Boolean(internalOf(address)) }).reason;
}

const errText = (err) => String(err?.message ?? err).slice(0, 120);

function setStep(view, name) {
  view.card = { ...view.card, step: name, note: null, nameError: null };
}

// Back to the menu from any step: the message draft is saved, a half-typed rename is dropped, and the keyboard goes
// back to the card (so Enter and Esc keep working there).
function backToMenu(view) {
  if (view.card.step === "message") flushCardDraft(view);
  if (view.card.step === "rename") {
    releaseTextField(view.cardRename);
    view.cardRename = null;
  }
  setStep(view, "menu");
  view.cardFocus.focus();
}

function openMessage(view) {
  syncCardTarget(view);
  if (!view.cardMessage || view.cardMessage.released) {
    view.cardMessage = createTextField({
      id: "card-message", mode: "multi", rows: [1, 3], placeholder: "Enter sends · Shift+Enter new line · Esc closes", value: savedDraft(view.card.address),
      onChange: (_v, cx) => { view.cardDirty = true; cx?.notify(); },
      onSubmit: (snap, cx) => sendMessage(view, cx, snap),
    });
  }
  setStep(view, "message");
  view.cardMessage.focus();
}

function openRename(view) {
  syncCardTarget(view);
  releaseTextField(view.cardRename);
  const field = createTextField({
    id: "card-rename", mode: "single", placeholder: "New name · Enter renames", value: live(view.card.address)?.tab_name ?? "",
    // Once an error is showing it follows what is typed.
    onChange: (v, cx) => {
      const check = validateAgentName(v);
      if (view.card.nameError) view.card = { ...view.card, nameError: check.ok ? null : check.error };
      cx?.notify();
    },
    onSubmit: (_snap, cx) => rename(view, cx),
  });
  view.cardRename = field;
  setStep(view, "rename");
  field.focus();
}

// Run an hc command for the card. A handler's cx is only good until its first await, so the call runs in a task of
// its own; `busy` always ends. done(r, cx) -> the patch for the card (or null), applied only if the card still shows
// the agent it was started for.
function hcTask(view, cx, args, done) {
  if (view.card.busy) return;
  const owner = ownerOf(view);
  view.card = { ...view.card, busy: true };
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      const r = await hc(args).catch((e) => ({ code: 1, stderr: String(e) }));
      if (isOwner(view, owner)) {
        const patch = done(r, cx) ?? {}; // may itself change the card (back to the menu), so the card is read after
        view.card = { ...view.card, ...patch };
      }
    } catch (err) {
      if (isOwner(view, owner)) view.card = { ...view.card, note: `Something went wrong: ${errText(err)}` };
    } finally {
      if (isOwner(view, owner)) view.card = { ...view.card, busy: false };
      cx.notify();
    }
  });
}

// snap: the text that went (the Enter in the box passes the one it submitted).
function sendMessage(view, cx, snap) {
  const field = view.cardMessage;
  if (!field || field.released) return;
  view.cardSubmitAt = Date.now();
  const taken = snap ?? field.snapshot();
  const text = taken.value.trim();
  if (!text || view.card.busy) return;
  const refusal = refusalOf(view.card.address);
  if (refusal) {
    view.card = { ...view.card, note: refusal };
    cx.notify();
    return;
  }
  const sent = { ...ownerOf(view), step: "message", textSnapshot: taken };
  hcTask(view, cx, ["send", sent.address, text], (r, taskCx) => {
    const now = { ...ownerOf(view), step: view.card.step, textSnapshot: field.snapshot(), closed: view.card.closed, released: field.released };
    const decision = sendCompletionDecision(sent, now, r);
    if (!decision.apply) return null;
    if (r.code !== 0) return { note: `Not sent: ${(r.stderr || "hc send failed").trim().slice(0, 120)}` };
    // Sent: clear only the text that went (anything typed meanwhile stays), and go back to the menu only if that
    // text is gone and the person is still on this step.
    if (decision.clear) field.clearIfUnchanged(taken, taskCx);
    flushCardDraft(view);
    if (decision.returnToMenu) backToMenu(view);
    return { note: live(sent.address)?.status === "working" ? "Sent while it works, just as if typed in its terminal." : "Sent." };
  });
}

function stopAgent(view, address, cx) {
  hcTask(view, cx, ["interrupt", address], (r) => ({ note: r.code === 0 ? "Stop key sent." : `Couldn't stop: ${(r.stderr || "").trim().slice(0, 120)}` }));
}

// Acts on the agent as it is now (its tab may have changed since the card was drawn). The name must be a valid tab
// name as typed; a refusal stays at the box with the text kept.
function rename(view, cx) {
  const field = view.cardRename;
  if (!field || field.released) return;
  view.cardSubmitAt = Date.now();
  const name = validateAgentName(field.value());
  const fail = (nameError) => { view.card = { ...view.card, nameError }; cx.notify(); };
  if (!name.ok) return fail(name.error);
  const agent = live(view.card.address);
  if (props()?.agentCard?.demo || internalOf(view.card.address) || !agent || agent.paneless) return fail("This one can't be renamed.");
  try {
    run("tab.rename", { id: agent.tab, name: name.value });
  } catch (err) {
    return fail(`Couldn't rename: ${errText(err)}`);
  }
  backToMenu(view);
  cx.notify();
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

// The card's keys. Typing belongs to the native boxes; this only opens the terminal (Enter on the menu). Esc is not
// ours: the host closes a popup on Esc before the mod sees it, so Esc closes the card (the message draft stays) and
// BACK is the way from a box to the menu.
export function cardKey(view, e, cx, card, deps) {
  syncCardTarget(view);
  if (view.card.step !== "menu" || e.key !== "enter") return;
  // Not the Enter that has just sent or renamed, nor a held one.
  if (e.is_held || Date.now() - view.cardSubmitAt < ENTER_GUARD_MS) return;
  deps.showTerminal(card.address);
  closeOverlay(props()?.overlay);
  cx.stop_propagation();
  cx.notify();
}

// deps: { button(id, label, action, t, opts), showTerminal(address), openChatFor(address) | null }
export function renderAgentCard(view, t, deps) {
  const card = props()?.agentCard ?? {};
  const agent = card.demo ? null : live(card.address);
  const status = agent?.status ?? card.status ?? "idle";
  const name = agent?.tab_name || card.name || card.address;
  const space = agent ? spaces().find((s) => s.id === agent.space)?.name : null;
  const look = statusLook(status);
  const tone = t[look.key] ?? t.dim;
  const close = () => closeOverlay(props()?.overlay);
  // Every click first brings the card to the agent it is showing.
  const act = (fn) => (_e, cx) => { syncCardTarget(view); fn(cx); cx.notify(); };
  const b = (id, label, fn, opts) => deps.button(`card-${id}`, label, act(fn), t, opts);
  // A moment where the props already name another agent: the menu, until the next tick starts over for it.
  const s = card.address === view.card.address ? view.card.step : "menu";
  const back = () => backToMenu(view);

  const head = v_flex().gap(2)
    .child(h_flex().gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().font_family(UI_FONT).text_size(TITLE_SIZE).text_color(t.foreground).child(name))
      .child(status === "blocked" ? uiBadge(look.word, t, { tone: "blocked", pulse: true })
        : div().px(5).py(1).font_family(SIGN_FONT).text_size(9).text_color(tone).border(1).border_color(tone).child(look.word)))
    .child(div().truncate().font_family(UI_FONT).text_size(11).text_color(t.dim)
      .child([agent?.program?.name, space, card.address].filter(Boolean).join(" · ")));
  const tool = card.demo ? null : toolLine(cardCall(view), Date.now(), { calm: isCalm() });
  const doing = v_flex().gap(2)
    .child(div().font_family(UI_FONT).text_size(12).text_color(t.muted).child(doingOf(view, card, status)))
    .when(Boolean(tool), el => el.child(div().font_family(UI_FONT).text_size(11).text_color(t.dim).child(tool)));

  let body;
  if (card.demo) {
    body = div().font_family(UI_FONT).text_size(12).text_color(t.dim).child("A made-up demo agent: nothing to open.");
  } else if (!agent) {
    body = div().font_family(UI_FONT).text_size(12).text_color(t.dim)
      .child(refusalOf(card.address));
  } else if (agent.internal) {
    // Claude Code's internal subagent: it lives inside its agent, so nothing can be typed into it or stopped alone.
    const parent = live(agent.parent);
    body = v_flex().gap(6)
      .child(div().font_family(UI_FONT).text_size(11).text_color(t.dim)
        .child(refusalOf(card.address)))
      .child(div().font_family(UI_FONT).text_size(11).text_color(t.dim).child(`Its agent: ${parent?.tab_name || agent.parent}`))
      .child(h_flex().gap(6)
        .child(b("parent", "ITS AGENT", () => { deps.showTerminal(agent.parent); close(); }, { on: true, title: "The terminal of the agent that runs it" }))
        .when(Boolean(deps.openChatFor), (el) => el.child(b("chat", "CHAT", () => { deps.openChatFor(card.address); close(); }, { title: "Its conversation (read only)" }))));
  } else if (s === "message" && view.cardMessage) {
    body = v_flex().gap(6)
      .child(renderTextField(view.cardMessage, t))
      .child(h_flex().gap(6).child(b("send", view.card.busy ? "SENDING…" : "SEND", (cx) => sendMessage(view, cx),
        { on: true, disabled: view.card.busy || !view.cardMessage.value().trim() }))
        .child(b("back", "BACK", back)));
  } else if (s === "rename" && view.cardRename) {
    body = v_flex().gap(6)
      .child(renderTextField(view.cardRename, t))
      .when(Boolean(view.card.nameError), (el) => el.child(div().font_family(UI_FONT).text_size(11).text_color(t.blocked).child(view.card.nameError)))
      .child(h_flex().gap(6).child(b("rename-ok", "RENAME", (cx) => rename(view, cx), { on: true }))
        .child(b("back", "BACK", back)));
  } else if (s === "close") {
    body = v_flex().gap(6)
      .child(div().font_family(UI_FONT).text_size(12).text_color(status === "working" ? t.blocked : t.muted)
        .child(`${status === "working" ? "It's working: closing stops that work. " : ""}Close this agent and its terminal?${tabHelpers(agent).length ? ` Its ${tabHelpers(agent).length} helper(s) end too.` : ""}`))
      .child(h_flex().gap(6).child(b("close-ok", "CLOSE IT", () => { closeAgent(card.address); close(); }, { on: true }))
        .child(b("back", "KEEP", back)));
  } else {
    body = v_flex().gap(6)
      .child(h_flex().gap(6).flex_wrap()
        .child(b("terminal", "TERMINAL", () => { deps.showTerminal(card.address); close(); }, { on: true, title: "Its real terminal (Enter)" }))
        .when(Boolean(deps.openChatFor), (el) => el.child(b("chat", "CHAT", () => { deps.openChatFor(card.address); close(); }, { title: "Its conversation in the current chat place" })))
        .when(status !== "blocked", (el) => el.child(b("message", "MESSAGE", () => openMessage(view), { title: "Type a message for it" })))
        .when(status === "working" || status === "blocked", (el) => el.child(b("stop", "STOP", (cx) => stopAgent(view, card.address, cx), { title: "Press its stop key" }))))
      .child(h_flex().gap(6)
        .when(!agent.paneless, (el) => el.child(b("rename", "RENAME", () => openRename(view), { title: "Rename it (its tab's name)" })))
        .child(b("close", "CLOSE…", () => setStep(view, "close"), { title: "End it (asks first)" })));
  }

  return v_flex().id("agent-card").track_focus(view.cardFocus).on_key_down((e, cx) => cardKey(view, e, cx, card, deps))
    .size_full().p(10).gap(8).bg(`${t.popover}f8`).border(1).border_color(t.accent).border_l(3)
    .child(head).child(doing).child(body)
    .when(Boolean(view.card.note), (el) => el.child(div().font_family(UI_FONT).text_size(11).text_color(t.accent).child(view.card.note)));
}
