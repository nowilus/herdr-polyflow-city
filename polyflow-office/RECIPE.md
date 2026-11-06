# PolyFlow Office

A four-storey cyberpunk office tower that sits in a 560 px column on the right of your Herdr window. Every
coding agent you run is a small pixel person who walks to the station that matches the tool it is using right
now: reading goes to the archive, editing to a desk, running a build to the server room, asking you a question
to the lobby help desk. A glass elevator carries people between floors. Click a person for a card (terminal,
chat, message, stop, rename, close), click a floor to walk around it in a 3/4 picture, or open a floating chat
window that shows the agent's actual conversation.

![PolyFlow Office](preview.png)

Status: beta, tested on Windows only. The published `mod.json` is `{"place":"right","size":560,"title":"Office"}`.

## What you see

The mod runs on its own in whatever layout you have (this is the main case, called "standalone" below). Inside
the PolyFlow City layout it gains extra modes; see `../polyflow-city/RECIPE.md`.

### The panel, top to bottom

1. **Bar**, 30 px high, background `chrome` theme color, 1 px bottom border `border`, 8 px side padding, 4 px
   gaps. Left to right:
   - `OFFICE` in Silkscreen 12 px, `accent` color.
   - A count in Silkscreen 10 px, `dim`: `N AGENTS`; in demo mode it is `DEMO: N MADE-UP AGENTS` in `accent`.
   - Only when at least one agent is blocked: a chip `! N NEEDS YOU`, `blocked` background, white Chakra Petch
     12 px, 22 px high. Tooltip "Agents waiting for you: click for the list".
   - Only while a new agent is starting: `CONNECTING <NAME>...` in Silkscreen 10 px, `working` color.
   - A flexible gap, then the buttons (each 22 px high, 7 px side padding, Silkscreen 10 px, 1 px `border`
     frame, background `surface` at 90% opacity, text `muted`; on hover the text turns `foreground` and the
     frame `accent`; a pressed toggle gets `accent` text and an `accent` background tint at 15%):
     `+ AGENT`, a 1 px divider, `OPEN CHAT`, a divider, `CALM`, `DEMO`.
2. **Scene**, everything below the bar, background `canvas`. It shows either the tower or one open floor.
   A short notice line (Silkscreen 10 px, `accent`, bottom left, 10 px from the left and 8 px from the bottom)
   appears for messages such as `OPENING SCREEN...` or the new-agent notices.

### The tower

A 1536 x 1024 picture scaled to fit (contain, centred, letterboxed on `canvas`). At 560 px wide the scale is
about 0.36, so the figures are small; the 12 px name tags do not scale and stay readable.

Four floors, top to bottom (floor line y in picture px in brackets), plus a glass elevator shaft on the right:

| Floor | Name | What is in it |
|---|---|---|
| 04 (y 294) | SERVER | four server racks (x 540, 680, 820, 960) with a swinging door and LEDs; a test bench (x 1130) with two stand spots; crates, plant, vent, cable tray, status panel |
| 03 (y 490) | RESEARCH | two archive shelves with drawers (x 500, 650); a holo pedestal (x 830); two comms consoles (x 1010, 1170); capsule, poster, wall screen, plant |
| 02 (y 686) | DEV | three desks (x 480, 650, 820) with screens; a meeting table (x 1100) with two talk spots; wall screen, poster, water cooler, floor lamp, neon frame, plant |
| 01 (y 896) | LOBBY | help desk with an alarm light (x 400); sofa with two seats (x 580); bar counter with coffee machine and two talk spots (x 990); back bar, vending machine, side table, neon, poster, plant; the street door at x 750 |

Each floor carries a sign plate at its top-left (22 px in, 18 px down, picture px): `0N // LABEL`
(Silkscreen, `accent`), then `N AGENT(S)`, then `+N ON THE WAY` (`working`) when people are riding or walking
toward it, a pulsing `blocked`-colored `! N` chip for blocked agents, and `DONE N` in `done` color. The LOBBY
also has a `+ INVITE AGENT` plate above the street door.

The elevator: a cabin 84 x 126 picture px in the shaft at x 1386, two glass door leaves on every floor at
x 1302, and a floor-number display above each doorway (the digit is `working` color at rest and `accent`,
blinking, while the cabin moves). Capacity 2 riders.

### The people

Every agent is one figure with a name tag under it: a plate with a 3 px left edge in the status color, a
status symbol, then the tab name. Tag text is Chakra Petch 12 px. Status shows three ways at once (color,
symbol, and the word in the tooltip):

| Status (Herdr) | Tag color | Symbol | Word |
|---|---|---|---|
| working | `working` | `>` | WORKING |
| blocked | `blocked` | `!` | NEEDS YOU |
| done | `done` | `+` | DONE |
| idle | `dim` | `-` | IDLE |

Eight characters (jobs): corpo, fixer, medtech, netrunner, nomad, rockerboy, solo, techie. A character is
picked from the tab name (sum of its letters as a starting point, skipping characters already taken; after all
eight are taken they repeat). Tower figures are 84 x 112 picture px side-view GIFs.

