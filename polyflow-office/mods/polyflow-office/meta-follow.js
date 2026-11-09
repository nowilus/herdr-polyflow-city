// Shared ownership around the unchanged meta reader. `at` is a reader heartbeat, never the provider's data age.
// Office readers take priority; a standalone tree takes over after 15 seconds without a heartbeat.
import { shared, setShared } from "herdr";
import { META_KEY } from "./energy.js";
import { META_MS, followMeta } from "./meta-reader.js";

export const META_LEASE_MS = 15000;

export function canReadMeta(snapshot, owner, role, now) {
  if (snapshot?.reader?.owner === owner) return true;
  if (role === "office" && snapshot?.reader?.role !== "office") return true;
  const age = now - snapshot?.at;
  return !Number.isFinite(snapshot?.at) || age < 0 || age > META_LEASE_MS;
}

export function followSharedMeta(view, cx, visible = () => true, role = "office") {
  const owner = `${role}-${Date.now()}-${Math.random()}`;
  const publish = (data) => setShared(META_KEY, { ...data, agents: data?.agents ?? {}, limits: data?.limits ?? {}, at: Date.now(), reader: { owner, role } });
  followMeta(view, cx, () => {
    if (!visible()) return false;
    const snapshot = shared(META_KEY);
    if (!canReadMeta(snapshot, owner, role, Date.now())) return false;
    // Keep unchanged data alive too; otherwise a quiet office looks dead and the tree starts duplicate reads.
    view.meta = snapshot ?? view.meta;
    if (snapshot?.reader?.owner !== owner || Date.now() - snapshot.at >= META_MS || Date.now() < snapshot.at) publish(view.meta);
    return true;
  }, (next) => {
    // A request begun before an office takeover may finish afterwards; it must not reclaim the lease.
    if (shared(META_KEY)?.reader?.owner === owner) publish(next);
  });
  // exec can take up to 30 seconds. Its busy guard must not make a live reader lose ownership mid-request.
  cx.timer.every(META_MS, () => {
    const snapshot = shared(META_KEY);
    if (visible() && snapshot?.reader?.owner === owner && (Date.now() - snapshot.at >= META_MS || Date.now() < snapshot.at)) publish(snapshot);
  });
}
