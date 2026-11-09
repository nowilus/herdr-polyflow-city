// Where an agent is in the office and what it is doing, from its Herdr status and the activity hook's record.
// Pure functions (no herdr / gpui-kit), so node can test them. polyflow-agents keeps a byte-identical copy.

// Top to bottom, as the tower draws them.
export const FLOORS = Object.freeze([
  { id: "server", no: 4, label: "SERVER", stations: ["rack", "test"] },
  { id: "research", no: 3, label: "RESEARCH", stations: ["archive", "comms"] },
  { id: "dev", no: 2, label: "DEV", stations: ["desk", "meeting"] },
  { id: "lobby", no: 1, label: "LOBBY", stations: ["help", "lounge"] },
]);

export const STALE_S = 120;

const STATION_FLOOR = { rack: "server", test: "server", archive: "research", comms: "research", desk: "dev", meeting: "dev", help: "lobby", lounge: "lobby" };

// Tool names from Claude Code and Codex.
const READ = /^(read|glob|grep|ls|notebookread|view_image|read_file|list_dir|find|search_files)$/i;
const EDIT = /^(edit|write|multiedit|notebookedit|apply_patch|write_file|create_file)$/i;
const SHELL = /^(bash|shell|exec_command|local_shell|powershell|unified_exec)$/i;
const WEB = /^(webfetch|websearch|web_search|web_fetch|fetch)$/i;
const PLAN = /^(task|agent|todowrite|update_plan|exitplanmode|enterplanmode|spawn_agent)$/i;
const ASK = /^(askuserquestion|request_user_input)$/i;
const TEST_CMD = /\b(test|tests|pytest|jest|vitest|cargo|go|build|make|cmake|gradle|mvn|tsc|lint|check|npm|pnpm|yarn|bun|dotnet)\b/i;

// Which station a tool sends the agent to.
export function stationForTool(tool, target) {
  if (typeof tool !== "string" || tool === "") return "desk";
  if (ASK.test(tool)) return "help";
  if (READ.test(tool)) return "archive";
  if (EDIT.test(tool)) return "desk";
  if (WEB.test(tool) || /^mcp__.*(search|fetch|web|browser|docs)/i.test(tool)) return "comms";
  if (PLAN.test(tool)) return "meeting";
  if (SHELL.test(tool)) return TEST_CMD.test(target ?? "") ? "test" : "rack";
  if (/^mcp__/i.test(tool)) return "comms";
  return "desk";
}

const fresh = (record, nowS) => record !== null && typeof record === "object" && typeof record.at === "number" && nowS - record.at <= STALE_S;

// { floor, station } for one agent. Status wins for the states that need the person or are over.
export function placeOf(status, record, nowS) {
  if (status === "blocked") return { floor: "lobby", station: "help" };
  if (status === "done" || status === "idle" || !status) return { floor: "lobby", station: "lounge" };
  const station = fresh(record, nowS) && record.tool ? stationForTool(record.tool, record.target) : "desk";
  return { floor: STATION_FLOOR[station], station };
}

const VERB = { archive: "reading", desk: "editing", comms: "searching", meeting: "planning", rack: "running", test: "testing", help: "asking" };

// A short line for cards: "reading main.rs", "testing npm run test", "thinking", or null when nothing fits.
export function activityText(status, record, nowS) {
  if (status === "blocked") return "needs you";
  if (status !== "working") return null;
  if (!fresh(record, nowS) || !record.tool) return "thinking";
  const verb = VERB[stationForTool(record.tool, record.target)] ?? "using";
  return record.target ? `${verb} ${record.target}` : `${verb} (${record.tool})`;
}

// The one line every view uses for what an agent is doing (the card, the chat's NOW, lists, tooltips), so they
// never disagree. `life` is chat-model.js lifeOf: an ended or gone agent says so whatever its last status was.
export function doingText(status, record, nowS, life = "live") {
  if (life === "ended" || life === "gone") return life;
  if (status === "blocked") return "needs you: answer in its terminal";
  if (status === "working") return activityText(status, record, nowS);
  return status === "done" ? "finished its turn" : "resting";
}

// Agents per floor, in FLOORS order: [{ floor, agents: [{ agent, station }] }]. Everyone on their own: a helper
// (hc run --parent) stands wherever its own status and tool put it, like any other agent.
export function byFloor(list, records, nowS) {
  const out = FLOORS.map((f) => ({ floor: f, agents: [] }));
  for (const agent of list ?? []) {
    const place = placeOf(agent.status, records?.[agent.address] ?? null, nowS);
    out.find((x) => x.floor.id === place.floor).agents.push({ agent, station: place.station });
  }
  return out;
}

