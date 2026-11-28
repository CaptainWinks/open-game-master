// Wake the gaming PC when a signed-in person opens a page (winks fork).
//
// The table's pictures, narration and dictation run on a PC that sleeps when
// nobody plays. Our adapters wake it on play; this wakes it a little earlier,
// as soon as someone who is signed in opens any page, so it is up by the time
// the first scene is painted. ODM_WAKE_URL names the adapter's endpoint (a
// POST that wakes the PC and holds it on for a while); unset, nothing happens.
//
// Only page loads count: browsers mark a page load with the header
// Upgrade-Insecure-Requests, which their background data calls never carry,
// and only a request with a session cookie (a signed-in person, not a bot or
// a logged-out visitor). At most one wake a minute.
// The session cookie's name (src/lib/auth.ts SESSION_COOKIE), written out
// here because auth.ts brings the database along, which this hook must not.
const SESSION_COOKIE = "odm_session";
const WAKE_EVERY_MS = 60_000;
let lastWakeAt = 0;

export function wakeOnPageLoad(input: {
  headers: { get(name: string): string | null };
  hasCookie: (name: string) => boolean;
  now?: number;
}): boolean {
  const url = process.env.ODM_WAKE_URL;
  if (!url) return false;
  if (input.headers.get("upgrade-insecure-requests") !== "1") return false;
  if (!input.hasCookie(SESSION_COOKIE)) return false;
  const now = input.now ?? Date.now();
  if (now - lastWakeAt < WAKE_EVERY_MS) return false;
  lastWakeAt = now;
  fetch(url, { method: "POST", signal: AbortSignal.timeout(2000) }).catch(() => {});
  return true;
}
