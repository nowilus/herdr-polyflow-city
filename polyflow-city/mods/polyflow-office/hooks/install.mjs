#!/usr/bin/env node
// Install (or remove) the PolyFlow Office activity hooks for Claude Code and Codex.
//   node ~/.config/herdr-app/mods/polyflow-office/hooks/install.mjs              add the hooks (idempotent)
//   node ~/.config/herdr-app/mods/polyflow-office/hooks/install.mjs --uninstall  remove only the hooks this script added
//   --statusline / --remove-statusline          Claude Code only: put the status line wrapper in front of the person's
//                                               own status line (kept in data/polyflow-office/statusline-chain.json) / take it out again
//   --dry-run                                   print what would change, write nothing
// Before any change each settings file is copied to `<file>.polyflow-backup-<time>`.
// The hook runs mods/polyflow-office/hooks/activity.mjs from the Herdr app home (HERDR_APP_HOME or ~/.config/herdr-app).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const MARKER = "polyflow-office/hooks/activity.mjs";
export const EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"];
// Claude Code also says when a session starts, is cleared or resumed: the chat follows the new conversation at once.
export const CLAUDE_EVENTS = [...EVENTS, "SessionStart"];
const ALL_EVENTS = CLAUDE_EVENTS; // every event an older or newer install may have used: cleaned on each run
const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse"]);
const TIMEOUT_S = 5;

const hasMarker = (command) => typeof command === "string" && command.replace(/\\/g, "/").includes(MARKER);

export function hookCommand(node, script) {
  return `"${node}" "${script}"`;
}

// The command line written into a provider's hook file. Codex runs hook commands with PowerShell on Windows,
// where a quoted program needs the call operator; Claude Code and other platforms take the plain command.
export function hookCommandFor({ provider, platform, node, script }) {
  const command = hookCommand(node, script);
  return provider === "codex" && platform === "win32" ? `& ${command}` : command;
}

// Settings object -> new settings object with our entries added (or removed). Never mutates the input.
export function withHooks(settings, command, { remove = false, events = EVENTS } = {}) {
  const base = settings !== null && typeof settings === "object" ? settings : {};
  const hooks = { ...(base.hooks ?? {}) };
  for (const event of ALL_EVENTS) {
    if (hooks[event] === undefined && (remove || !events.includes(event))) continue;
    const kept = (hooks[event] ?? [])
      .map((entry) => ({ ...entry, hooks: (entry.hooks ?? []).filter((h) => !hasMarker(h.command)) }))
      .filter((entry) => entry.hooks.length > 0);
    const ours = remove || !events.includes(event) ? [] : [{ ...(TOOL_EVENTS.has(event) ? { matcher: "*" } : {}), hooks: [{ type: "command", command, timeout: TIMEOUT_S }] }];
    const next = [...kept, ...ours];
    if (next.length > 0) hooks[event] = next;
    else delete hooks[event];
  }
  const out = { ...base, hooks };
  if (Object.keys(hooks).length === 0) delete out.hooks;
  return out;
}

