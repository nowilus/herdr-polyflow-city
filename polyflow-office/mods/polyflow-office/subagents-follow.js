// One reader of the internal subagents for all of the office's views. Without it the tower and the agent tree each ask
// hooks/subagents.mjs for every Claude agent every 3 seconds (the same answer twice); with it one of them asks and the other
// shows what was shared. Ownership is a lease in its own shared key (never inside the data map, whose values are lists):
//   polyflow-office.subagents-reader.v1  { owner, role, at }        polyflow-office.subagents  { [address]: [...] }  (unchanged)
// The owner renews `at` every SUBAGENTS_HEARTBEAT_MS by a timer of its own (not at the end of a round, which can take up to
// 30 s), only while its view is visible. The tower ("office") takes the lease from a tree at once; a tree takes it only
// from a lease that is older than SUBAGENTS_LEASE_MS (nobody is reading). polyflow-agents keeps a byte-identical copy.
import { setShared, shared } from "herdr";
import { followSubagents } from "./activity-reader.js";

export const SUBAGENTS_KEY = "polyflow-office.subagents";
export const SUBAGENTS_READER_KEY = "polyflow-office.subagents-reader.v1";
export const SUBAGENTS_LEASE_MS = 15000;
export const SUBAGENTS_HEARTBEAT_MS = 3000;
export const SUBAGENTS_MIRROR_MS = 3000;

// Whether `owner` (of this `role`) may read now, given the lease as it stands (null: none). The lease's own owner always
// may; the tower may take over from anything that is not a tower's; anyone may take a lease that is old, from the future
// (a clock set back) or without a time.
export function canReadSubagents(lease, owner, role, now) {
  if (lease?.owner === owner) return true;
  if (role === "office" && lease?.role !== "office") return true;
  const age = now - lease?.at;
  return !Number.isFinite(lease?.at) || age < 0 || age > SUBAGENTS_LEASE_MS;
}

const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Follow the subagents for `view` (view.subagents is kept current: read here when this view owns the lease, taken from the
// shared copy when it does not). visible(): whether the view is on screen (a hidden owner stops renewing and reading).
// -> { stop() }
export function followSharedSubagents(view, cx, visible = () => true, role = "office") {
  const owner = `${role}-${Date.now()}-${Math.random()}`;
  let stopped = false;
  const mine = () => shared(SUBAGENTS_READER_KEY)?.owner === owner;

  // The lease: taken when it may be, renewed while it is ours. Runs on its own timer, whatever a round is doing.
  const claim = () => {
    if (stopped || !visible()) return;
    if (canReadSubagents(shared(SUBAGENTS_READER_KEY), owner, role, Date.now())) setShared(SUBAGENTS_READER_KEY, { owner, role, at: Date.now() });
  };
  // What the owner found goes into the shared copy only while the lease is still ours (a round that began before a
  // takeover may end after it), and only when it differs.
  const publish = (subagents) => {
    if (stopped || !mine()) return;
    if (JSON.stringify(subagents) !== JSON.stringify(shared(SUBAGENTS_KEY))) setShared(SUBAGENTS_KEY, subagents);
  };
  // Not the owner: show what the owner shared (no process).
  const mirror = (tick) => {
    if (stopped || mine() || !visible()) return;
    const data = shared(SUBAGENTS_KEY);
    if (isMap(data) && JSON.stringify(data) !== JSON.stringify(view.subagents)) {
      view.subagents = data;
      tick.notify();
    }
  };

  claim();
  const reader = followSubagents(view, cx, () => visible() && mine(), publish, { stillMine: () => !stopped && mine() });
  mirror(cx);
  const beat = cx.timer.every(SUBAGENTS_HEARTBEAT_MS, () => claim());
  const look = cx.timer.every(SUBAGENTS_MIRROR_MS, (tick) => mirror(tick));
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      reader.stop();
      beat.cancel();
      look.cancel();
    },
  };
}
