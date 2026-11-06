# PolyFlow City

A cyberpunk night-city layout for Herdr (beta). On the left is a dark sidebar painted like a rainy skyline: your spaces appear as little pixel-art buildings, and your running agents appear as cards with an animated pixel character each (a netrunner, a street samurai, a medic and so on) who works, raises a hand when the agent needs you, or rests when it is done or idle. Along the top runs a tab bar with a portrait on every tab and buttons for Files, Changes, Inbox and Office; your terminals sit on a dimmed neon skyline background with thin cyan borders. The Office button opens a cut-away office tower where every agent walks to the station that matches what it is doing (a separate entry, `../polyflow-office/RECIPE.md`, describes that part in full). Palette: near-black blues, acid yellow `#fcee0a` for focus, cyan `#00e5ff` for "working".

![PolyFlow City](preview.png)

Beta. Built and tested on Windows only; macOS and Linux are untested (see Watch out).

## What you see

Window: one row, no OS title bar (`titlebar: none`; on Windows the tab bar carries minimize / maximize / close). Window background is the theme's `canvas` `#07090c`. Dividers are 1px `#2b3947`. Terminal text padding is 14px top/bottom, 12px left/right. Terminal background opacity is 0.6, so the skyline picture shows through.

Theme `polyflow-neon`. Key colors: background `#0b0d10`, foreground `#e8f0f7`, muted `#8a9cb0`, dim `#6e8296`, accent `#fcee0a` (selection tint `#fcee0a26`), working `#00e5ff`, blocked `#ff2a6d`, done `#57df9c`, idle `#4e6072`, unknown `#c86bff`, chrome and surface `#11151a`, popover and raised `#151b22`, border `#2b3947`, hover `#e8f0f714`.

Fonts: Chakra Petch for UI text in the office, Silkscreen (uppercase pixel font) for office signs and buttons. Both ship inside `mods/polyflow-chrome/fonts/`.

### Left: sidebar, 268px wide (the layout marks it not resizable; it folds to a 44px rail with the toggle button)

The sidebar has a background picture, `mods/polyflow-chrome/sidebar-v3.png`, scaled to cover. Top to bottom:

