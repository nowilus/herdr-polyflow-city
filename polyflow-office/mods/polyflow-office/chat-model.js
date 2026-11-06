// Shared-state keys of the chat. STATE: what the person left per agent ({ draft, open, pinned, seen }).
// HANDOFF: the chat's draft was put on the clipboard for the real terminal ({ address, at }; see chat-window.js).
export const CHAT_STATE_KEY = "polyflow-office.chat-state";
export const CHAT_HANDOFF_KEY = "polyflow-office.chat-handoff";
export const HANDOFF_SHOWN_MS = 120000;

// The desktop chat's model: what the side panel lists from the conversation. Pure (no herdr / gpui-kit), so node
// can test it.

const EDITS = /^(edit|write|multiedit|notebookedit|apply_patch|write_file|create_file)$/i;
const READS = /^(read|notebookread|view_image|read_file)$/i;
const FILE_MAX = 10;

// The files the conversation touched, newest first, each once: [{ file, verb: "edited" | "read" }].
// An edit outranks a read of the same file.
export function filesFrom(messages, max = FILE_MAX) {
  const seen = new Map();
  for (const m of [...(messages ?? [])].reverse()) {
    if (m?.role !== "tool" || typeof m.text !== "string") continue;
    const [name, ...rest] = m.text.split(" ");
    const file = rest.join(" ").trim();
    const verb = EDITS.test(name) ? "edited" : READS.test(name) ? "read" : null;
    if (!verb || !file) continue;
    const had = seen.get(file);
    if (!had) seen.set(file, verb);
    else if (had === "read" && verb === "edited") seen.set(file, verb);
  }
  return [...seen.entries()].slice(0, max).map(([file, verb]) => ({ file, verb }));
}

// Runs of tool calls fold into one line ("3 tools: Edit a.js · Bash git"), so the talk stays readable.
export function foldTools(messages) {
  const out = [];
  for (const m of messages ?? []) {
    const last = out[out.length - 1];
    if (m.role === "tool" && last?.role === "tools") out[out.length - 1] = { ...last, items: [...last.items, m.text] };
    else if (m.role === "tool") out.push({ role: "tools", items: [m.text], at: m.at });
    else out.push(m);
  }
  return out;
}

// Where an agent is in its life, from Herdr: "live" (in agents()), "ended" (its terminal finished or exited) or
// "gone" (Herdr no longer knows it).
export function lifeOf(address, agents, terminals) {
  if ((agents ?? []).some((a) => a.address === address)) return "live";
  const t = (terminals ?? []).find((x) => x?.address === address);
  return t ? (t.state === "live" ? "live" : "ended") : "gone";
}

// Whether the chat may write to the agent, and if not, why (shown instead of the box). Writing goes into the real
// terminal as typed text plus Enter, so it is refused whenever that could land somewhere wrong: a conversation not
// certainly this terminal's, or an agent waiting on an approval menu (Enter would pick an option).
export function chatAccess({ bound, status, life }) {
  if (life === "ended") return { canSend: false, reason: "This agent has ended: its conversation stays readable here." };
  if (life === "gone") return { canSend: false, reason: "This agent is gone." };
  if (bound !== "env") return { canSend: false, reason: "Can't confirm this conversation belongs to this terminal: write in its terminal." };
  if (status === "blocked") return { canSend: false, reason: "It's waiting for your answer (an approval or a question): answer in its terminal." };
  return { canSend: true, reason: null };
}
