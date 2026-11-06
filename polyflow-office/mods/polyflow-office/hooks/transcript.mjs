#!/usr/bin/env node
// The office chat's reader: the last part of a Claude Code or Codex session file (.jsonl), as a short list of
// messages. Session files grow to hundreds of MB, so only the tail is read, and the mod gets just the messages.
//   node transcript.mjs <file.jsonl> [maxBytes] [knownSize]  ->  {"size": n, "messages": [...]}
// With knownSize equal to the file's size nothing is read: {"size": n, "same": true} (the chat polls often).
// A message: { role: "user" | "assistant" | "tool", text, at } (tool: text is "Name target").
// Lines it doesn't know are skipped, so a new format shows less, never breaks.
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { targetOf } from "./activity.mjs";

export const KEEP = 400;
const DEFAULT_BYTES = 12 * 1024 * 1024;
const TEXT_MAX = 40000;

// What the agent's harness writes into the user's turn but the person didn't type.
const WRAPPED = /^\s*(<(command-|local-command|system-reminder|environment_context|user_instructions|turn_aborted|task-notification)|# AGENTS\.md|Caveat:)/;

const clip = (s) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX)}…` : s);
const toolText = (name, input) => {
  const target = targetOf(typeof input === "string" ? safeJson(input) : input);
  return target ? `${name} ${target}` : String(name);
};

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Claude Code: { type: "user" | "assistant", message: { content: string | blocks }, isMeta, isSidechain, timestamp }.
function fromClaude(d, out) {
  if (d.isMeta || d.isSidechain) return;
  const at = d.timestamp ?? null;
  const content = d.message?.content;
  if (d.type === "user") {
    const text = typeof content === "string" ? content
      : Array.isArray(content) ? content.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "";
    if (text.trim() && !WRAPPED.test(text)) out.push({ role: "user", text: clip(text.trim()), at });
    return;
  }
  if (d.type !== "assistant" || !Array.isArray(content)) return;
  for (const b of content) {
    if (b?.type === "text" && b.text?.trim()) out.push({ role: "assistant", text: clip(b.text.trim()), at });
    else if (b?.type === "tool_use" && b.name) out.push({ role: "tool", text: toolText(b.name, b.input), at });
  }
}

// Codex: { type: "response_item", payload: { type: "message" | "function_call" | "custom_tool_call", ... } }.
function fromCodex(d, out) {
  const p = d.payload;
  const at = d.timestamp ?? null;
  if (p?.type === "message" && (p.role === "user" || p.role === "assistant")) {
    const text = (p.content ?? []).filter((c) => c?.type === "input_text" || c?.type === "output_text").map((c) => c.text).join("\n").trim();
    if (text && !WRAPPED.test(text)) out.push({ role: p.role, text: clip(text), at });
  } else if ((p?.type === "function_call" || p?.type === "custom_tool_call") && p.name) {
    out.push({ role: "tool", text: toolText(p.name, p.arguments ?? p.input), at });
  }
}

// Lines (strings) -> the last `keep` messages.
export function messagesFrom(lines, keep = KEEP) {
  const out = [];
  for (const line of lines) {
    if (!line || line[0] !== "{") continue;
    const d = safeJson(line);
    if (!d || typeof d !== "object") continue;
    if (d.type === "response_item") fromCodex(d, out);
    else if (d.type === "user" || d.type === "assistant") fromClaude(d, out);
  }
  return out.slice(-keep);
}

// The last `bytes` of a file as whole lines (the first, cut one is dropped unless the file starts there).
export function tailLines(file, bytes = DEFAULT_BYTES) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return { size, lines };
  } finally {
    closeSync(fd);
  }
}

function main() {
  const [file, bytes, known] = process.argv.slice(2);
  if (!file || !/\.jsonl$/i.test(file)) {
    process.stdout.write(JSON.stringify({ error: "no session file" }));
    return;
  }
  try {
    const want = Number(bytes) > 0 ? Number(bytes) : DEFAULT_BYTES;
    const now = statSync(file).size;
    if (known !== undefined && Number(known) === now) {
      process.stdout.write(JSON.stringify({ size: now, same: true }));
      return;
    }
    let { size, lines } = tailLines(file, want);
    let messages = messagesFrom(lines);
    // A huge last line (an image, a big tool result) can fill the whole window: look further back once.
    if (messages.length === 0 && size > want) {
      ({ size, lines } = tailLines(file, want * 4));
      messages = messagesFrom(lines);
    }
    process.stdout.write(JSON.stringify({ size, messages }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: String(err?.code ?? err) }));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