1. **Brand strip, 46px tall**, draggable window area. The octagonal "P" logo (`logo.png`, 22px), the word "PolyFlow" (semibold 13.5px), a search button (magnifier, 26px square) and a sidebar-toggle button. Background `#11151a` at about 78% opacity.
2. **Spaces list**, upper half of the remaining height (weight 1, min 90px). Header row 31px: "Spaces" in dim 11.5px and a "+" button. Each space is a card 76px high on `surface` at 95% opacity: a 72px pixel-art building on the left; the space's name (white, 13px, max 150px, truncated); on the right small dim git info only where unusual: repo name and/or branch (hidden when equal to the space name, and `main`/`master` are never shown), green `↑N` ahead, red `↓N` behind. Under the name up to three 11.5px lines: "N uncommitted files" (ansi yellow), "N unpushed commits" (ansi green), "N repos without a remote" (ansi red). The active space has a 3px acid-yellow bar on its left edge, a 1px border and a yellow 12% tint. A git worktree space is a 28px row under its main repo with a branch icon. When another machine is known, rows are grouped under a header per machine ("This computer" and each remote, with a connection dot).
   Buildings: six pictures (`tower`, `bar`, `datacenter`, `clinic`, `market`, `block`), chosen by name in `mods/polyflow-spaces/places.json` (shipped as `{}`), otherwise by a fixed hash (sum of the name's code points modulo 6).
3. **Agents list**, lower half (weight 1, min 90px), vertical scroll. One card per agent, as a tree: a helper started with `hc run --parent` sits indented 16px per level under its parent with a 1px `#2b3947` guide line and elbow. Empty: "No agents" (dim, 12px).
   Card (padding 6x4, 8px gap, `surface` at 95% opacity, 1px `#2b3947` border): on the left the character's animated GIF, 54x72px (36x48 source at 1.5x; helpers 42x56). On the right: the tab name (semibold, truncated) with the status word at the end (11px); optionally the session name (dim 11px); a program tag, a 10px framed label `Claude` (acid yellow) or `Codex` / `OpenCode` (violet `#c86bff`), followed by "model · effort" (dim 11px; for Codex/OpenCode on its own row) when known; and an activity line (11px, cyan; red when blocked) such as "reading main.rs", "editing app.ts", "testing npm run test", "thinking" or "needs you".
4. **Footer, 69px**, 1px top border. Two rows of 28px: "Settings" (gear icon; a 6px yellow dot appears when an app update is ready) and "Add machine" (dim, plus icon).

### Right: the work area, top to bottom

1. **Tab bar, 58px**, draggable, background `#11151a`, 1px bottom border. Tabs are 48px high, text 12.8px, name max 170px. Each tab starts with the tab's character portrait (44px; same character as its agent card; if the tab has no character, the program icon at 14px). Active tab: background `#151b22`, border `#2b3947`, white text, and a small close "x". Then a "+" button (26px), and four 26px-high buttons with a 20px picture: **Files**, **Changes**, **Inbox**, **Office** (an open panel's button is tinted `#fcee0a26`). On Windows the last three 26px buttons are minimize, maximize/restore and close.
2. **Body**, padded 8px with 8px gaps, left to right:
   - **Terminals** (node `main`): each pane has Herdr's 30px pane header (always shown), the dimmed skyline `map-v2.png` as background, a 1px `#00e5ff55` border, a 1px yellow focus border on the focused pane, square corners, 8px between panes.
   - **Office column** (node `office`), hidden at start; weight 1.5, min 320px, 1px border.
   - **Side panel** (node `panel`), hidden at start; 368px (min 280, max 900), a stack of three pages: Files, Changes, Inbox.
3. **Status bar, 28px**: Herdr's built-in `workspace-status`.

### The Inbox page

Header 38px: "Inbox" and "N file(s)". Each row is 52px: a 40px thumbnail for pictures (else a text badge "Image" / "Video" / "PDF"), the file name, and "size · yyyy-mm-dd hh:mm" in dim 11px. Empty: "The inbox is empty" plus the folder path.

## How it behaves

### Agent status

| Status | Agent card | Character |
|---|---|---|
| working | word "Working" in cyan; activity line in cyan ("reading x", "editing x", "thinking") | `<job>-working.gif` |
| blocked | word "Needs you" in `#ff2a6d`; card border `#ff2a6d` instead of grey; activity line "needs you" in red; focus bar red | `<job>-blocked.gif` (hand raised) |
| done | "Done" in `#57df9c` | `<job>-rest.gif` |
| idle / unknown | "Idle" in `#4e6072`, no activity line | `<job>-rest.gif` |

On a tab: working shows a cyan spinner, blocked and done show a 6px dot in `#ff2a6d` / `#57df9c`. In the Spaces list, agent state is not drawn; in the collapsed 44px rail a space shows its number and `●` (blocked or done) or `·`.

### Characters (jobs)

Eight characters: `corpo`, `fixer`, `medtech`, `netrunner`, `nomad`, `rockerboy`, `solo`, `techie`. A character belongs to a tab NAME (case-insensitive, trimmed), so tabs and agents with the same name share it. Assignment (`assignJobs` in `lib.js`), in order:

1. `mods/polyflow-agents/jobs.json` wins. Shipped: `Claude Code` -> netrunner, `Codex` -> techie, `Frontend` -> rockerboy, `Backend` -> solo, `Docs` -> corpo, `Tests` -> medtech, `Review` -> fixer, `Deploy` -> nomad.
2. Else the job remembered for the tab id (`"#<tab id>"`), so renaming a tab keeps its character.
3. Else the job remembered for the name.
4. Else the name starts at index (sum of its code points mod 8) and takes the next job not yet used; after all eight are used, jobs repeat.

