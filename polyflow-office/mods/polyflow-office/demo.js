// Demo mode: a made-up crew that keeps changing what it does, so the office can be watched (and recorded for the
// gallery) without real agents. Pure functions (no herdr / gpui-kit), so node can test them.

const CAST = ["Frontend", "Backend", "Docs", "Tests", "Review", "Deploy"];

// One beat of an agent's day: its Herdr status and, while working, the tool the activity hook would report.
const SCRIPT = [
  { status: "working", tool: "Edit", target: "App.tsx" },
  { status: "working", tool: "Bash", target: "npm test" },
  { status: "working", tool: "Read", target: "README.md" },
  { status: "idle" },
  { status: "working", tool: "WebSearch", target: "gpui transitions" },
  { status: "working", tool: "Bash", target: "docker ps" },
  { status: "blocked" },
  { status: "working", tool: "TodoWrite" },
  { status: "done" },
];

// Long enough for a trip across the tower (walk, wait, ride, walk) before the next change.
export const DEMO_BEAT_MS = 16000;

// { agents, activity } as Herdr and the activity reader would give them, at time `now` (ms).
export function demoCrew(now) {
  const agents = [];
  const activity = {};
  CAST.forEach((name, i) => {
    const beatMs = DEMO_BEAT_MS + i * 2500; // everyone on their own rhythm
    const beat = SCRIPT[(Math.floor(now / beatMs) + i * 2) % SCRIPT.length];
    const address = `demo-${i + 1}`;
    agents.push({ address, tab_name: name, status: beat.status, focused: false, demo: true });
    if (beat.tool) activity[address] = { at: Math.floor(now / 1000), tool: beat.tool, target: beat.target ?? null };
  });
  return { agents, activity };
}
