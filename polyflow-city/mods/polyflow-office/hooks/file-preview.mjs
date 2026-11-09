#!/usr/bin/env node
// A bounded, read-only look at one file for the chat's OPEN button.
//   node file-preview.mjs <absolute path>  ->  {"path": ..., "real": ..., "text": ..., "truncated": bool, "error": text | null}
// Only a regular file is opened (never a folder, pipe or device), at most LIMIT bytes are read, and only text is
// returned: UTF-8 (a BOM is dropped); a file with a NUL byte or broken UTF-8 is "binary". The path is an argument of
// this process, never part of any command. Nothing is written.
import { closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export const LIMIT = 256 * 1024;

const MESSAGES = {
  ENOENT: "The file doesn't exist: it may have been deleted or moved.",
  EACCES: "Can't read it: permission denied.",
  EPERM: "Can't read it: permission denied.",
  EISDIR: "That is a folder, not a file.",
};

// Text of the bytes, or null when they aren't UTF-8 text. A cut file may end inside a character: up to 3 bytes of
// that end are let go. (The pattern in the replace is a literal U+FEFF, the byte order mark: it is dropped.)
function decode(buf, truncated) {
  const strict = new TextDecoder("utf-8", { fatal: true });
  for (let drop = 0; drop <= (truncated ? 3 : 0); drop++) {
    try {
      return strict.decode(buf.subarray(0, buf.length - drop)).replace(/^﻿/, "");
    } catch {}
  }
  return null;
}

export function previewFile(path) {
  const fail = (error, real = null) => ({ path, real, text: "", truncated: false, error });
  if (typeof path !== "string" || !isAbsolute(path)) return fail("Not an absolute path.");
  let fd = null;
  try {
    const real = realpathSync(path);
    fd = openSync(real, "r");
    if (!fstatSync(fd).isFile()) return fail("Not a regular file: nothing to show.", real);
    const buf = Buffer.alloc(LIMIT + 1);
    const n = readSync(fd, buf, 0, LIMIT + 1, 0);
    const truncated = n > LIMIT;
    const bytes = buf.subarray(0, Math.min(n, LIMIT));
    if (bytes.includes(0)) return fail("Binary file: no preview.", real);
    const text = decode(bytes, truncated);
    if (text === null) return fail("Not UTF-8 text: no preview.", real);
    return { path, real, text, truncated, error: null };
  } catch (err) {
    return fail(MESSAGES[err?.code] ?? `Can't read it (${String(err?.code ?? err).slice(0, 60)}).`);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.stdout.write(JSON.stringify(previewFile(process.argv[2])));