The memory is the shared key `polyflow-city.jobs` (`rememberJobs`); the agents list is always mounted, so it writes it; tabs and office read it.

### Clicks, keys, hovers

- Agent card: hover makes the background opaque (`#151b22f8`); click runs `agent.focus` on that terminal.
- Space card: click `space.select`; drag onto another space of the same machine `space.move` (source dimmed, 2px yellow insertion line); right-click opens the `menu` popup (tab "space"); header "+" `space.new`; a machine header folds its list (kept in `localStorage` `machines.folded`) and its "+" runs `space.new` for that machine.
- Tab: click `tab.select`; double-click `tab.rename`; right-click `menu` popup (tab "tab"); drag onto another tab `tab.move`; mouse wheel over the bar `tab.next` / `tab.prev`; "x" `tab.close`; "+" opens the `new-menu` popup (250px wide).
- Files / Changes / Inbox buttons: open the side panel on that page (`layout.select` stack `panel-body`, then `layout.show` node `panel`), or `layout.hide` it if that page is already showing. The open page is remembered per space (`localStorage` key `panels`): switching spaces restores that space's choice, closed if it never had one.
- Brand strip: search -> `mod.open` `picker`; toggle -> `layout.resize` of `sidebar` between 44px and its previous width (default 268).
- Footer: Settings `app.settings`; Add machine `mod.open` `machine-add`.
- Inbox row: click opens the file with the system default app (exact commands in Built from).
- Keys: none bound by default. The tabs mod accepts keys.json actions `polyflow-tabs.office-toggle`, `polyflow-tabs.office-full`, `polyflow-tabs.office-off` (add them yourself, e.g. in the `global` section).

### The Office button and its modes

The office column starts hidden and the terminals fill the area. The Office button toggles `off` <-> `side`. State lives in shared key `polyflow-office` as `{ mode: "off"|"side"|"full", chat: "bottom"|"right"|"float" }` (defaults `off`, `bottom`). Commands per mode (`mods/polyflow-office/modes.js`; `mods/polyflow-tabs/office-modes.js` is a byte-identical copy):

| Mode | Commands, in order |
|---|---|
| off | `layout.hide office-chat-right`, `layout.hide office-chat-bottom`, `layout.hide office`, `layout.show main` |
| side | hide both chat nodes, `layout.show main`, `layout.show office` (terminals and office side by side; the office keeps the width you dragged it to) |
| full | `layout.show office`, `layout.hide main`, then by `chat`: `right` shows `office-chat-right` (560px, min 320), `bottom` shows `office-chat-bottom` (340px, min 160), `float` shows neither (a floating chat window is used) |

Both chat nodes are `{ "agent": "focused" }` blocks, i.e. the focused agent's terminal. The office's own bar (30px) has `+ AGENT`, `FULL` / `EXIT FULL`, in full mode `BOTTOM` / `RIGHT` / `FLOAT` (and `OPEN CHAT` when float), `CALM`, `DEMO`, `SCREEN`, `X`. A red "! N NEEDS YOU" badge appears when any agent is blocked and lists them. The floating chat is allowed only in full + float.

What the person sees in the office (details in `../polyflow-office/RECIPE.md`): a four-floor tower (SERVER 4, RESEARCH 3, DEV 2, LOBBY 1) with an elevator. Each agent is a small character on the floor and station matching what it does now: blocked -> lobby help console; done or idle -> lobby lounge; working -> by tool (reads at the archive, edits at a desk, web or MCP at comms, planning at the meeting table, shell at the test bench when the command looks like a test or build, else the server rack). Clicking a floor opens its 3/4 view. Clicking an agent focuses it and opens a small card (send a message, stop, rename, close, terminal or chat). The chat shows the conversation of the Claude Code / Codex session with a box to write to it.

### What moves

