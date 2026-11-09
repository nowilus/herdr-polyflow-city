// The programs the new-agent form offers, per machine of the chosen space. The rules (cache age, which answer still
// counts, when a program may start) are in form-model.js; this file asks Herdr (knownAgents, machines, spaces) and
// keeps the cache in shared state. Asking never blocks the form: it opens at once, the list arrives later and never
// takes the keyboard.
import { knownAgents, machines, setShared, shared, spaces } from "herdr";
import { applyProgramsResult, beginPrograms, isFreshTime, machineKey, machineLayout, mergeProgramsCache, normalizePrograms } from "./form-model.js";

// { [machineKey]: { checkedAt, programs, missing } }: only answers that worked, so an error never becomes an empty list.
export const PROGRAMS_CACHE_KEY = "polyflow-office.agent-programs-v1";

export const machineLabel = (on) => on ?? "local";

const spaceById = (id) => spaces().find((s) => s.id === id) ?? null;

// Mark the programs as not available (no space, machine offline): not loading, and START stays off.
function unavailable(view, reason) {
  view.form = { ...view.form, programsState: "unavailable", programsError: reason, programs: [], missing: 0, requestId: view.form.requestId + 1 };
}

// Ask for the programs of the machine `on` (null: this computer). Uses a fresh cached answer; otherwise asks the
// host once the machine's layout is ready (the watcher asks later if it is still loading). Event handlers and
// timers only.
export function refreshPrograms(view, on, cx) {
  const layout = machineLayout(machines(), on);
  const begun = beginPrograms(view.form, on, shared(PROGRAMS_CACHE_KEY), Date.now());
  view.form = { ...begun.form, layoutSeen: layout };
  cx.notify();
  if (layout === "unavailable") return unavailable(view, `${machineLabel(on)} isn't available.`); // even a cached list can't start there
  if (!begun.needFetch || layout !== "ready") return;
  fetchPrograms(view, on, begun.request, cx);
}

function fetchPrograms(view, on, request, cx) {
  const startedAt = Date.now();
  cx.spawn(async (cx) => {
    let result;
    try {
      const { programs, missing } = normalizePrograms(await knownAgents({ on }));
      const checkedAt = Date.now();
      setShared(PROGRAMS_CACHE_KEY, mergeProgramsCache(shared(PROGRAMS_CACHE_KEY), request.machineKey, { startedAt, checkedAt, programs, missing }));
      result = { ok: true, programs, missing, checkedAt };
    } catch {
      result = { ok: false, error: `Can't check programs on ${machineLabel(on)}.` };
    }
    // The form may have moved on (another space, closed): then the answer counts for the cache only.
    view.form = applyProgramsResult(view.form, request, result);
    cx.notify();
  });
}

// A space was picked: its machine decides the list. The typed name and task stay; a list of another machine is
// never offered meanwhile.
export function pickSpace(view, spaceId, cx) {
  view.form = { ...view.form, space: spaceId, error: null };
  const space = spaceById(spaceId);
  if (!space) {
    unavailable(view, "There's no space to start it in.");
    cx.notify();
    return;
  }
  refreshPrograms(view, space.machine, cx);
}

// RETRY after an error.
export function retryPrograms(view, cx) {
  const space = spaceById(view.form.space);
  if (space) refreshPrograms(view, space.machine, cx);
}

// Every second, cheap: notices that the space's machine changed, that a machine came or went (layout), and that the
// list is older than the cache allows. It asks only on such a change; an error is retried by RETRY, not here.
export function watchPrograms(view, cx) {
  const f = view.form;
  if (f.closed || f.starting) return;
  const space = spaceById(f.space);
  if (!space) {
    if (f.programsState !== "unavailable") unavailable(view, "That space is gone.");
    return;
  }
  if (machineKey(space.machine) !== f.machineKey) return refreshPrograms(view, space.machine, cx);
  const layout = machineLayout(machines(), space.machine);
  if (layout !== f.layoutSeen) {
    const wasWaiting = f.programsState === "loading" || f.programsState === "unavailable";
    view.form = { ...f, layoutSeen: layout };
    if (layout === "unavailable") unavailable(view, `${machineLabel(space.machine)} isn't available.`);
    else if (layout === "ready" && wasWaiting) refreshPrograms(view, space.machine, cx);
    cx.notify();
    return;
  }
  if (layout === "ready" && f.programsState === "ready" && !isFreshTime(f.checkedAt, Date.now())) refreshPrograms(view, space.machine, cx);
}
