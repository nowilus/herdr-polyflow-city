// The rules of the office's forms, pure (no herdr / gpui-kit) so node can test them: agent names, which field comes
// next, the programs a machine offers, and what a finished send may change. The views (agent-card.js, new-agent.js)
// and the program loader (agent-programs.js) only apply these answers.

export const NAME_MAX = 32;
export const NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;
export const PROGRAMS_TTL_MS = 60000;
export const NAME_HINT = "Use 1–32 characters: a–z, 0–9, - or _.";
const FIELDS = ["name", "task"];

// A tab's name as typed: checked as it is (no trimming, no lower-casing, no cutting), so what is refused is
// what the person sees. optional: an empty name is fine and means "no name" (value null).
// -> { ok: true, value: string | null } | { ok: false, error }
export function validateAgentName(raw, { optional = false } = {}) {
  if (typeof raw !== "string") return { ok: false, error: "Name is required." };
  if (raw === "") return optional ? { ok: true, value: null } : { ok: false, error: "Name is required." };
  return NAME_PATTERN.test(raw) ? { ok: true, value: raw } : { ok: false, error: NAME_HINT };
}

// Tab / Shift+Tab between the new-agent form's boxes; wraps. An unknown field starts at the first.
export function nextFormField(current, direction) {
  const at = FIELDS.indexOf(current);
  if (at < 0) return FIELDS[0];
  return FIELDS[(at + (direction < 0 ? -1 : 1) + FIELDS.length) % FIELDS.length];
}

// Key bindings of a form field that moves through the form (Tab, Shift+Tab) and closes it (Esc). The native editor has
// its own bindings in a context nested inside the field's box (a multi-line editor takes Shift+Tab to un-indent before
// an ancestor's binding is asked), so each key is bound twice: on the box's context and on the editor's context inside
// it ("box > editor"; a name that doesn't exist matches nothing and does no harm). -> [{ keystroke, action, context }]
export const NATIVE_EDITOR_CONTEXTS = ["Input", "Textarea", "TextArea", "Editor"];
export function fieldNavBindings({ nav, cancel, next, prev }) {
  const keys = [["escape", cancel], ["tab", next], ["shift-tab", prev]];
  return keys.flatMap(([keystroke, action]) => [nav, ...NATIVE_EDITOR_CONTEXTS.map((c) => `${nav} > ${c}`)].map((context) => ({ keystroke, action, context })));
}

// A Tab press that arrives twice (as an action and as a key event) is one press: the second within this time is ignored.
export const NAV_REPEAT_MS = 60;
export const isNavRepeat = (lastAt, now) => Number.isFinite(lastAt) && now - lastAt >= 0 && now - lastAt < NAV_REPEAT_MS;

// The key of a machine in the programs cache: local (null) never equals a named machine.
export const machineKey = (on) => JSON.stringify(on ?? null);

const isText = (v) => typeof v === "string" && v !== "";

// What knownAgents returned -> { programs: [{ key, name, run }] (installed and startable, host order, first of a
// key wins), missing: how many startable ones are not installed }. Anything malformed is dropped, never turned
// into a command.
export function normalizePrograms(rows) {
  if (!Array.isArray(rows)) return { programs: [], missing: 0 };
  const seen = new Set();
  const programs = [];
  let missing = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object" || !isText(row.key) || seen.has(row.key)) continue;
    if (!Array.isArray(row.run) || row.run.length === 0 || !row.run.every(isText)) continue;
    seen.add(row.key);
    if (row.installed === true) programs.push({ key: row.key, name: isText(row.name) ? row.name : row.key, run: [...row.run] });
    else missing += 1;
  }
  return { programs, missing };
}

// The program to keep selected after the list changed: the same key if it is still there, else the first, else null.
export function selectProgramKey(programs, previousKey) {
  const list = Array.isArray(programs) ? programs : [];
  if (previousKey != null && list.some((p) => p.key === previousKey)) return previousKey;
  return list[0]?.key ?? null;
}

// Whether a reply to a programs request still belongs to the form: same request, same machine, form still open.
export function canApplyPrograms(request, current) {
  return Boolean(request && current && !current.closed && request.requestId === current.requestId && request.machineKey === current.machineKey);
}

// The same text, untouched since: the raw value (whitespace counts) and the revision both match.
export function sameTextSnapshot(a, b) {
  return Boolean(a && b && typeof a.value === "string" && a.value === b.value && a.revision === b.revision);
}

// A check made at `checkedAt` still counts for a minute; a future or broken time is stale.
export function isFreshTime(checkedAt, now) {
  if (!Number.isFinite(checkedAt) || !Number.isFinite(now)) return false;
  const age = now - checkedAt;
  return age >= 0 && age <= PROGRAMS_TTL_MS;
}

// A cache entry { checkedAt, programs, missing } is fresh for a minute.
export function isProgramsCacheFresh(entry, now) {
  return Boolean(entry) && typeof entry === "object" && Array.isArray(entry.programs) && isFreshTime(entry.checkedAt, now);
}

// How a machine's layout stands, from machines(): "ready" | "loading" | "unavailable". This computer (null) is
// "ready" when the list has no entry for it: starting here can't depend on that entry. A named machine the list
// doesn't name is "loading".
export function machineLayout(list, on) {
  const key = machineKey(on);
  const found = (Array.isArray(list) ? list : []).find((m) => m && machineKey(m.name) === key);
  if (found?.layout === "ready" || found?.layout === "unavailable") return found.layout;
  return found || on != null ? "loading" : "ready";
}

