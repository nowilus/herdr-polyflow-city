// Host adapter: one office coordinator, lightweight controllers even while hidden, one leased session.
import { div } from "gpui-kit";
import { agents, focused, layout, run, setShared, shared, terminals } from "herdr";
import { crewOf } from "./activity.js";
import { SUBAGENTS_KEY, internalOf } from "./chat-model.js";
import { randomToken } from "./cost-meter.js";
import { KEY, layoutCommands, officeState } from "./modes.js";
import { chatIsOpen, chatView, closeChat, handoffFor, openChat, renderChatBar, switchToTerminal } from "./chat-window.js";
import { closeChatSession, focusChatSession, openChatSession, renderChatSession } from "./desk-chat.js";
import { CHAT_FOCUS_KEY, CHAT_OWNER_KEY, CHAT_TARGET_KEY, FOCUS_REQUEST_MS, PLACE_NODES, RETARGET_MS, SCREEN_CHAT_KEY, STALE_OWNER_MS, SYNC_MS, chatTargetOf, placeShows, screenChatCommands, stackCommands } from "./chat-place.js";

export function currentChatTarget() {
  const f = focused();
  const native = agents();
  return chatTargetOf({ agents: native, crew: crewOf(native, terminals(), shared(SUBAGENTS_KEY)),
    focusedAgent: f?.agent, focusedTerminal: f?.terminal, pick: shared(CHAT_TARGET_KEY) });
}

// Effective tree from layout(), including hidden ancestors and inactive stack children (checked on the host).
function visibleNode(tree, id, visible = true) {
  if (!tree || typeof tree !== "object") return false;
  const shown = visible && !tree.hidden;
  if (tree.id === id) return shown;
  return (tree.children ?? []).some(child => visibleNode(child, id,
    shown && (tree.type !== "stack" || !tree.active || child.id === tree.active)));
}

function slot(place, target, { screen = false } = {}) {
  return placeShows(place, { state: officeState(shared(KEY)), screen,
    screenShown: shared(SCREEN_CHAT_KEY)?.shown !== false, view: chatView(),
    internal: Boolean(internalOf(target)), hasTarget: Boolean(target), floatOpen: chatIsOpen() });
}

function actuallyShown(place) {
  return place === "float" || visibleNode(layout(), PLACE_NODES[place]?.chat);
}

const same = (a, b) => a?.place === b?.place && a?.address === b?.address;
const record = () => shared(CHAT_OWNER_KEY);

export function initChatCoordinator(view, cx) {
  if (view.screen && typeof shared(SCREEN_CHAT_KEY)?.shown !== "boolean") setShared(SCREEN_CHAT_KEY, { shown: true });
  view.chatRuntime = randomToken(16);
  view.chatStartedAt = Date.now();
  view.chatCandidate = { address: currentChatTarget(), since: Date.now() - RETARGET_MS };
  // An owner of this runtime is never discarded. One of a previous runtime is kept for STALE_OWNER_MS: a still-running
  // old copy releases it on its next tick; a hot reload stops the old build without close, so then the coordinator
  // clears it (syncChatCoordinator). Owners of the current runtime always carry it in their token.
  setShared(CHAT_OWNER_KEY, { runtime: view.chatRuntime, desired: null, owner: record()?.owner ?? null });
  syncChatCoordinator(view);
  view.chatCoordinatorTimer = cx.timer.every(SYNC_MS, () => syncChatCoordinator(view));
}

