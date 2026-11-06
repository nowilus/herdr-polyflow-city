// Inbox pure functions: no herdr / gpui-kit, so node can load and test it directly.
// Only string and data handling here; running commands and drawing live in main.js.

export const MAX_ITEMS = 200;
export const MAX_THUMB_BYTES = 20 * 1024 * 1024;

const THUMB_PREFIX = "data/inbox/files/";

// Extension allowlist: only these types may be listed and opened.
const KINDS = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  mp4: "video",
  mov: "video",
  pdf: "pdf",
};

// A file name is always treated as a single name: no path, no hidden files.
function isPlainName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    !name.startsWith(".")
  );
}

// A trailing slash on the folder does not affect matching; everything else is left as is.
function prefixOf(dir) {
  const s = typeof dir === "string" ? dir : "";
  const trimmed = s.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed + "/";
}

export function kindOf(name) {
  if (!isPlainName(name)) return null;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  const kind = KINDS[ext];
  return typeof kind === "string" ? kind : null;
}

export function isAllowedName(name) {
  return kindOf(name) !== null;
}

// Windows: PowerShell paths go inside single quotes, where ' and its curly forms are doubled.
function psQuote(s) {
  return "'" + String(s).replace(/['‘’‚‛]/g, (q) => q + q) + "'";
}

function powershell(script) {
  return {
    cmd: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " + script],
  };
}

export function listCommand(dir, win = false) {
  if (win) {
    // Same "mtime size path" lines as find + stat; plain files only, no links.
    const d = prefixOf(dir).slice(0, -1);
    return powershell(
      `$d = ${psQuote(d)}; Get-ChildItem -LiteralPath $d -File -Force | ` +
      "Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } | " +
      "ForEach-Object { '{0} {1} {2}/{3}' -f [DateTimeOffset]::new($_.LastWriteTimeUtc).ToUnixTimeSeconds(), $_.Length, $d, $_.Name }",
    );
  }
  return {
    cmd: "/usr/bin/find",
    args: [
      dir, "-mindepth", "1", "-maxdepth", "1", "-type", "f",
      "-exec", "/usr/bin/stat", "-f", "%m %z %N", "{}", "+",
    ],
  };
}

// The find + stat output format is one line per file: "mtime size path".
export function parseListing(stdout, dir) {
  const prefix = prefixOf(dir);
  const items = [];
  for (const raw of String(stdout ?? "").split("\n")) {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const m = /^(\d+) (\d+) (.+)$/.exec(text);
    if (!m) continue;
    const path = m[3];
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    if (!isAllowedName(name)) continue;
    items.push({
      name,
      path,
      mtime: Number(m[1]),
      size: Number(m[2]),
      kind: kindOf(name),
    });
  }
  items.sort(
    (a, b) =>
      b.mtime - a.mtime ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return items.slice(0, MAX_ITEMS);
}

// %HT only asks for the type and does not follow symlinks.
export function statCommand(path, win = false) {
  if (win) {
    return powershell(
      `$i = Get-Item -LiteralPath ${psQuote(path)} -Force; ` +
      "if (-not $i.PSIsContainer -and -not ($i.Attributes -band [IO.FileAttributes]::ReparsePoint)) { 'Regular File' }",
    );
  }
  return { cmd: "/usr/bin/stat", args: ["-f", "%HT", path] };
}

export function isRegularFile(stdout) {
  return String(stdout ?? "").trim() === "Regular File";
}

// Only allowlisted names in the top level of the inbox can be opened.
export function openCommand(path, dir, win = false) {
  const prefix = prefixOf(dir);
  if (typeof path !== "string" || !path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length);
  if (!isAllowedName(name)) return null;
  // Windows: the default app through the shell's file handler, no command line parsing.
  if (win) return { cmd: "rundll32.exe", args: ["url.dll,FileProtocolHandler", path.replace(/\//g, "\\")] };
  return { cmd: "/usr/bin/open", args: [path] };
}

// image() only reads paths relative to the Herdr home directory, so it returns data/inbox/files/<file name>.
export function thumbSource(item) {
  if (!item || item.kind !== "image") return null;
  if (kindOf(item.name) !== "image") return null;
  const size = item.size;
  if (typeof size !== "number" || !Number.isFinite(size)) return null;
  if (size < 0 || size > MAX_THUMB_BYTES) return null;
  return THUMB_PREFIX + item.name;
}

export function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}