At most 3 people are drawn per floor; if a floor holds more, a `+N` plate (Silkscreen, 1 px `border` frame)
appears on that floor and lists everyone.

## How it behaves

### Where people stand (the whole idea)

The activity hook records the tool the agent is using. The tool name picks a station; the station picks the floor:

| Agent state | Station | Floor | What it looks like |
|---|---|---|---|
| blocked | help desk | LOBBY | sit-type; pulsing `!` bubble; the help desk alarm lights up |
| done, idle, or no status | lounge: sofa (two seats) or bar | LOBBY | sit-relax on the sofa |
| working, tool Read, Glob, Grep, ls, NotebookRead, view_image, read_file, list_dir, find, search_files | archive shelf | RESEARCH | use; a data disk in hand; the drawer opens |
| working, tool WebFetch, WebSearch, web_search, web_fetch, fetch, or any `mcp__*` tool | comms console | RESEARCH | use; screen lights |
| working, tool Edit, Write, MultiEdit, NotebookEdit, apply_patch, write_file, create_file | desk | DEV | sit-type; screen lights |
| working, tool Task, Agent, TodoWrite, update_plan, ExitPlanMode, EnterPlanMode, spawn_agent | meeting table | DEV | talk, with a `...` bubble |
| working, tool Bash, shell, exec_command, local_shell, powershell, unified_exec | rack | SERVER | use; the rack door opens |
| same shell tools, when the command head contains test, tests, pytest, jest, vitest, cargo, go, build, make, cmake, gradle, mvn, tsc, lint, check, npm, pnpm, yarn, bun or dotnet | test bench | SERVER | use |
| AskUserQuestion, request_user_input | help desk | LOBBY | as blocked |
| working with no fresh record (older than 120 s, or no hook installed), or any unknown tool | desk | DEV | sit-type; the tooltip says "thinking" |

Status wins over the tool: a blocked agent is always at the help desk, done/idle always in the lounge.
Two or more resting agents in the lobby: the first two meet at the bar and talk; after 2.6 s there each holds a
cup. A spot is never shared; if a station has no free spot the person stands idle at x 200, 270, 340 ... on that
floor. When a floor has more than 3 people, the drawn ones are: blocked first, then the focused agent, then
working ones, then by address.

### Movement

- People walk at 0.12 picture px per ms, facing the way they go.
- To change floor a person walks to the elevator, waits in line facing the doors (places 34 px apart), the
  cabin comes (doors take 450 ms, stay open at least 700 ms, 900 ms per storey), up to 2 board, ride inside
  behind the glass, and walk out at the target floor. Door leaves slide apart only while the cabin stands there.
- The first time the office is drawn everyone is simply placed at their station. An agent that appears later
  walks in from the street door in the lobby (x 750), then to its station.
- The tower is not updated while a floor is open (it starts fresh when you return).
- The view redraws only when something visible changes (a new leg, a status, a name, a door, a cup); the tick is
  250 ms, and positions glide with transitions on `left` and `top` between ticks.

### Clicks and hovers (standalone)

| Action | Result |
|---|---|
| Hover a floor | 2 px `accent` frame, faint yellow tint `#fcee0a10`, a chip `OPEN FLOOR >` (accent background, dark text) at the bottom right |
| Click a floor (not a person or plate) | Opens that floor's picture view (below) |
| Hover a person | Tooltip `<name> - <WORD>[: what it is doing]`, for example `docs - WORKING: editing App.tsx`, `testing npm run test`, `reading main.rs`, `searching example.com`, `planning`, `thinking`, `needs you` |
| Left click a person or its tag | The agent is focused (`agent.focus`), then its card opens at the pointer |
| Right click a person or its tag | Only the card opens, nothing is focused |
| Click `+N` | A 320 px list of everyone on that floor, blocked first, then working, with `OPEN FLOOR` and `X`. Rows: left click focuses and opens the card, right click only opens the card |
| Click `! N NEEDS YOU` | A 320 px list (`blocked` frame) of the blocked agents; same row clicks |
| Click `+ INVITE AGENT` or the bar's `+ AGENT` | The new-agent dialog |
| `OPEN CHAT` | Opens the floating chat on the focused agent's conversation (else the first agent) |
| `CALM` | Calm mode on or off |
| `DEMO` | Replaces the real agents with a made-up crew; press again to return |

No keyboard shortcut is bound by the office itself. Clicks on buttons and plates do not fall through to the floor.

### Calm mode

`CALM` stops the decorative loops only: the pulsing blocked chip and bubbles, the lift digit blink, neon and lamp
pulses on floors, holo glows, the coffee pour flicker, the alarm blink. Status stays readable from color, symbol
and word. It is held in memory and resets to off when the mod reloads.

### Demo

