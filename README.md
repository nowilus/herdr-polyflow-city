# PolyFlow City

A cyberpunk pixel-art layout for [Herdr](https://herdr.dev), plus **PolyFlow Office**: a mod that shows your
coding agents as characters walking around a four-floor office tower.

![PolyFlow City](polyflow-city/preview.png)

**Beta (v0.1.0-beta).** Built and tested on Windows 11. macOS and Linux are untested.

| Entry | Kind | What you get |
|---|---|---|
| [`polyflow-city/`](polyflow-city/) | layout | The whole look: night-city sidebar, character cards for agents, portrait tabs, neon theme, and the office |
| [`polyflow-office/`](polyflow-office/) | mod | Only the office tower, docked on the right of the layout you already use |

## Features

- **Agents as characters.** Every Claude Code or Codex agent gets a pixel character (netrunner, techie, solo,
  fixer, medtech and more) on its sidebar card and its tab. The character works, raises a hand when the agent
  needs you, and rests when it is done.
- **Spaces as buildings.** Each space in the sidebar is a small pixel building on a rainy skyline.
- **The office tower.** Agents walk to the station that matches what they are doing: desks for writing code,
  the archive for reading, the server room for running commands, the lobby help desk when they need you.
- **Chat with an agent.** Click a character to open its conversation in a chat window: read the history,
  type a message, or switch to the real terminal.
- **Agent card.** Right-click a character for terminal, chat, message, stop, rename and close.
- **Calm mode** with no blinking lights, and a **demo mode** with a made-up crew.
- **Files, Changes and Inbox** pages in a side panel, carried over from Traveler.

![PolyFlow Office](polyflow-office/preview.png)

## Install

Ask the agent in your Herdr window:

> Add the layout from https://github.com/nowilus/herdr-polyflow-city/tree/main/polyflow-city

or, for the office alone:

> Add the mod from https://github.com/nowilus/herdr-polyflow-city/tree/main/polyflow-office

By hand: copy the contents of `polyflow-city/` (the `layouts/`, `themes/` and `mods/` folders) into your Herdr
home (`~/.config/herdr-app`), then:

```sh
herdr-app check ~/.config/herdr-app/mods/polyflow-office
herdr-app do layout.switch --name polyflow-city
```

For the office alone, copy `polyflow-office/mods/polyflow-office` into `~/.config/herdr-app/mods/`. It docks on
the right of whatever layout you use. If it does not show up, add a block with `"content": { "mod": "polyflow-office" }`
(about 560px wide) to your layout, or ask your agent to.

### Optional: activity hook

Without it the office still works: working agents sit at a desk. With it, the office knows which tool an agent is
using and the chat can show the conversation. It needs `node` on PATH.

```sh
node ~/.config/herdr-app/mods/polyflow-office/hooks/install.mjs --dry-run   # show what would change
node ~/.config/herdr-app/mods/polyflow-office/hooks/install.mjs             # install
node ~/.config/herdr-app/mods/polyflow-office/hooks/install.mjs --uninstall # remove
```

## What it runs and reads

Herdr asks agents to tell you this before installing a mod. In short:

- **No network.** None of the mods make network calls.
- **Programs:** `git` (status of each space's folder), `hc` (`send` and `interrupt` to type into an agent or stop
  it, `machine ls`), `node` (the conversation reader and the optional hook), and on Windows `powershell.exe` and
  `rundll32.exe` for the inbox. The office's SCREEN button starts a second Herdr window.
- **Files read outside the mod folders:** the tail of an agent's conversation file (`~/.claude/projects/…` or
  `~/.codex/sessions/…`) while its chat is open, and the activity files the hook writes under
  `~/.config/herdr-app/data/`.
- **Files changed outside the mod folders:** only when you run the hook installer. It edits
  `~/.claude/settings.json` and `~/.codex/hooks.json`, after copying each to a `.polyflow-backup-<time>` file.
  The hook stores tool names, file base names and the first words of commands; never prompts, file contents
  or tool output.
- **Actions on your agents:** the office can type into an agent (`hc send`), stop it, rename its tab and close
  it, but only when you click those buttons. It never answers approvals for you.

Each `RECIPE.md` lists the details.

## Updating

Copy the new folders over the old ones. Your character choices live in `mods/polyflow-agents/jobs.json`; keep
that file if you edited it.

## Credits

Forked from [Traveler](https://github.com/franky5440-afk/herdr-traveler) by Frank Lin (Apache-2.0), which
builds on Herdr's own spaces, tabs and chrome mods. Fonts: Chakra Petch and Silkscreen (SIL Open Font License).

## License

Code: Apache-2.0, see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Art: CC BY 4.0, "Art by nowilus (PolyFlow)",
see [`ART-NOTICE.md`](ART-NOTICE.md). The art is AI-generated.

This is a community project, not affiliated with Herdr.
