// What a session file says besides the messages, for the chat's side panel (adapters.mjs feeds these while it reads
// the lines, before the messages are cut to the last few hundred):
//   - the PLAN, only from an explicit plan tool: Claude Code's TaskCreate / TaskUpdate (and the older TodoWrite),
//     Codex's update_plan. Never guessed from prose, from `exec` source or from a similarly named MCP tool.
//   - the SESSION: the model, and the tokens each provider reports (Claude: summed once per message, Codex: its own
//     running total).
// Missing is null, never 0.

export const PLAN_ITEMS_MAX = 100;
export const PLAN_TEXT_MAX = 2000;
const MODEL_MAX = 120;
const STATUSES = new Set(["pending", "in_progress", "completed"]);
const CODEX_PLAN_TOOLS = new Set(["update_plan", "functions.update_plan"]);

// A session file's time (ISO text) in ms; null when it isn't one.
export function toMs(at) {
  const ms = typeof at === "string" || typeof at === "number" ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const isText = (v) => typeof v === "string" && v.trim() !== "";
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);

// A plan snapshot from raw items [{ id, text, status, activeForm }] (already checked): at most PLAN_ITEMS_MAX steps,
// each text at most PLAN_TEXT_MAX characters; the cuts are said in `truncated` / `omittedItems`.
function snapshot({ source, sourceMessageId, updatedAt, outcome, items, truncated = false }) {
  const kept = items.slice(0, PLAN_ITEMS_MAX);
  let cut = false;
  const fit = (s) => {
    if (s.length > PLAN_TEXT_MAX) cut = true;
    return clip(s, PLAN_TEXT_MAX);
  };
  const shown = kept.map((i) => ({ id: i.id, text: fit(i.text), status: i.status, activeForm: i.activeForm ? fit(i.activeForm) : null }));
  const omittedItems = items.length - kept.length;
  return { source, sourceMessageId, updatedAt, outcome, truncated: truncated || cut || omittedItems > 0, omittedItems, items: shown };
}

// Claude's TodoWrite input -> raw items, or null when anything in it is not what it should be (the whole snapshot is
// then not used). activeForm is optional.
function todoItems(input, callId) {
  if (!Array.isArray(input?.todos)) return null;
  const items = [];
  for (const [i, todo] of input.todos.entries()) {
    if (!isText(todo?.content) || !STATUSES.has(todo?.status)) return null;
    items.push({ id: `${callId}:${i}`, text: todo.content, status: todo.status, activeForm: isText(todo.activeForm) ? todo.activeForm : null });
  }
  return items;
}