GIF characters animate; the tab spinner spins (900ms); office characters walk, ride the elevator and sit, and lights blink (CALM turns blinking and pulsing off). The activity line and the office refresh when the hook writes a file (folder watch) and at least every 10 s; the statusLine cache is re-read on change and every 30 s; each space's git is re-checked after a command or an agent turn ends, and at most once a minute while the window is in front.

## Built from

### Layout `layouts/polyflow-city.json`

Forked from Herdr's `main` layout 0.1.11 (`cloned_from`). Root: `theme: "polyflow-neon"`, `background: "canvas"`, `titlebar: "none"`, `traffic_lights: [12, 16]`, `terminal_padding: [14, 12]`, `terminal_opacity: 0.6`, `divider: { width: 1, color: "border" }`. Node tree (sizes px):

```
root  row
  sidebar  column  size 268, min 44, max 480, resizable false, background image mods/polyflow-chrome/sidebar-v3.png (cover)
    brand           block  mod polyflow-chrome                              size 46, window_drag
    sidebar-lists   column
      spaces        block  mod polyflow-spaces                              weight 1, min 90
      agents        block  mod polyflow-agents                              weight 1, min 90
    sidebar-footer  block  mod polyflow-chrome, props { footer: true }      size 69
  work  column  resizable false
    tabs            block  mod polyflow-tabs                                size 58, window_drag
    work-body  row  padding 8, gap 8
      main          block  content { tab: "active", pane: {...} }
      office        column  hidden, weight 1.5, min 320, border { width 1, color "border" }
        office-top  row
          office-scene       block  mod polyflow-office
          office-chat-right  block  hidden, size 560, min 320, content { agent: "focused" }
        office-chat-bottom   block  hidden, size 340, min 160, content { agent: "focused" }
      panel         column  hidden, size 368, min 280, max 900
        panel-body  stack  active "files"
          files     block  mod files                (shipped)
          changes   block  mod changes              (shipped)
          inbox     block  mod polyflow-inbox
    status          block  mod workspace-status (shipped)                   size 28
```

`main`'s `pane` options: `header { content: { mod: "pane" }, reveal: "always", height: 30, position: "top" }`, `background { image: "mods/polyflow-chrome/map-v2.png", fit: "cover" }`, `border { width: 1, color: "#00e5ff55" }`, `focus { width: 1, color: "accent" }`, `radius: 0`, `gap: 8`, `lone: true`. The mods find nodes by id (`sidebar`, `main`, `office`, `office-chat-right`, `office-chat-bottom`, `panel`, `panel-body`); do not rename them.

### Theme `themes/polyflow-neon.json`

`background #0b0d10`, `foreground #e8f0f7`, `selection #1f3340`, `cursor #fcee0a`. ANSI 0-15: `#0b0d10 #ff2a6d #57df9c #fcee0a #3d8bff #c86bff #00e5ff #e8f0f7 #4e6072 #ff5c8a #7ff0b6 #fff35c #6aa8ff #d99bff #5cf0ff #ffffff`. `colors`: the UI colors above plus `solid #00e5ff`, `solid_foreground #0b0d10`, `accent_foreground #0b0d10`, `canvas #07090c`, `input #0d1116`. Mods read them via `theme()` (`t.accent`, `t.working`, `t.blocked`, `t.done`, `t.chrome`, `t.surface`, `t.raised`, `t.border`, `t.hover`, `t.ansi1`...); keep those keys.

### Mods (in `mods/`; each `mod.json` has `"place": "none"`, used only from the layout)

Shipped Herdr mods used (not copied): `pane` (pane header, `mods/pane/close.svg`), `files`, `changes`, `workspace-status`, `menu`, `new-menu`, `picker`, `machine-add`, and icons from `mods/workspace-chrome/` (`plus`, `branch`, `server`, `monitor`, `chevron-*`, `spinner`). `polyflow-chrome`, `polyflow-spaces`, `polyflow-tabs` are re-tinted forks of Herdr 0.1.11's `workspace-chrome`, `spaces`, `tabs` (via Traveler). Each mod's `main.js` default-exports a class extending `View` (`gpui-kit`, `gpui-base`). The per-mod `jsconfig.json` and `gpui-kit.d.ts` are editor helpers only.

