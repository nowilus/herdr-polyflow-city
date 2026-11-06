// "Screen": the office in its own system window, for a second monitor.
// A second Herdr window with its own home (`<app home>-office`) joins the same herdr-core, so it shows the same
// agents. Mods may only write inside their own folders, so a launcher script shipped in `screen/` does the
// work: it copies the polyflow mods, the theme, the one-block layout and the person's settings into that home
// (on every launch, so the screen follows updates), starts the window and switches it to the office.
import { appHome, exec, window } from "herdr";

const trimSlash = (p) => p.replace(/[\\/]+$/, "");
export const screenHome = () => `${trimSlash(appHome())}-office`;

function launchCommand(app, home) {
  if (window()?.platform === "windows") {
    const win = (p) => p.replace(/\//g, "\\");
    return ["cmd", ["/c", win(`${app}/mods/polyflow-office/screen/launch.cmd`), win(app), win(home)]];
  }
  return ["sh", [`${app}/mods/polyflow-office/screen/launch.sh`, app, home]];
}

// Start the screen window. Resolves to null, or an error message for the person.
export async function openScreen() {
  const app = trimSlash(appHome());
  const [cmd, args] = launchCommand(app, screenHome());
  try {
    const r = await exec(cmd, args);
    if (r.code === 0) return null;
    return r.code === 1 ? "The screen window didn't answer in 20 s" : `Couldn't open the screen (${r.stderr.trim() || `exit ${r.code}`})`;
  } catch (e) {
    return `Couldn't open the screen: ${String(e?.message ?? e)}`;
  }
}