// Codex's update_plan arguments (JSON text or object) -> raw items, or null when invalid.
function codexItems(args, callId) {
  let input = args;
  if (typeof args === "string") {
    try {
      input = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(input?.plan)) return null;
  const items = [];
  for (const [i, step] of input.plan.entries()) {
    if (!isText(step?.step) || !STATUSES.has(step?.status)) return null;
    items.push({ id: `${callId}:${i}`, text: step.step, status: step.status, activeForm: null });
  }
  return items;
}

// The entries of a saved Map ([[key, value], ...]) that have the shape; anything else in a damaged state is dropped.
const entriesOf = (list) => (Array.isArray(list) ? list.filter((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === "string") : []);
const newest = (map, n) => [...map.entries()].slice(-n);
// A saved text is cut one character past the limit, so that the cut is still seen (and said) when the snapshot is made.
const keepText = (s) => (typeof s === "string" ? clip(s, PLAN_TEXT_MAX + 1) : null);

export const STATE_PENDING_MAX = 64; // calls waiting for a result that are kept in a saved state (per kind)

// Follows the plan through a session file, call by call. call() sees a tool call, result() its result.
// state: what an earlier tracker's state() returned (the file is read in parts); state() is JSON-safe and bounded:
// at most PLAN_ITEMS_MAX tasks and STATE_PENDING_MAX waiting calls of each kind, no raw tool input.
export function createPlanTracker(state = null) {
  let plan = state?.plan ?? null;
  const tasks = new Map(entriesOf(state?.tasks)); // Claude Code's task list: id -> { id, text, status, activeForm }
  let tasksTouched = state?.tasksTouched === true; // a task was created at some point (so an empty list is a cleared list)
  let tasksTruncated = state?.tasksTruncated === true; // a task changed here was made before the part that was read
  const creates = new Map(entriesOf(state?.creates)); // call id -> the TaskCreate input, until its result says which task it made
  const updates = new Map(entriesOf(state?.updates)); // call id -> { input, at }
  const replaced = new Map(entriesOf(state?.replaced)); // call id of a TodoWrite / update_plan -> the plan it replaced (back if the call fails)

  const publishTasks = (callId, at) => {
    plan = snapshot({ source: "TaskList", sourceMessageId: callId, updatedAt: at, outcome: "ok", items: [...tasks.values()], truncated: tasksTruncated });
  };

  const replace = (callId, items, source, at) => {
    if (!items) return;
    replaced.set(callId, plan);
    plan = snapshot({ source, sourceMessageId: callId, updatedAt: toMs(at), outcome: "pending", items });
  };

  function applyUpdate(callId, { input, at }, res) {
    const id = String(input.taskId);
    if (!tasks.has(id)) {
      tasksTruncated = true;
      if (tasksTouched) publishTasks(callId, toMs(at));
      return;
    }
    if (input.status === "deleted") tasks.delete(id);
    else {
      const was = tasks.get(id);
      tasks.set(id, {
        ...was,
        status: STATUSES.has(input.status) ? input.status : was.status,
        text: isText(input.subject) ? input.subject : was.text,
        activeForm: isText(input.activeForm) ? input.activeForm : was.activeForm,
      });
    }
    publishTasks(callId, toMs(at));
  }

  return {
    call(name, callId, input, at) {
      if (!callId) return;
      if (name === "TaskCreate" && isText(input?.subject)) creates.set(callId, { input, at });
      else if (name === "TaskUpdate" && input?.taskId !== undefined && input?.taskId !== null) updates.set(callId, { input, at });
      else if (name === "TodoWrite") replace(callId, todoItems(input, callId), "TodoWrite", at);
      else if (CODEX_PLAN_TOOLS.has(name)) replace(callId, codexItems(input, callId), "update_plan", at);
    },
    // res: { failed, taskId (from the result's structured data, or null), success (same), text }
    result(callId, res) {
      const create = creates.get(callId);
      if (create) {
        creates.delete(callId);
        const taskId = res.taskId ?? res.text?.match(/^Task #(\w+) created/)?.[1] ?? null;
        if (!res.failed && taskId !== null) {
          const { input, at } = create;
          tasks.set(String(taskId), { id: String(taskId), text: input.subject, status: "pending", activeForm: isText(input.activeForm) ? input.activeForm : null });
          tasksTouched = true;
          publishTasks(callId, toMs(at));
        }
      }
      const update = updates.get(callId);
      if (update) {
        updates.delete(callId);
        if (!res.failed && res.success !== false) applyUpdate(callId, update, res);
      }
      if (replaced.has(callId)) {
        const before = replaced.get(callId);
        replaced.delete(callId);
        if (res.failed) plan = before;
        else if (plan?.sourceMessageId === callId) plan = { ...plan, outcome: "ok" };
      }
    },
    plan: () => plan,
    state() {
      const kept = [...tasks.entries()].slice(0, PLAN_ITEMS_MAX);
      return {
        plan,
        tasks: kept.map(([id, t]) => [id, { id: t.id, text: keepText(t.text), status: t.status, activeForm: keepText(t.activeForm) }]),
        tasksTouched,
        // Tasks beyond the limit are not kept: the list is then said to be cut.
        tasksTruncated: tasksTruncated || tasks.size > kept.length,
        creates: newest(creates, STATE_PENDING_MAX).map(([id, c]) => [id, { input: { subject: keepText(c.input.subject), activeForm: keepText(c.input.activeForm) }, at: c.at ?? null }]),
        updates: newest(updates, STATE_PENDING_MAX).map(([id, u]) => [id, {
          input: { taskId: String(u.input.taskId), status: typeof u.input.status === "string" ? u.input.status : null, subject: keepText(u.input.subject), activeForm: keepText(u.input.activeForm) },
          at: u.at ?? null,
        }]),
        replaced: newest(replaced, STATE_PENDING_MAX),
      };
    },
  };
}

const NO_TOKENS = null;

// Follows the model and the tokens through a session file. fromStart: the lines begin at the file's start (so a sum
// of Claude's per-message usage is the whole session, not just the part that was read).
export const CLAUDE_RECENT_MAX = 64; // responses whose own numbers are kept when compact (older ones are only summed)

// compact: bound the memory (the reader that is resumed from a saved state): only the CLAUDE_RECENT_MAX newest responses
// keep their own numbers, older ones are folded into one sum. A response that is repeated after it was folded is then
// counted twice, which is why the tokens say `approximate: true` from the first fold on. Not compact (the default) keeps
// every response and is exact. state: what an earlier tracker's state() returned; state() is JSON-safe.
export function createUsageTracker({ fromStart = true, compact = false } = {}, state = null) {
  let provider = state?.provider ?? null;
  let id = state?.id ?? null;
  let model = state?.model ?? null;
  const claude = new Map(entriesOf(state?.claudeRecent)); // message id (or request id) -> latest known { input, output, cacheRead, cacheWrite }
  const folded = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, known: true, count: 0, ...(state?.claudeFolded ?? {}) }; // sum of the responses that left `claude`
  let approximate = state?.approximate === true; // a response may have been counted twice (or not at all) after a fold
  let unkeyed = state?.unkeyed === true; // usage seen that can't be told apart from a repeat
  let claudeAt = state?.claudeAt ?? null;
  let claudeLast = state?.claudeLast ?? null; // the key of the newest response: its input is the size of the last request's context
  let codexTotal = state?.codexTotal ?? null; // the last running total Codex reported (or its last single report)
  let codexScope = state?.codexScope ?? "session";
  let codexAt = state?.codexAt ?? null;
  let codexContext = state?.codexContext ?? null; // input of Codex's last request
  let codexWindow = state?.codexWindow ?? null; // the context window Codex reports for the model
  const fromFileStart = state ? state.fromStart !== false : fromStart;

  const setModel = (m) => {
    if (isText(m) && !m.trim().startsWith("<")) model = clip(m.trim(), MODEL_MAX);
  };

  // The oldest response's numbers go into the sum.
  function fold() {
    const [key, g] = claude.entries().next().value;
    claude.delete(key);
    folded.input += g.input ?? 0;
    folded.output += g.output ?? 0;
    folded.cacheRead += g.cacheRead ?? 0;
    folded.cacheWrite += g.cacheWrite ?? 0;
    folded.known = folded.known && g.input !== null && g.output !== null;
    folded.count += 1;
    approximate = true;
  }

  function claudeTokens() {
    if ((claude.size === 0 && folded.count === 0) || unkeyed) return NO_TOKENS;
    const groups = [...claude.values()];
    const known = folded.known && groups.every((g) => g.input !== null && g.output !== null);
    const sum = (f) => groups.reduce((n, g) => n + f(g), 0);
    const input = known ? folded.input + folded.cacheRead + folded.cacheWrite + sum((g) => g.input + (g.cacheRead ?? 0) + (g.cacheWrite ?? 0)) : null;
    const output = known ? folded.output + sum((g) => g.output) : null;
    const last = claude.get(claudeLast);
    return {
      input, output, cachedInput: folded.cacheRead + sum((g) => g.cacheRead ?? 0), cacheWriteInput: folded.cacheWrite + sum((g) => g.cacheWrite ?? 0), reasoningOutput: null,
      total: input !== null && output !== null ? input + output : null,
      // The context of the last request: all its input, the cached part included. Claude doesn't report a window.
      context: last && last.input !== null ? last.input + (last.cacheRead ?? 0) + (last.cacheWrite ?? 0) : null, contextWindow: null,
      scope: fromFileStart ? "session" : "loaded-window", source: "claude:usage", at: claudeAt,
      ...(approximate ? { approximate: true } : {}),
    };
  }

  return {
    // An accepted Claude assistant line (right branch, not meta).
    claudeAssistant(d) {
      provider = "claude";
      if (isText(d.sessionId)) id = d.sessionId;
      const msg = d.message ?? {};
      setModel(msg.model);
      const u = msg.usage;
      if (!u || typeof u !== "object") return;
      const key = isText(msg.id) ? msg.id : isText(d.requestId) ? d.requestId : null;
      if (key === null) {
        unkeyed = true;
        return;
      }
      const was = claude.get(key) ?? { input: null, output: null, cacheRead: null, cacheWrite: null };
      const pick = (v, old) => (count(v) ?? old);
      if (compact) claude.delete(key); // a repeated response goes to the newest end
      claude.set(key, {
        input: pick(u.input_tokens, was.input), output: pick(u.output_tokens, was.output),
        cacheRead: pick(u.cache_read_input_tokens, was.cacheRead), cacheWrite: pick(u.cache_creation_input_tokens, was.cacheWrite),
      });
      if (compact) while (claude.size > CLAUDE_RECENT_MAX) fold();
      claudeAt = toMs(d.timestamp) ?? claudeAt;
      claudeLast = key;
    },
    codexMeta(payload) {
      provider = "codex";
      if (isText(payload?.id)) id = payload.id;
    },
    codexTurn(payload) {
      provider = "codex";
      setModel(payload?.model);
    },
    // An event_msg token_count payload: the running total wins; only a single report is a loaded-window figure.
    codexTokens(payload, at) {
      provider = "codex";
      const total = payload?.info?.total_token_usage;
      const last = payload?.info?.last_token_usage;
      // The size of the last request's context and the model's window, whatever else the report holds.
      if (last && typeof last === "object") codexContext = count(last.input_tokens) ?? codexContext;
      codexWindow = count(payload?.info?.model_context_window) ?? codexWindow;
      const u = total && typeof total === "object" ? total : codexTotal === null && last && typeof last === "object" ? last : null;
      if (!u) return; // info: null does not clear what was known
      const input = count(u.input_tokens);
      const output = count(u.output_tokens);
      codexScope = u === total ? "session" : "loaded-window";
      codexAt = toMs(at) ?? codexAt;
      codexTotal = {
        input, output, cachedInput: count(u.cached_input_tokens), cacheWriteInput: count(u.cache_write_input_tokens), reasoningOutput: count(u.reasoning_output_tokens),
        total: count(u.total_tokens) ?? (input !== null && output !== null ? input + output : null),
      };
    },
    // -> { provider, id, model, tokens } (tokens null when the reader saw none)
    session() {
      const tokens = provider === "codex" ? (codexTotal ? { ...codexTotal, context: codexContext, contextWindow: codexWindow, scope: codexScope, source: "codex:token_count", at: codexAt } : NO_TOKENS) : claudeTokens();
      return { provider, id, model, tokens };
    },
    state: () => JSON.parse(JSON.stringify({
      fromStart: fromFileStart, provider, id, model, unkeyed, claudeAt, claudeLast, claudeRecent: [...claude.entries()], claudeFolded: folded, approximate,
      codexTotal, codexScope, codexAt, codexContext, codexWindow,
    })),
  };
}