`DEMO` shows six made-up agents named Frontend, Backend, Docs, Tests, Review, Deploy, each on its own rhythm
(a new beat every 16 s plus 2.5 s per index) cycling through: Edit App.tsx, Bash npm test, Read README.md,
idle, WebSearch, Bash docker ps, blocked, TodoWrite, done. Their card says "A made-up demo agent: nothing to
open." and clicking them focuses nothing. Real agents are hidden meanwhile. Toggling resets the floors and lists.

### An open floor

Click a floor and the tower is replaced by that floor in a 3/4 picture (1536 x 1024 scaled to fit): the empty
room (`art/<floor>/shell-v1.png`), furniture sprites sorted by their feet line, the elevator door on the right
wall, and people as larger figures (130 x 170 px) walking in four directions (a person without the big set uses
the 100 x 133 side-view mini).

- Top-left HUD over the picture: `< TOWER` button (30 px high), a plate `TOWER > 0N // LABEL`, `-`, `+`, `FIT`,
  and on the LOBBY `+ INVITE AGENT`. When zoomed in, a hint `DRAG TO LOOK AROUND`.
- Zoom: wheel (one notch is a step of x1.15; touchpad deltas add up), or `-`/`+`; range x1 to x3 of the fit
  scale, x1 shows the whole floor and cannot go smaller. `FIT` returns to x1, centred. While zoomed in, drag with
  the left button to pan; the picture is clamped so it always covers the view.
- Everyone on the floor takes a spot of their station and walks there around the furniture on a 24 px grid
  (0.13 px/ms); people no longer on the floor walk to the elevator and vanish; a newcomer steps out of the
  elevator, or, in the LOBBY, in through the street door. Waiting people stand on the nearest free cell.
- Doors slide open while someone is within 70 px.
- Reactive parts: rack doors swing open (the closed front fades) at a rack in use, archive drawers slide out,
  desk chairs fade while someone sits, holograms brighten (the research globe for anyone working on the floor),
  screens glow `#00e5ff` at 20% while used, the lobby reception alert screen pulses `#ff2a6d` (35%) while anyone on
  the floor is blocked, the coffee machine pours a brown stream for 2.6 s and then the person holds a cup
  (`#e8e8e8` with a `#c58b4a` edge).
- Blocked people show a pulsing `!` bubble and the "blocked" animation; done people show `zZz`.
- Clicks work as in the tower: left click focuses and opens the card, right click only opens the card.
- A floor without a complete picture pack falls back to a plain 48 px grid floor (`floor-view.js`,
  `floor-plan.js`). All four floors ship with pictures, so this is only a safety net.

### The agent card

A popup at the pointer, 330 x 236 px, no outer frame (1 px `accent` border, 3 px `accent` left edge, `popover`
background at 97%). Header: tab name (Chakra Petch 15) and a status badge (Silkscreen 9, status color); below it
`program · space name · address`. Then one line of what the agent is doing (blocked without a line reads
"Waiting for your answer: open its terminal."; otherwise `working` or `resting`). Buttons:

| Button | Shown when | Does |
|---|---|---|
| `TERMINAL` (Enter does the same) | always | `agent.focus` on its terminal; if the floating chat is open it switches that window to the terminal view |
| `CHAT` | standalone | Focuses the agent and opens the floating chat on its conversation |
| `MESSAGE` | not blocked | A text field; Enter or `SEND` runs `hc send <address> <text>`. Note after: "Sent." or, if it is working, "Sent while it works, just as if typed in its terminal."; on failure "Not sent: ..." (first 120 characters of the error) |
| `STOP` | working or blocked | `hc interrupt <address>`; note "Stop key sent." |
| `RENAME` | not a pane-less helper | A field with the current name; Enter or `RENAME` runs `tab.rename {id, name}` |
| `CLOSE…` | always | Asks "Close this agent and its terminal?" (in `blocked` color with "It's working: closing stops that work." if working; names how many helpers end too). `CLOSE IT` runs `tab.close {id, confirmed:true}` when the agent is alone in its tab with no helpers, otherwise `terminal.kill`; `KEEP` goes back |