**polyflow-chrome** (`main.js`, 52 lines). No props: brand strip; `{ footer: true }`: footer. Calls `run("mod.open", { name: "picker" })`, `run("mod.open", { name: "machine-add" })`, `run("app.settings")`, `run("layout.resize", { id: "sidebar", px })`; reads `layout()`, `updates()`, `window()`, `shared("sidebar.width")`. Assets: `logo.png`, `sidebar-v3.png`, `map-v2.png`, about 20 svg icons, `fonts/ChakraPetch-Regular.ttf`, `ChakraPetch-SemiBold.ttf`, `Silkscreen-Regular.ttf`, `LICENSE-Silkscreen.txt`. (`sidebar-v2.png` is not used.)

**polyflow-spaces** (`main.js`, `places.json`, `art/{tower,bar,datacenter,clinic,market,block}.png`). Calls `space.select`, `space.move`, `space.new`, overlay `menu`; reads `spaces()`, `panes()`, `machines()`; runs `git` via `exec` (see Watch out) and `hc(["machine","ls","--json"])` every 15 s; `watchFolder` on each local repo's git folder.

**polyflow-agents** (`main.js`, `lib.js`, `activity.js`, `activity-reader.js`, `jobs.json`, `art/<job>.png`, `sprites/<job>-{working,blocked,rest}.gif`: 24 GIFs, 36x48). Reads `agents()`, `spaces()`, `terminals()`; calls `run("agent.focus", { terminal })` and `setAgentOrder`; sets shared `polyflow-city.jobs`. Local files it reads (via Herdr's `readTextFile` / `watchFolder`):
 1. `~/.config/herdr-app/data/polyflow-city/sessions/<terminal id>.json`, an optional statusLine cache `{ updatedAt, model, effort, sessionName, contextRemainingPct, fiveHourRemainingPct }`. Only model, effort and session name are drawn (the percentages are parsed but not drawn). The script that would write it (`scripts/polyflow-statusline.mjs`, named in comments) is NOT shipped.
 2. `~/.config/herdr-app/data/polyflow-office/activity/<terminal id>.json`, written by the optional office hook; gives the activity line. Without it cards say "thinking" and, when blocked, "needs you".
 3. For an agent on a remote machine, the same cache path in that machine's Herdr folder, read with `readTextFile(path, { on: machine })` over Herdr's own connection.

`activity.js` (byte-identical copy in the office mod) maps tool names to stations: ask-user -> help console; read/glob/grep/ls -> archive; edit/write/apply_patch -> desk; web fetch/search and `mcp__*` -> comms; task/todo/plan -> meeting table; shell -> test bench for test/build-looking commands, else server rack; a record older than 120 s counts as stale.

**polyflow-tabs** (`main.js`, `lib.js` with the same job logic, `office-modes.js`, `art/{files,changes,inbox,office}.png`, `win-{min,max,restore,close}.svg`). Calls `tab.select/move/rename/close/next/prev`, `window.minimize/maximize/close`, `layout.select/show/hide`, the office-mode commands; overlays `menu` and `new-menu`; reads `jobs.json`. Panel buttons: shared key `workspace.panels` (default `["files","changes"]`) plus always `inbox`. A code comment mentions `office-40/60/70` commands; they do not exist.

**polyflow-inbox** (`main.js`, `lib.js`). Lists `~/.config/herdr-app/data/inbox/files` (created on first load): top-level regular files only, extensions `png jpg jpeg webp gif mp4 mov pdf`, no hidden files, no links, newest first, at most 200 rows; thumbnails for images up to 20 MB. It runs, always with argument arrays through `exec` (never a shell string):
 - Windows: `powershell.exe -NoProfile -NonInteractive -Command ...` using `Get-ChildItem -LiteralPath <dir> -File -Force` (list) and `Get-Item -LiteralPath <file>` (check it is a regular file, not a reparse point); to open, `rundll32.exe url.dll,FileProtocolHandler <file>`. The folder is created with Node `fs/promises` `mkdir`.
 - Other platforms (code path written for macOS): `/bin/mkdir -p`, `/usr/bin/find ... -exec /usr/bin/stat -f "%m %z %N"`, `/usr/bin/stat -f %HT`, `/usr/bin/open`. These are BSD flags and will not work on Linux.
 It never writes, deletes or sends anything.

**polyflow-office** (large: about 40 JS files, `art/`, `hooks/`, `screen/`). Wired into this layout by node `office-scene` (`mod: "polyflow-office"`), the Office button of `polyflow-tabs`, and nodes `office`, `office-chat-right`, `office-chat-bottom`; mode logic `mods/polyflow-office/modes.js`, state key `polyflow-office`. The same mod also draws overlays (props `agentCard`, `deskChat`, `chatBar`, `chatHandoff`, `newAgent`). Without a node `office` in the layout it runs "standalone" (always on, floating chat only). Everything else, including art and tests, is in `../polyflow-office/RECIPE.md`. Calls that matter here: `layout.show/hide/toggle`, `agent.focus`, `tab.new` (the `+ AGENT` dialog; programs from `knownAgents()`), `tab.rename`, `tab.close`, `terminal.kill`, `window.close`, `hc send <terminal> <text>`, `hc interrupt <terminal>`, `exec("node", [.../hooks/transcript.mjs, <session file>, ...])`, and for SCREEN `exec("cmd", ["/c", launch.cmd, ...])` on Windows or `exec("sh", [launch.sh, ...])`.

### Art

Pixel art, AI-generated (OpenAI Codex image generation), then keyed on `#ff00ff`, scaled nearest-neighbour and assembled into GIFs with ImageMagick. A fresh build needs, under `~/.config/herdr-app/`:
 - `mods/polyflow-chrome/`: `logo.png` (octagonal "P"), `sidebar-v3.png` (tall dark rainy skyline, dim enough for cards to stay readable), `map-v2.png` (wide dark skyline, about 85% darkened), svg icons.
 - `mods/polyflow-spaces/art/`: six building PNGs (shown at 72px).
 - `mods/polyflow-agents/art/`: eight portraits `<job>.png`; `mods/polyflow-agents/sprites/`: per job `-working`, `-blocked`, `-rest` GIFs, 36x48.
 - `mods/polyflow-tabs/art/`: `files.png`, `changes.png`, `inbox.png`, `office.png` (shown at 20px).
 - the office art (see the office entry).

Characters: netrunner (spiky blond hair, cyan visor, black jacket with yellow trim), techie (dreadlocks, goggles, mechanical arm), solo (cyan eye implant, long coat, katana), fixer (yellow sunglasses, charcoal coat), medtech (white-grey jacket with lime cross), nomad (grey buzz-cut, backpack, scarf), rockerboy (violet mohawk, guitar), corpo (slick hair, dark suit, thin yellow tie). No text or real brand logos inside pictures. If a picture is missing the mods fall back (program icon on tabs, blank on cards).

### Licenses and lineage

Code: Apache-2.0 (`LICENSE`). `NOTICE`: fork of the Traveler layout (`https://github.com/franky5440-afk/herdr-traveler`, Apache-2.0, (c) 2026 Frank Lin); Traveler's `traveler-chrome/spaces/agents/tabs` and `inbox` became `polyflow-chrome/spaces/agents/tabs/inbox` (renamed, retinted, cyberpunk characters and buildings, opaque card hovers, Windows branch for the inbox); Traveler's spaces/tabs/chrome derive from Herdr 0.1.11's built-in mods (Apache-2.0). Art: Creative Commons Attribution 4.0, "Art by nowilus (PolyFlow)", not covered by Apache-2.0; AI-generated, and the rights in AI-generated images are not settled in every jurisdiction. "PolyFlow" and the "P" logo are marks: the license does not allow branding another product with them. Keep `LICENSE`, `NOTICE`, `ART-NOTICE.md` with the layout. Fonts Chakra Petch and Silkscreen: SIL Open Font License.

## Watch out

- **Beta, Windows only.** Run only on Windows 11. macOS and Linux are untested. Known gaps: the inbox's non-Windows branch uses BSD `stat -f` and `/usr/bin/open` (fails on Linux with "Cannot read the inbox"); SCREEN's `launch.sh` was not tried.
- **No network access.** A search of all mods for `fetch(`, `http`, `curl`, `wget`, WebSocket and net/http modules finds nothing. The only remote contact is Herdr's own connection to machines you added yourself (`hc machine ls`, `git` and file reads with `on: <machine>`).
- **Programs it runs** (argument arrays): `git` (`status --porcelain=v2 --branch`, `rev-parse --show-toplevel`, `rev-parse --git-common-dir`, with `--no-optional-locks` and `core.fsmonitor=false`, in each space's folder, local or remote); `hc` (`machine ls --json`, `send`, `interrupt`, and `ls` inside the hook helper); `powershell.exe` and `rundll32.exe` (inbox); `node` (conversation reader and the optional hooks); `cmd /c launch.cmd` (SCREEN).
- **Inbox opens files.** A click hands the file to the OS default app. Only the listed extensions in the top level of `~/.config/herdr-app/data/inbox/files` can be opened.
- **The statusLine cache has no generator.** `data/polyflow-city/sessions/*.json` is read if present; nothing in this build writes it. Without it only the model/effort and session-name lines are missing.
- **The activity hook is optional and installed by hand.** `node ~/.config/herdr-app/mods/polyflow-office/hooks/install.mjs` adds a hook (PreToolUse, PostToolUse, UserPromptSubmit, Stop; 5 s timeout) to `~/.claude/settings.json` and `~/.codex/hooks.json`. Before each change the file is copied to `<file>.polyflow-backup-<timestamp>`. `--dry-run` writes nothing. `--uninstall` removes only entries whose command contains `polyflow-office/hooks/activity.mjs`; other hooks are kept. The hook (`hooks/activity.mjs`) stores only the tool name, a file's base name, a command's first words or a URL host, plus the session's transcript path; never prompts, file contents or tool output. It writes `data/polyflow-office/activity/<terminal>.json` and `sessions/<terminal>.json` and acts only inside a Herdr terminal. An older Codex that does not pass the terminal id has its session matched to a terminal by folder and start time (`hooks/codex-terminal.mjs`, which runs `hc ls`); such a match is marked `bound: "guess"` and the chat then refuses to write to it. Hook errors go to `<tmp>/polyflow-office-hook.log`. Without the hook everything still works: working agents show "thinking" and sit at a desk.
- **Conversation files are read** when the office chat is open for an agent: `~/.claude/projects/...jsonl` or `~/.codex/sessions/...jsonl`, path taken from the hook's session record. The office runs `node ~/.config/herdr-app/mods/polyflow-office/hooks/transcript.mjs <file>`, which reads only the last 12 MB and returns at most 400 messages (your prompts, the agent's replies, "ToolName target" lines) to the chat window. Needs `node` on PATH. Nothing is sent anywhere. `transcript.mjs` does not validate the path it is given; it trusts the session record.
- **The office can type into your agents.** `hc send` writes text into an agent's terminal (chat box, card message; refused while the agent is blocked on an approval) and `hc interrupt` sends the stop key. The card can rename the tab and close the agent (`tab.close`, or only `terminal.kill` when the tab holds anything else). Approvals and questions must be answered in the real terminal.
- **SCREEN writes a second Herdr home.** It copies the `polyflow-*` mods (`robocopy /MIR`, so edits there are overwritten on each launch), the theme, an `office-screen` layout and your `settings.json` into `~/.config/herdr-app-office`, writes `data/polyflow-office/source-home.txt`, starts a second `herdr-app` with `HERDR_APP_HOME` pointing there, and waits up to 20 s for it. Needs `herdr-app` on PATH.
- **Characters are per tab NAME**, not per agent: same name, same character; only eight exist, the ninth distinct name repeats one. A renamed tab keeps its character only after the memory has seen its id.
- **Controls that do nothing or little.** No keys are bound by default. The HP/SP bars of the original are not drawn. `places.json` is `{}`. The `space.colors` shared key is still computed but not drawn. Sidebar drag-resize is disabled by the layout.
- **Sizes.** Sidebar 268px (rail 44px), panel 368px (280-900), office weight 1.5 (min 320), chat nodes 560 / 340px; the agents tree shows helpers at most two sizes (54x72, then 42x56).
- **Folder names matter.** Mods read their own files by path from the Herdr home (`mods/polyflow-agents/jobs.json`, `mods/polyflow-office/art/...`). Use exactly `mods/polyflow-chrome`, `polyflow-spaces`, `polyflow-agents`, `polyflow-tabs`, `polyflow-inbox`, `polyflow-office`, `themes/polyflow-neon.json`, `layouts/polyflow-city.json`. Keep `office-modes.js` (tabs) identical to `modes.js` (office), and `activity.js` / `activity-reader.js` identical between agents and office.
- **Image cache.** Herdr caches images by file name; a redrawn picture needs a new name.
- **Fonts.** Without Silkscreen or Chakra Petch the office falls back to a default font and its signs lose the pixel look.

## Done when

1. `herdr-app check` passes for each of the six mods and `layout.switch` to `polyflow-city` applies theme `polyflow-neon` with no error toast.
2. No OS title bar; a 268px sidebar on the left shows the skyline picture, the "P" logo with "PolyFlow", a search and a toggle button; a 58px tab bar on top; a 28px status bar at the bottom.
3. Each space is a card with a 72px building; the active one has a yellow left bar; clicking another space switches to it.
4. Start Claude Code or Codex in a tab: an agent card appears with an animated character, tab name, program tag and status word. While working the word is "Working" in cyan with the working GIF; when it asks for approval the border and word turn `#ff2a6d` ("Needs you") with the hand-raised GIF; when finished it shows "Done" in green with the resting GIF. Clicking the card focuses that terminal.
5. Tabs named `Claude Code` and `Codex` get a netrunner and a techie; two other differently named tabs get two different remaining characters; renaming one keeps its character. The tab portrait (44px) matches the card's character.
6. Files, Changes and Inbox each open the 368px side panel on their page; clicking the same button again hides it; switching spaces restores each space's last choice.
7. A `.png` and a `.pdf` put in `~/.config/herdr-app/data/inbox/files` both appear in Inbox within a second, newest first, the png with a thumbnail and the pdf with a "PDF" badge; a `.txt` does not appear; clicking a row opens it in the default app.
8. The Office button opens the office column beside the terminals; `FULL` hides the terminals and shows the chat (`BOTTOM` 340px, `RIGHT` 560px, `FLOAT` a window); `X` returns to terminals only; shared state `polyflow-office` matches. `DEMO` shows "DEMO: N MADE-UP AGENTS".
9. A blocked agent shows a red "! 1 NEEDS YOU" badge in the office bar and stands at the lobby help console. With the hook installed, a working agent that reads a file stands at the archive on floor 3; without it, working agents stand at a desk on floor 2.
10. After `node ~/.config/herdr-app/mods/polyflow-office/hooks/install.mjs`, `~/.claude/settings.json` has the four events with a `polyflow-office/hooks/activity.mjs` command and a `.polyflow-backup-*` copy exists; `--uninstall` removes exactly those entries.
11. A search of the six mod folders for `fetch(`, `http://`, `https://`, `curl` finds no network call.