export function syncChatCoordinator(view) {
  if (view.chatCoordinatorClosed) return;
  const r = record();
  if (r?.runtime !== view.chatRuntime) return;
  if (r.owner && !String(r.owner.token ?? "").startsWith(`${view.chatRuntime}:`) && Date.now() - view.chatStartedAt >= STALE_OWNER_MS) {
    setShared(CHAT_OWNER_KEY, { ...r, owner: null });
  }
  const state = officeState(shared(KEY));
  const target = currentChatTarget();
  if (view.chatCandidate?.address !== target) view.chatCandidate = { address: target, since: Date.now() };
  const stable = Date.now() - view.chatCandidate.since >= RETARGET_MS;
  const place = view.screen ? "screen" : view.chatStandalone || state.mode === "side" ? "float" : state.chat;
  const showing = slot(place, target, view);
  if (view.screen) {
    const shown = shared(SCREEN_CHAT_KEY)?.shown !== false;
    const signature = `${shown}:${showing.child}`;
    if (signature !== view.chatScreenState) {
      for (const [name, args] of screenChatCommands(shown, showing.child)) run(name, args);
      view.chatScreenState = signature;
    }
  }
  const signature = JSON.stringify(state);
  if (!view.screen && !view.chatStandalone && signature !== view.chatLayoutState) {
    for (const [name, args] of layoutCommands(state, showing.child)) run(name, args);
    view.chatLayoutState = signature;
  }
  const select = `${place}:${showing.child}`;
  if (!view.screen && select !== view.chatLayoutChild) {
    for (const [name, args] of stackCommands(place, showing.child)) run(name, args);
    view.chatLayoutChild = select;
  }
  // FLOAT teardown releases its lease, before a dock may claim it.
  if ((view.screen || !view.chatStandalone && (state.mode === "off" || (state.mode === "full" && state.chat !== "float"))) && chatIsOpen()) closeChat();
  const desired = stable && showing.active && target && actuallyShown(place) ? { place, address: target } : null;
  const latest = record();
  if (latest?.runtime === view.chatRuntime && !same(latest.desired, desired)) setShared(CHAT_OWNER_KEY, { ...latest, desired });
}

export function setScreenChatShown(shown) {
  setShared(SCREEN_CHAT_KEY, { shown: Boolean(shown) });
  const showing = slot("screen", currentChatTarget(), { screen: true });
  for (const [name, args] of screenChatCommands(Boolean(shown), showing.child)) run(name, args);
}

export function closeChatCoordinator(view) {
  view.chatCoordinatorClosed = true;
  view.chatCoordinatorTimer?.cancel();
  const r = record();
  if (r?.runtime === view.chatRuntime) setShared(CHAT_OWNER_KEY, { ...r, desired: null });
}

export function initChatPlace(view, place, cx) {
  view.chat = null;
  view.chatPlace = place;
  view.chatClosed = false;
  view.chatRuntime = record()?.runtime;
  view.chatOwnerToken = `${view.chatRuntime ?? "waiting"}:${randomToken(16)}`;
  // A newly mounted child may trust desired: the coordinator already stabilized its target.
  // This avoids adding target debounce to the first CHAT selection after a terminal-only start.
  view.chatCandidate = { address: currentChatTarget(), since: Date.now() - RETARGET_MS };
  syncChatPlace(view, cx);
  view.chatSyncTimer = cx.timer.every(SYNC_MS, cx => syncChatPlace(view, cx));
}

function releaseOwner(view) {
  // Flush draft/UI synchronously BEFORE publishing the acknowledgement.
  closeChatSession(view.chat);
  view.chat = null;
  const r = record();
  if (r?.owner?.token === view.chatOwnerToken) setShared(CHAT_OWNER_KEY, { ...r, owner: null });
}

export function syncChatPlace(view, cx) {
  if (view.chatClosed) return;
  let r = record();
  const target = currentChatTarget();
  const active = slot(view.chatPlace, target, { screen: view.chatPlace === "screen" }).active && actuallyShown(view.chatPlace);
  const wanted = active && target ? { place: view.chatPlace, address: target } : null;
  const runtimeChanged = view.chatRuntime !== r?.runtime;
  if (view.chat && (runtimeChanged || !same(r?.desired, wanted) || !same(r?.owner, wanted) || r?.owner?.token !== view.chatOwnerToken || view.chat.desk.address !== target || !wanted)) {
    releaseOwner(view);
    cx.notify();
  }
  if (runtimeChanged) view.chatOwnerToken = `${r?.runtime ?? "waiting"}:${randomToken(16)}`;
  view.chatRuntime = r?.runtime;
  // Target stabilization is independent of CHAT/TERMINAL and slot visibility.
  if (!target) view.chatCandidate = null;
  else if (runtimeChanged || view.chatCandidate?.address !== target) view.chatCandidate = { address: target, since: Date.now() };
  if (!wanted) return;
  if (view.chat) { focusRequested(view, cx); return; }
  if (Date.now() - view.chatCandidate.since < RETARGET_MS) return;
  // Re-read after a close; its ack must not overwrite a newer desired/runtime.
  r = record();
  if (!r?.runtime || r.runtime !== view.chatRuntime || r.owner || !same(r.desired, wanted)) return;
  // No await between validation, claim and open: host calls run synchronously in this callback.
  setShared(CHAT_OWNER_KEY, { ...r, owner: { token: view.chatOwnerToken, ...wanted } });
  try {
    view.chat = openChatSession(target, cx, { place: view.chatPlace, focusInput: false });
  }
  catch (error) { releaseOwner(view); throw error; }
  focusRequested(view, cx);
  cx.notify();
}