Esc closes the card (or goes back from a sub-step). Typing is done by key events (printable characters,
Backspace, Enter, Esc; Ctrl and Win combinations are ignored). The card refreshes every second; if the agent
ends it says "This agent has ended." or "This agent has gone." A blocked agent has no MESSAGE button, and if the
agent becomes blocked while the field is open, sending is refused ("It's waiting for your answer: answer in its
terminal.") because Enter would pick a menu option.

### Starting an agent: `+ AGENT`

A centred dialog, 460 x 430 px, 3 px `accent` top edge, titled `+ NEW AGENT` ("it walks in through the lobby").
Sections: AGENT (a chip per installed program from Herdr's known agents that has a run command; tooltip is the
command; "+N more not installed here"), SPACE (a chip per Herdr space, the active one preselected), NAME
(OPTIONAL), FIRST TASK (OPTIONAL). Keys: Up/Down choose the program, Tab switches field, Enter starts, Esc
closes, Backspace edits. `START` runs `tab.new {space, argv, name?, task?}`.

After starting, the bar says `CONNECTING <NAME>...`. When an agent with a new address appears in that space (and
with that name, if you gave one) the notice `<NAME> WALKS INTO THE LOBBY` shows for 8 s and the person walks in
through the street door. If it has not appeared after 45 s: `<NAME> DIDN'T SHOW UP: LOOK AT ITS TAB` for 15 s.

### The floating chat

Opened by `OPEN CHAT` or the card's `CHAT`: an overlay window of kind `window` that can be dragged, default 42%
of the app width and 50% of its height, laid out as a column:

1. A 26 px title bar: `CHAT` (Silkscreen 10, `accent`), the agent's tab name, then buttons `TERMINAL`/`CHAT`
   (switch view), `−`, `+`, `□`/`▣`, `X`. `−`/`+` shrink or grow the window by 0.08 of the app in both
   directions (minimum 0.2, maximum 1.0). `□` makes it the whole app window (a second window key, so it opens
   centred and grows evenly); `▣` returns to the last ordinary size. `X` closes it.
2. Only on the terminal view and only after a handoff: a 28 px strip "Your chat text is on the clipboard: click
   in the terminal and press Ctrl+V." with an `OK` button; it also hides itself after 120 s.
3. The body: on the CHAT view the conversation (below); on the TERMINAL view the agent's real terminal.

Conversation view:

- A message list (left) and a 220 px side panel (right) with `NOW` (what the agent is doing, same wording as the
  tooltip; "ended" if gone; "finished its turn" or "resting" without a line) and `FILES (N)` (up to 30 files
  the conversation edited or read, newest first; a 6 px square is `working` colored for edited, `dim` for read).
- User messages are right-aligned bubbles (85% max width, `accent` at 12% background, 1 px `accent` border at
  33%, radius 8); agent messages are full-width blocks with a 2 px `working` left border; both are rendered as
  Markdown and selectable. Runs of tool calls fold into one grey line `▸ 3 tools · Edit a.js · Bash git`, which
  opens on click into a monospace list.
- The list stays on the newest message until you scroll up (wheel up or grabbing the scrollbar); then a pill
  `↓ NEWEST` (or `↓ N NEW`) at the bottom right brings you back, as does sending a message.
- The conversation is the last 400 messages of the agent's session file, refreshed every 1.5 s (the file is not
  re-read when its size has not changed). Meta lines, sub-agent sidechains and harness-injected text (command
  wrappers, system reminders, environment context) are left out.
- A box at the bottom: a multi-line `Textarea` growing from 1 to 8 lines. Enter sends, Shift+Enter inserts a new
  line, plus a `SEND` button. Sending runs `hc send <address> <text>`; the box clears only if the text did not
  change meanwhile. The draft, which tool runs are open and the scroll pin are kept per agent in Herdr's shared
  state, so resizing or switching view loses nothing.
