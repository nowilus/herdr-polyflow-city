#!/usr/bin/env node
// Install (or remove) the PolyFlow Office activity hooks for Claude Code and Codex.
//   node ~/.config/herdr-app/mods/polyflow-office/hooks/install.mjs              add the hooks (idempotent)
//   node ~/.config/herdr-app/mods/polyflow-office/hooks/install.mjs --uninstall  remove only the hooks this script added
//   --dry-run                                   print what would change, write nothing
// Before any change each settings file is copied to `<file>.polyflow-backup-<time>`.
// The hook runs mods/polyflow-office/hooks/activity.mjs from the Herdr app home (HERDR_APP_HOME or ~/.config/herdr-app).
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const MARKER = "polyflow-office/hooks/activity.mjs";
export const EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"];
const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse"]);
const TIMEOUT_S = 5;

const hasMarker = (command) => typeof command === "string" && command.replace(/\\/g, "/").includes(MARKER);

export function hookCommand(node, script) {
  return `"${node}" "${script}"`;
}

// Settings object -> new settings object with our entries added (or removed). Never mutates the input.
export function withHooks(settings, command, { remove = false } = {}) {
  const base = settings !== null && typeof settings === "object" ? settings : {};
  const hooks = { ...(base.hooks ?? {}) };
  for (const event of EVENTS) {
    const kept = (hooks[event] ?? [])
      .map((entry) => ({ ...entry, hooks: (entry.hooks ?? []).filter((h) => !hasMarker(h.command)) }))
      .filter((entry) => entry.hooks.length > 0);
    const ours = remove ? [] : [{ ...(TOOL_EVENTS.has(event) ? { matcher: "*" } : {}), hooks: [{ type: "command", command, timeout: TIMEOUT_S }] }];
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
  const before = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const after = withHooks(before, command, opts);
  if (JSON.stringify(before) === JSON.stringify(after)) return `${file}: already up to date`;
  if (opts.dryRun) return `${file}: would ${opts.remove ? "remove" : "add"} the hooks`;
  if (existsSync(file)) copyFileSync(file, `${file}.polyflow-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  writeFileSync(file, `${JSON.stringify(after, null, 2)}\n`);
  return `${file}: hooks ${opts.remove ? "removed" : "added"} (backup next to it)`;
}

function main(argv) {
  const opts = { remove: argv.includes("--uninstall"), dryRun: argv.includes("--dry-run") };
  const app = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
  const script = join(app, "mods", "polyflow-office", "hooks", "activity.mjs");
  if (!opts.remove && !existsSync(script)) {
    console.error(`Install the layout first: ${script} is missing.`);
    process.exit(1);
  }
  const command = hookCommand(process.execPath, script);
  console.log(update(join(homedir(), ".claude", "settings.json"), command, opts));
  // Codex runs hook commands with PowerShell on Windows, where a quoted program needs the call operator.
  console.log(update(join(homedir(), ".codex", "hooks.json"), process.platform === "win32" ? `& ${command}` : command, opts));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