// Explicit token only: returning to a place, retargeting or rendering cannot take the keyboard.
function focusRequested(view, cx) {
  const request = shared(CHAT_FOCUS_KEY);
  if (!request || typeof request.token !== "string" || !request.token || request.address !== view.chat?.desk.address
    || request.place !== view.chatPlace || !Number.isFinite(request.at)) return;
  const age = Date.now() - request.at;
  if (age < 0 || age > FOCUS_REQUEST_MS) {
    if (shared(CHAT_FOCUS_KEY)?.token === request.token) setShared(CHAT_FOCUS_KEY, null);
    return;
  }
  if (!focusChatSession(view.chat)) return;
  const latest = shared(CHAT_FOCUS_KEY);
  if (latest?.token === request.token) setShared(CHAT_FOCUS_KEY, null);
  cx.notify();
}

export function closeChatPlace(view) {
  if (view.chatClosed) return;
  view.chatClosed = true;
  view.chatSyncTimer?.cancel();
  releaseOwner(view);
  view.chatCandidate = null;
}

export function renderChatPlace(view, t, deps) {
  // Also guard the frame between a native focus change and the next control tick.
  const target = currentChatTarget();
  const r = record();
  if (view.chat && r?.runtime === view.chatRuntime && view.chat.desk.address === target && same(r?.desired, { place: view.chatPlace, address: target })
    && r?.owner?.token === view.chatOwnerToken && slot(view.chatPlace, target, { screen: view.chatPlace === "screen" }).active && actuallyShown(view.chatPlace)) {
    return renderChatSession(view.chat, t, { ...deps, showTerminal: cx => switchToTerminal(target, cx, { place: view.chatPlace }) });
  }
  return div().size_full().p(12).text_color(t.dim).child(target ? "Switching conversation…" : "No agent selected.");
}

// A never-shown chat child does not exist yet. Its always-visible bar can select CHAT.
export function initChatBar(view, cx) {
  view.chatBarAddress = view.chatBar;
  const sync = cx => {
    if (view.chatBarClosed) return;
    const target = currentChatTarget();
    const child = slot(view.chatPlace, target, { screen: view.chatPlace === "screen" }).child;
    if (view.chatPlace === "float" && chatIsOpen() && child === "terminal" && target && view.chatBarAddress !== target) openChat(target);
    view.chatBarAddress = target;
    const signature = `${target}:${child}:${record()?.owner?.token ?? ""}:${handoffFor(target)}:${agents().find(a => a.address === target)?.status ?? ""}`;
    if (signature !== view.chatBarState) {
      for (const [name, args] of stackCommands(view.chatPlace, child)) run(name, args);
      view.chatBarState = signature;
      cx.notify();
    }
  };
  sync(cx);
  view.chatBarTimer = cx.timer.every(SYNC_MS, sync);
}

export function closeChatBar(view) {
  view.chatBarClosed = true;
  view.chatBarTimer?.cancel();
}

export function renderPlaceBar(view, t, button) {
  const target = currentChatTarget();
  const r = record();
  const owner = r?.owner;
  const address = owner?.place === view.chatPlace && owner.address === target && owner.token?.startsWith(`${r.runtime}:`) ? owner.address : null;
  return renderChatBar(address ?? target, t, button, { place: view.chatPlace,
    switching: slot(view.chatPlace, target, { screen: view.chatPlace === "screen" }).child === "chat" && Boolean(target) && !address });
}