function update(file, command, opts) {
  // No ~/.claude or ~/.codex: that program isn't installed, so there is nothing to hook.
  if (!existsSync(dirname(file))) return `${dirname(file)}: not there (program not installed), skipped`;
  if (!existsSync(file)) {
    if (opts.remove) return `${file}: not there, nothing to remove`;
  }
  let before = {};
  try {
    before = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  } catch {
    return `${file}: not valid JSON, left as it is (fix it, then run this again)`;
  }
  const after = withHooks(before, command, opts);
  if (JSON.stringify(before) === JSON.stringify(after)) return `${file}: already up to date`;
  if (opts.dryRun) return `${file}: would ${opts.remove ? "remove" : "add"} the hooks`;
  if (existsSync(file)) copyFileSync(file, `${file}.polyflow-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  writeFileSync(file, `${JSON.stringify(after, null, 2)}\n`);
  return `${file}: hooks ${opts.remove ? "removed" : "added"} (backup next to it)`;
}

// ---- The status line wrapper (Claude Code only; the hooks above are not touched) ----

export const STATUSLINE_MARKER = "polyflow-office/hooks/statusline.mjs";
const isOurs = (command) => typeof command === "string" && command.replace(/\\/g, "/").includes(STATUSLINE_MARKER);
const usable = (command) => typeof command === "string" && command.trim() !== "";

// Settings -> new settings with `statusLine.command` set to ours (install) or put back (remove). Other fields of
// `statusLine` (padding ...) stay. Never mutates the input.
//   previous: the command to put back on removal (from the chain file), or null: then `statusLine` goes away.
export function withStatusLine(settings, command, { remove = false, previous = null } = {}) {
  const base = settings !== null && typeof settings === "object" ? settings : {};
  const line = base.statusLine !== null && typeof base.statusLine === "object" ? base.statusLine : null;
  if (!remove) return { ...base, statusLine: { ...(line ?? {}), type: "command", command } };
  if (!line || !isOurs(line.command)) return base; // not ours: nothing of ours to take away
  if (usable(previous)) return { ...base, statusLine: { ...line, command: previous } };
  const { statusLine: _gone, ...rest } = base;
  return rest;
}

// The command the person's status line had before ours, for the wrapper to run after itself (null: none).
export const chainFile = (app) => join(app, "data", "polyflow-office", "statusline-chain.json");

function readChain(app) {
  try {
    const c = JSON.parse(readFileSync(chainFile(app), "utf8"))?.command;
    return usable(c) && !isOurs(c) ? c : null; // our own command is never a chain: it would call itself
  } catch {
    return null;
  }
}

// Install or remove the wrapper in `settingsFile`. The old command is kept in the chain file first, so a removal
// (or a run that dies half way) can put it back. Idempotent; a settings file that is not JSON is left alone.
export function updateStatusLine({ settingsFile, app, command, remove = false, dryRun = false }) {
  if (!existsSync(dirname(settingsFile))) return `${dirname(settingsFile)}: not there (Claude Code not installed), skipped`;
  let before = {};
  try {
    before = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
  } catch {
    return `${settingsFile}: not valid JSON, left as it is (fix it, then run this again)`;
  }
  const current = before?.statusLine?.command;
  const chain = readChain(app);
  // On install, the bar that was there becomes the chain (unless it is already ours: then the chain stays as it is,
  // and never becomes ours); no bar means no chain. On removal the chain is what goes back.
  const nextChain = remove ? chain : isOurs(current) ? chain : usable(current) ? current : null;
  const after = withStatusLine(before, command, { remove, previous: chain });
  const same = JSON.stringify(before) === JSON.stringify(after);
  if (same && (remove || nextChain === chain)) return `${settingsFile}: status line ${remove ? "is not ours, nothing to remove" : "already up to date"}`;
  if (dryRun) return `${settingsFile}: would ${remove ? "restore the previous status line" : "set the status line wrapper"}`;
  if (existsSync(settingsFile)) copyFileSync(settingsFile, `${settingsFile}.polyflow-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  if (nextChain && !remove) {
    mkdirSync(dirname(chainFile(app)), { recursive: true });
    writeFileSync(chainFile(app), `${JSON.stringify({ command: nextChain }, null, 2)}\n`);
  } else rmSync(chainFile(app), { force: true });
  if (!same) writeFileSync(settingsFile, `${JSON.stringify(after, null, 2)}\n`);
  return `${settingsFile}: status line ${remove ? "restored" : "wrapper set"} (backup next to it)`;
}

function main(argv) {
  const opts = { remove: argv.includes("--uninstall"), dryRun: argv.includes("--dry-run") };
  const app = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
  if (argv.includes("--statusline") || argv.includes("--remove-statusline")) {
    const remove = argv.includes("--remove-statusline");
    const script = join(app, "mods", "polyflow-office", "hooks", "statusline.mjs");
    if (!remove && !existsSync(script)) {
      console.error(`Install the layout first: ${script} is missing.`);
      process.exit(1);
    }
    console.log(updateStatusLine({ settingsFile: join(homedir(), ".claude", "settings.json"), app, command: hookCommand(process.execPath, script), remove, dryRun: opts.dryRun }));
    return;
  }
  const script = join(app, "mods", "polyflow-office", "hooks", "activity.mjs");
  if (!opts.remove && !existsSync(script)) {
    console.error(`Install the layout first: ${script} is missing.`);
    process.exit(1);
  }
  const commandFor = (provider) => hookCommandFor({ provider, platform: process.platform, node: process.execPath, script });
  console.log(update(join(homedir(), ".claude", "settings.json"), commandFor("claude"), { ...opts, events: CLAUDE_EVENTS }));
  console.log(update(join(homedir(), ".codex", "hooks.json"), commandFor("codex"), opts));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