- **Read-only** (the box is replaced by a banner, with an `OPEN TERMINAL` button when the agent is live) when
  writing could land in the wrong place: the agent ended ("This agent has ended: its conversation stays readable
  here."), is gone, its conversation is not certainly this terminal's ("Can't confirm this conversation belongs
  to this terminal: write in its terminal."), or it is blocked on an approval or question ("It's waiting for
  your answer ... answer in its terminal."). The check is repeated at the moment of sending.
- With no conversation file yet: "No conversation file for this agent yet: it appears after its next step
  (Claude Code or Codex with the office hooks)."
- `TERMINAL` in the title bar (or `OPEN TERMINAL`) switches the same window to the real terminal. If there is a
  draft in the chat box it is copied to the clipboard and the handoff strip shows; the draft also stays in the chat.

## Built from

One mod folder, `mods/polyflow-office/`. The folder name must be exactly `polyflow-office`: it is the mod id in the
code and in the hook path. `mod.json`: `{"place":"right","size":560,"title":"Office"}`. All code is plain JS
modules importing `gpui-kit`, `gpui-base` (`h_flex`, `v_flex`, `Textarea`, `TextareaState`, `TextView`,
`Scrollbar`, `VirtualListScrollHandle`, `v_virtual_list`) and `herdr`. The `.d.ts` and `jsconfig.json` are editor
aids and not needed.

### Files and roles

| File | Role |
|---|---|
| `main.js` | The view `PolyflowOffice`: picks its role from `props()`; bar, tower/floor switch, `+N` and NEEDS YOU lists, demo, notices, art loading, `standalone()` (true when `layout()` has no node with id `office`), timers (250 ms tick and settle, 80 ms floor tick) |
| `tower.js` | Draws the tower in layers: shell, back furniture, floor zones with signs, cabin back, riders, cabin front, doorways, front furniture, standing people, name tags on top |
| `tower-scene.js` | Data: picture size, floor lines, room extents (x 140 to 1290), lift geometry, entrance x 750, every object and its spots |
| `tower-props.js` | Draws each object from `art/tower/<kind>.png` or a block stand-in, plus its live parts (screens, rack doors, drawers, coffee, holo, alarm) |
| `crowd.js` | Who is shown (max 3 per floor), spot assignment, per-person state machine (walk, wait, enter, ride, at), lift calls |
| `lift.js` | Elevator state machine: idle, moving, opening, open, closing |
| `activity.js` | Tool name to station and floor, `placeOf`, `activityText`, `byFloor`, `withHelpers` (adds `hc run --parent` helper terminals that have no pane of their own) |
| `activity-reader.js` | Reads `data/polyflow-office/activity/<terminal>.json` for each local agent, watches the folder with `watchFolder`, re-reads every 10 s |
| `floor-controller.js` | The open floor: plan, people, camera, zoom, pan, redraw rule (80 ms tick) |
| `floor-scenes.js`, `lobby-scene.js` | Scene data of the four picture floors (furniture, depth lines, blocked bands, spots, doors, signs) |
| `scene-plan.js` | Turns a scene into a walking grid (24 px cells); door distance 70 px; pour time 2600 ms |
| `scene-view.js` | Draws a picture floor: depth-sorted furniture and people, doors, reactive parts |
| `floor-crowd.js`, `pathing.js`, `grid.js` | Floor goals, path finding on the grid, camera math (zoom 1 to 3, step 1.15) |
| `floor-plan.js`, `floor-view.js` | The plain 48 px grid floors, the fallback |
| `camera.js` | The viewport around a floor: HUD buttons, wheel zoom, drag pan |
| `labels.js` | Name tag, status look, tooltips, contact shadow, calm mode (`motion()` skips loops when calm) |
| `lib.js` | The eight jobs, job assignment from tab names (plus optional `jobs.json` and shared memory), sprite paths |
| `art-packs.js` | Keeps only art packs whose every file is listed in `art/index.json` |
| `agent-card.js` | The card popup |
| `new-agent.js` | The `+ AGENT` dialog and the "waiting for it to show up" tracking |
| `chat-window.js` | Floating window: layout, size buttons, title bar, view switch, clipboard handoff |
| `desk-chat.js` | Conversation view and its box |
| `chat-model.js` | Pure helpers: files touched, folding tool runs, `lifeOf`, `chatAccess`, shared-state key names |
| `demo.js` | The six-person demo crew |
| `modes.js` | Office modes (off/side/full, chat bottom/right/float); standalone only stores the state, no layout command runs |
| `screen.js`, `screen/` | SCREEN (office in its own OS window); reachable only from the City layout |
| `hooks/activity.mjs` | The hook: `commandHead`, `targetOf`, atomic writes |
| `hooks/codex-terminal.mjs` | Matches a Codex session to a Herdr terminal when the hook has no terminal id |
| `hooks/transcript.mjs` | Reads the tail of a session `.jsonl` into a short message list (run with `node`) |
| `hooks/install.mjs` | Adds or removes the hook entries |
| `art/` | See Art |

### Props roles of the one view (`props()`)

The same module is mounted for several blocks, chosen by `props()`:

| Props | What it draws |
|---|---|
| none (the docked panel) | The office |
| `{ screen: true }` | The office in its own OS window (bar with only `CHAT` and `X`) |
| `{ chatBar: <address> }` | The chat window's title bar |
| `{ chatHandoff: <address> }` | The clipboard strip |
| `{ deskChat: <address> }` | The conversation view |
| `{ agentCard: <card> }` | The agent card (opened as a `popup` at the pointer, 330 x 236, frame none) |
| `{ newAgent: true }` | The new-agent dialog (opened as a `dialog`, 460 x 430, frame none) |

### `herdr` functions used

`agents`, `terminals`, `spaces`, `panes`, `layout`, `focused`, `theme`, `settings` (UI zoom: size and mouse
events arrive multiplied by it, the view divides by it), `window` (platform), `appHome`, `props`, `shared`,
`setShared`, `openOverlay` (kinds `popup`, `dialog`, `window`), `closeOverlay`, `readTextFile`, `watchFolder`,
`knownAgents`, `exec`, `hc`, `run`.

Commands through `run`: `agent.focus {terminal}`, `tab.new {space, argv, name?, task?}`, `tab.rename {id, name}`,
`tab.close {id, confirmed:true}`, `terminal.kill {terminal}`. `layout.toggle` and `window.close` run only in the
SCREEN window; `layout.show` and `layout.hide` only inside the City layout. Through `hc`: `hc send <address> <text>`
and `hc interrupt <address>`.

### Programs run

- `node <app home>/mods/polyflow-office/hooks/transcript.mjs <session file> 0 [<known size>]` through `exec`,
  every 1.5 s while a conversation view is open. Node must be on the PATH.
- The activity hook (`node .../hooks/activity.mjs`), started by Claude Code or Codex, not by the mod. For Codex it
  may call `hc ls` and `hc get <address>` (2.5 s budget) to find the terminal.
- Only from the City layout: the SCREEN launcher (`cmd /c launch.cmd` on Windows, `sh launch.sh` elsewhere), which
  starts a second `herdr-app` with its own home and calls `herdr-app do layout.switch --name office-screen`.

### Data and shared state

Own data folder `~/.config/herdr-app/data/polyflow-office/`, written only by the hooks (the mod itself writes no
files):
- `activity/<terminal>.json`: `{at, event, tool, target, call, stopped?}`.
- `sessions/<terminal>.json`: `{transcript, session, bound}`; `bound` is `env` (certain) or `guess`.
- `codex-sessions.json`: Codex session id to terminal address (last 200; a failed lookup is not repeated for 60 s).
- `source-home.txt`: only in the SCREEN window's home; points to the main home.

Shared state keys: `polyflow-office` (modes), `polyflow-office.pending-agent`, `polyflow-office.chat-open`,
`.chat-open-key`, `.chat-view`, `.chat-size`, `.chat-last-size`, `.chat-big`, `.chat-state`, `.chat-handoff`.
Read only: `polyflow-city.jobs` (a character memory shared with the City layout; this mod never writes it).
Chat window keys: `polyflow-office-chat`, `polyflow-office-chat-big`.

Optional read: `~/.config/herdr-app/mods/polyflow-agents/jobs.json`, an object `{ "<tab name>": "<job>" }` that
fixes a character for a tab name (exact, case-insensitive). Absent is fine.

### The hooks

`hooks/activity.mjs` is registered for four events: `PreToolUse` and `PostToolUse` (matcher `*`),
`UserPromptSubmit`, `Stop`. It reads the hook JSON from stdin and writes the files above. The terminal id is
`HC_TERMINAL_ID` (Claude Code and current Codex pass it); without it (older Codex) `codex-terminal.mjs` matches the session to the live
Codex terminal of the same folder created just before the session started (the time inside the session's
UUIDv7 id), and only if that is unambiguous. A tool's end record clears only the same call, so overlapping tools
keep showing the later one.

What `target` is (`targetOf`): the base name of `file_path`, `notebook_path` or `path`; else `commandHead(command)`;
else the host name of `url`. Cleaned (control characters removed, spaces collapsed, 60 characters max).
`commandHead` keeps the program name (no folders, no `.exe/.cmd/.bat`) and up to two more words, each only if it
looks like a file name or (for a known program such as npm, cargo, git, docker, node, python, gh) is a short
lowercase subcommand word. Flags, the word after a flag and any word containing `=` are dropped:
`npm run test -- --watch` becomes `npm run test`, `login --password X` becomes `login`. Search patterns and task
descriptions are never kept.

`hooks/install.mjs`: `node ~/.config/herdr-app/mods/polyflow-office/hooks/install.mjs` adds its entries to
`~/.claude/settings.json` and `~/.codex/hooks.json`, each time first copying the file to
`<file>.polyflow-backup-<timestamp>`. The command is `"<node path>" "<activity.mjs path>"` with timeout 5 s (on
Windows the Codex entry is prefixed with `& `, because Codex runs hooks with PowerShell). It is idempotent;
`--dry-run` prints the changes and writes nothing; `--uninstall` removes only entries whose command contains
`polyflow-office/hooks/activity.mjs`. It refuses to install if `activity.mjs` is missing. The home is
`HERDR_APP_HOME` or `~/.config/herdr-app`.

### Art

All in `art/`, 362 files, about 21 MB, pixel art with transparent backgrounds except the room shells. Credit
"Art by nowilus (PolyFlow)", CC BY 4.0 (see the repository's `ART-NOTICE.md`). The images were generated with an
image model, then cut, scaled with nearest-neighbour and assembled into GIFs; rights in such images are not
settled everywhere.

- `art/tower/<asset>.png`: the tower shell (`shell.png`, 1536 x 1024), cabin parts (`lift-cabin`, `lift-front`,
  `lift-leaf`, `lift-frame`) and the furniture sprites; `manifest.json` is `{ "assets": [...] }` (35 names).
- `art/mini/<job>-v2-<pose>-<l|r>.gif`: the small side-view people, six poses (`idle`, `sit-type`, `sit-relax`,
  `use`, `talk`, `walk`) times two facings per job; `manifest.json` is
  `{ "jobs": [...], "versions": { "<job>": "v2" } }`. A redrawn job gets a new version so its file names change
  (Herdr caches images by name).
- `art/people/<job>-v1-<anim>.gif`: the big floor people, 11 animations (`walk-r`, `walk-l`, `walk-d`, `walk-u`,
  `idle`, `talk-r`, `talk-l`, `blocked`, `sit-sofa`, `use`, `sit-desk`); `manifest.json` is `{ "versions": {...} }`.
- `art/<floor>/` for `lobby`, `server`, `research`, `dev`: `shell-v1.png` (the empty room), one PNG per sprite
  named in `floor-scenes.js` and `lobby-scene.js`, and the elevator door as `lift-leaf-l.png` and `lift-leaf-r.png`
  (the lobby also `entrance-leaf-l.png` and `entrance-leaf-r.png`).
- `art/scenes.json`: `{ "ready": ["lobby","research","server","dev"] }`.
- `art/floor/*.gif` and a few `art/*.png`: older assets, still listed in the index; the grid-floor fallback.
- `art/index.json`: `{ "files": ["art/...", ...] }`, every file under `art/` except itself, sorted, paths
  relative to the mod folder. Generated by the source repository's art-index script, which walks the folder (not shipped).
  Herdr's mod API cannot list a folder, and an image path that was missing once is cached forever, so the mod
  draws a pack only if every file it needs is in this list. If you rebuild without that script, write the list
  with any directory walk.

Without art (no manifests or no index) the tower draws stand-ins made of colored blocks; see Watch out about people.

Theme: colors come from the active Herdr theme (`canvas`, `chrome`, `surface`, `raised`, `popover`, `border`,
`accent`, `working`, `blocked`, `done`, `dim`, `muted`, `foreground`, `background`). Hard-coded: stand-in shell
`#07090c`, `#10141a`, `#1c222a`, cabin `#12262e`, cyan `#00e5ff`, yellow `#fcee0a`, text on accent plates
`#0b0d10`, text on the `blocked` chip `#ffffff`. It was designed against the `polyflow-neon` theme of the City layout;
any theme works. Fonts requested by name: Silkscreen (signs, buttons), Chakra Petch (text), JetBrains Mono (opened
tool lines). Silkscreen and Chakra Petch ship in the mod's `fonts/` folder (SIL Open Font License, license files
next to them), which Herdr loads at start; JetBrains Mono falls back to the default monospace font if missing.

### Inside the PolyFlow City layout (for contrast)

When the layout has a node with id `office`, `standalone()` is false: the bar also gets `FULL`/`EXIT FULL`; in
FULL the chat places `BOTTOM`, `RIGHT`, `FLOAT` (and `OPEN CHAT` for FLOAT); plus `SCREEN` and `X` (switch the
office off, after which it is not visible and stops moving). In FULL a left click on a person only focuses it and
shows the chat; in the other modes the card opens too. The floating chat belongs to FULL + FLOAT there. All of that,
and the SCREEN window, is in `../polyflow-city/RECIPE.md`, not here.

## Watch out

- **Beta, tested on Windows only.** The SCREEN launcher also has a `.sh` version that was not tested, and SCREEN
  does not exist in the standalone panel.
- **Hooks are optional.** Install with `node ~/.config/herdr-app/mods/polyflow-office/hooks/install.mjs` (adds
  entries to `~/.claude/settings.json` and `~/.codex/hooks.json`, with a timestamped backup next to each;
  `--uninstall` removes them; `--dry-run` shows the change). A program whose folder (`~/.claude/` or `~/.codex/`)
  does not exist is skipped. Without hooks every agent still appears, placed from Herdr's own status
  (blocked to the help desk, done/idle to the lounge, working to a DEV desk), but nobody walks to a tool's station,
  the tooltip says "thinking", and the chat has no conversation. Hooks only affect sessions started after they
  are installed. Codex runs hooks only in versions that support `~/.codex/hooks.json`.
- **Remote agents** (addresses that are not a plain local id matching `[A-Za-z0-9][A-Za-z0-9_-]*`) get no activity
  record.
- **What it reads.** `~/.config/herdr-app/data/polyflow-office/*`; the session files whose paths the hook stored
  (the tail only: the last 12 MB, 48 MB on a second try; Claude Code's `~/.claude/projects/**/*.jsonl` and Codex's
  `~/.codex/sessions/**/*.jsonl`) through `node hooks/transcript.mjs`; its own `art/`; and the optional
  `../polyflow-agents/jobs.json`. `transcript.mjs` opens any path ending in `.jsonl` that it is given; only the hook
  writes the session records that name them. The conversation view shows the full text of user and agent messages
  from those files on screen; it keeps nothing but the per-agent draft and view state in Herdr's shared state.
- **What it runs.** `exec node` (the transcript reader), `hc send`, `hc interrupt`, and the `run(...)` commands listed
  under Built from, including `tab.new`, `tab.close` (confirmed) and `terminal.kill`. The card's `CLOSE IT` and
  `STOP` act on the real agent; `MESSAGE` and the chat box type into the real terminal and press Enter.
- **Privacy of the hook.** It keeps only the tool name, a file's base name, a command's first words (file names and
  subcommands of known programs only; flags, values and anything with `=` dropped) or a URL's host. It never keeps
  arguments' values, prompts, file contents or tool output. A word in a command that looks like a file name is
  kept as its base name. It also stores the session id and the transcript path in `sessions/`. On an internal error
  it appends a stack trace to `<system temp>/polyflow-office-hook.log` (restarted when over 64 KB). It always exits
  0 and prints nothing, so it cannot break an agent's turn. Outside a Herdr terminal (no terminal id) it writes nothing.
- **No network.** A search of every `.js`, `.mjs`, `.cmd` and `.sh` file for `fetch(`, `http`, `XMLHttp`,
  `WebSocket` and `curl` finds nothing. The hook parses a URL only to keep its host name; nothing requests it.
- **API limits found.** A mod cannot type into a given terminal without Enter: `hc send` always adds Enter, its key
  names cannot type characters such as "ą", and Herdr pastes only into the focused terminal, which the chat's
  terminal block cannot be made from code (a paste once landed in another agent's input). Hence the clipboard
  handoff and its strip. Overlay windows cannot be resized by dragging, and a drag grip inside one never got the
  press, hence the size buttons and reopening the window at the new size. A normal scroll area's position cannot
  be read; the conversation uses a virtual list because it is the only scroll area a mod can move
  (`scroll_to_bottom`). Its rows need heights up front, so each message is also drawn once, invisibly, to measure
  it (10 per frame, newest first), with an estimate until then. A mod may write only inside its own folders (hence
  the SCREEN launcher script). Herdr's UI zoom multiplies size and mouse events.
- **A missing image path is cached forever.** Never point at a file that may not exist, and re-run
  the art-index script after any art change. If a job's mini pack is incomplete or the index is missing, the
  tower falls back to `mods/polyflow-agents/sprites/<job>-<working|blocked|rest>.gif`, which exists only if the
  PolyFlow Agents mod is installed; otherwise those people have no picture. Ship all of `art/mini` (8 jobs, 12 files
  each) and a correct `art/index.json`.
- **Characters follow tab names, not agents.** Two tabs with the same name share a character, and renaming a tab
  can change its character (unless the City layout's `polyflow-city.jobs` memory remembers it; this mod only reads
  that memory).
- **The chat can only write when the conversation is certainly the terminal's.** Claude Code and current Codex report
  the terminal id (`bound: env`). An older Codex without it is matched by folder and start time (`guess`), and then
  the chat is read-only; two such Codex terminals in one folder started within 500 ms of each other are never matched.
- At most 3 people are drawn per floor; the rest are only in the `+N` list and the count.
- Calm mode is not saved. The chat's size and draft live in Herdr's shared state, not in files this mod writes.
- At 560 px the tower is small by design.
- A helper started with `hc run --parent` appears as its own person (found through `terminals()`), borrows its
  parent's tab, cannot be renamed, and `CLOSE…` ends only its terminal.
- Art licence: CC BY 4.0, credit "nowilus (PolyFlow)". The PolyFlow name and logo are not licensed for other products.

## Done when

1. `mod.json` is `{"place":"right","size":560,"title":"Office"}` and Herdr docks "Office" on the right of any
   layout; the bar shows `OFFICE`, `N AGENTS`, `+ AGENT`, `OPEN CHAT`, `CALM`, `DEMO` and no `FULL`, `BOTTOM`,
   `RIGHT`, `FLOAT`, `SCREEN` or `X`.
2. The tower shows four floors labelled `04 // SERVER`, `03 // RESEARCH`, `02 // DEV`, `01 // LOBBY` with a glass
   elevator on the right, letterboxed in the panel.
3. `DEMO` makes six people (Frontend, Backend, Docs, Tests, Review, Deploy) appear and move between floors by the
   elevator within about 20 s: someone at a desk on DEV, at a rack or the bench on SERVER, at a shelf on
   RESEARCH, and a blocked one at the LOBBY help desk with a pulsing `!` and a `! N NEEDS YOU` chip in the bar.
   Pressing `DEMO` again brings the real agents back.
4. With the hooks installed, a real Claude Code agent that edits a file stands at a DEV desk, runs `npm test` at
   the SERVER test bench, reads a file at a RESEARCH shelf and asks a question at the LOBBY help desk; its
   tooltip reads like `name - WORKING: editing App.tsx`. Without hooks it stays on DEV and says "thinking".
5. Left click on a person focuses that agent's terminal and opens its card; right click opens only the card.
   `TERMINAL`, `CHAT`, `MESSAGE`, `STOP`, `RENAME`, `CLOSE…` behave as listed; `MESSAGE` is absent for a blocked agent.
6. Clicking a floor opens its picture view with `< TOWER`, `-`, `+`, `FIT`; the wheel zooms between x1 and x3,
   dragging pans only when zoomed; `< TOWER` returns to the tower.
7. `+ AGENT` starts a new agent in a new tab, the bar shows `CONNECTING ...`, then `<NAME> WALKS INTO THE LOBBY`,
   and a person walks in through the street door.
8. `OPEN CHAT` shows a floating window with the focused agent's conversation (with hooks), a box where Enter sends
   and Shift+Enter breaks the line, tool runs folded into one line, a side panel with NOW and FILES, and
   `TERMINAL`, `−`, `+`, `□`, `X` in a 26 px title bar. For a blocked agent the box is replaced by the banner and
   `OPEN TERMINAL`. Typing a draft and pressing `TERMINAL` puts the draft on the clipboard and shows the strip.
9. `CALM` stops the blinking and pulsing; status stays readable from color, symbol and word.
10. `install.mjs --dry-run` before installing lists the files it would change; after installing, the
    `*.polyflow-backup-*` copies exist next to them; `install.mjs --uninstall` removes the entries again.