// The office's people: Herdr's agents plus helpers that run without a pane of their own (hc run --parent from an
// agent), which agents() leaves out. Such a helper borrows its parent's space and tab (it has none of its own) and
// is marked `paneless`, so nothing renames or closes the parent's tab on its behalf.
const STATUSES = new Set(["working", "blocked", "done", "idle"]);
export function withHelpers(list, terminals) {
  const known = new Set((list ?? []).map((a) => a.address));
  const byAddress = Object.fromEntries((list ?? []).map((a) => [a.address, a]));
  const extra = [];
  for (const t of terminals ?? []) {
    const parent = byAddress[t?.parent];
    if (!t?.address || known.has(t.address) || !parent || !STATUSES.has(t.status) || t.state === "exited") continue;
    extra.push({
      address: t.address, pane: null, space: parent.space, space_name: parent.space_name, tab: parent.tab, tab_index: parent.tab_index,
      tab_name: t.name || `helper of ${parent.tab_name || parent.address}`, status: t.status, app: t.app ?? null,
      program: t.program ?? parent.program, title: t.title ?? "", seq: 0, pinned: false, focused: false, paneless: true,
    });
  }
  return extra.length ? [...list, ...extra] : list;
}

// The agents as a tree, for lists: each parent followed by its helpers (and theirs), in the list's order:
// [{ agent, depth }]. A helper whose parent isn't in the list is a root; a cycle can't hide anyone.
export function agentTree(list, parents) {
  const all = list ?? [];
  const known = new Set(all.map((a) => a.address));
  const kids = {};
  const roots = [];
  for (const a of all) {
    const p = parents?.[a.address];
    if (p && p !== a.address && known.has(p)) (kids[p] ??= []).push(a);
    else roots.push(a);
  }
  const out = [];
  const seen = new Set();
  const walk = (a, depth) => {
    if (seen.has(a.address)) return;
    seen.add(a.address);
    out.push({ agent: a, depth });
    for (const k of kids[a.address] ?? []) walk(k, depth + 1);
  };
  for (const a of roots) walk(a, 0);
  for (const a of all) walk(a, 0); // only a cycle leaves someone out of the roots
  return out;
}

// { helperAddress: parentAddress } from Herdr's terminals() (each with `address` and `parent`).
export function parentsOf(terminals) {
  const out = {};
  for (const t of terminals ?? []) if (t?.address && typeof t.parent === "string" && t.parent) out[t.address] = t.parent;
  return out;
}

// The internal subagents of Claude Code agents (its Agent tool; hooks/subagents.mjs), as helpers of their agent:
// subs = { [agent address]: [{ id, description, type, status, record }] }. They have no terminal, so they are
// paneless, marked `internal` (read-only: nothing can type into them) and addressed "<agent>~<id>".
export function withSubagents(list, subs) {
  const all = list ?? [];
  const extra = [];
  for (const parent of all) {
    for (const s of subs?.[parent.address] ?? []) {
      extra.push({
        address: `${parent.address}~${s.id}`, pane: null, space: parent.space, space_name: parent.space_name, tab: parent.tab,
        tab_index: parent.tab_index, tab_name: `◇ ${s.description}`, status: s.status, app: null,
        program: { name: s.type ? `subagent · ${s.type}` : "subagent" }, title: "", seq: 0, pinned: false, focused: false,
        paneless: true, internal: true, parent: parent.address,
      });
    }
  }
  return extra.length ? [...all, ...extra] : all;
}

// Their activity records, by address (merged with the hook's records).
export function subagentRecords(subs) {
  const out = {};
  for (const [parent, list] of Object.entries(subs ?? {})) for (const s of list ?? []) if (s.record) out[`${parent}~${s.id}`] = s.record;
  return out;
}

// Their parents, by address (merged with parentsOf for the tree).
export function subagentParents(list) {
  const out = {};
  for (const a of list ?? []) if (a?.internal && a.parent) out[a.address] = a.parent;
  return out;
}

// Everyone the office knows: Herdr's agents, their hc helpers and Claude Code's internal subagents.
export const crewOf = (list, terminals, subs) => withSubagents(withHelpers(list, terminals), subs);