// The programs cache (machineKey -> { checkedAt, programs, missing }) with one machine's answer added. An answer
// whose question was asked before the cached one was taken is older news: the cache stays as it is.
// entry: { startedAt, checkedAt, programs, missing }. A new map.
export function mergeProgramsCache(cache, key, entry) {
  const base = cache && typeof cache === "object" && !Array.isArray(cache) ? cache : {};
  const had = base[key];
  if (had && Number.isFinite(had.checkedAt) && had.checkedAt > entry.startedAt) return base;
  return { ...base, [key]: { checkedAt: entry.checkedAt, programs: entry.programs, missing: entry.missing } };
}

// The form asks for the programs of a machine (a space picked, a retry, an expiry). Gives the form to show and the
// request to match the answer to. A fresh cached answer is used at once (needFetch false); otherwise the form is
// "loading": the list of another machine is dropped (never startable here), that of the same machine stays on show.
// form: { machineKey, programs, missing, programKey, requestId, checkedAt }; cache: the shared map; on: machine name or null.
export function beginPrograms(form, on, cache, now) {
  const key = machineKey(on);
  const request = { requestId: (form.requestId ?? 0) + 1, machineKey: key };
  const base = { ...form, machine: on ?? null, ...request, programsError: null };
  const entry = cache?.[key];
  if (isProgramsCacheFresh(entry, now)) {
    const programs = entry.programs;
    return { form: { ...base, programs, missing: entry.missing ?? 0, programsState: "ready", checkedAt: entry.checkedAt, programKey: selectProgramKey(programs, form.programKey) }, request, needFetch: false };
  }
  const same = form.machineKey === key;
  return { form: { ...base, programs: same ? form.programs : [], missing: same ? form.missing : 0, programsState: "loading" }, request, needFetch: true };
}

// An answer to a request. result: { ok: true, programs, missing, checkedAt } | { ok: false, error }. A stale one (other
// request or machine, form closed) changes nothing, so an old reply can never end a newer loading. A transport
// error is an error, not an empty list.
export function applyProgramsResult(form, request, result) {
  if (!canApplyPrograms(request, form)) return form;
  if (!result?.ok) return { ...form, programs: [], missing: 0, programKey: null, programsState: "error", programsError: result?.error ?? "Can't check programs." };
  const programs = Array.isArray(result.programs) ? result.programs : [];
  return { ...form, programs, missing: result.missing ?? 0, programsState: "ready", programsError: null, checkedAt: result.checkedAt, programKey: selectProgramKey(programs, form.programKey) };
}

// May a program start now, and if not, why. spaceInfo: the space as spaces() lists it now (or null); layout: its
// machine's layout; form: { machineKey, programsState, programKey, programs }. refresh: the list belongs to another
// machine than the space's now, so ask again.
// -> { ok: true, program } | { ok: false, refresh, reason }
export function launchGuard({ spaceInfo, layout, form }) {
  if (!spaceInfo) return { ok: false, refresh: false, reason: "That space is gone." };
  if (machineKey(spaceInfo.machine) !== form.machineKey) return { ok: false, refresh: true, reason: "That space moved to another machine: checking its programs…" };
  if (layout === "unavailable") return { ok: false, refresh: false, reason: "That machine isn't available." };
  if (layout !== "ready") return { ok: false, refresh: false, reason: "That machine is still loading." };
  if (form.programsState === "loading") return { ok: false, refresh: false, reason: "Still checking programs…" };
  if (form.programsState !== "ready") return { ok: false, refresh: false, reason: form.programsError ?? "Programs aren't available." };
  const program = (form.programs ?? []).find((p) => p.key === form.programKey);
  return program ? { ok: true, program } : { ok: false, refresh: false, reason: "Pick a program to start." };
}

// What a finished send may change, given what was sent and what the card shows now.
// sent: { address, epoch, step, textSnapshot }; current: the same plus { closed, released }; result: { code }.
// -> { apply: touch the card at all, clear: empty the field, returnToMenu: go back to the menu }
export function sendCompletionDecision(sent, current, result) {
  const alive = Boolean(sent && current) && !current.closed && !current.released && sent.address === current.address && sent.epoch === current.epoch;
  if (!alive) return { apply: false, clear: false, returnToMenu: false };
  const clear = result?.code === 0 && sameTextSnapshot(sent.textSnapshot, current.textSnapshot);
  return { apply: true, clear, returnToMenu: clear && sent.step === "message" && current.step === "message" };
}

// The arguments of "tab.new" from the form as typed. -> { ok: true, args: { space, argv, name?, task? }, named }
// | { ok: false, field: "name" | null, error }. Whether the space still exists and its machine is ready is
// checked by the caller just before.
export function buildNewAgentArgs({ space, program, rawName, rawTask }) {
  if (!space) return { ok: false, field: null, error: "There's no space to start it in." };
  if (!program || !Array.isArray(program.run) || program.run.length === 0) return { ok: false, field: null, error: "Pick a program to start." };
  const name = validateAgentName(rawName, { optional: true });
  if (!name.ok) return { ok: false, field: "name", error: name.error };
  const task = String(rawTask ?? "").trim();
  const args = { space, argv: program.run, ...(name.value ? { name: name.value } : {}), ...(task ? { task } : {}) };
  return { ok: true, args, named: name.value !== null };
}
