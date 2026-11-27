// Wake on page load (winks fork): only a signed-in person's page load wakes
// the gaming PC, at most once a minute, and nothing happens without
// ODM_WAKE_URL. Pure tests on src/lib/winks-wake.ts (fetch is stubbed).
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { wakeOnPageLoad } from "../src/lib/winks-wake.ts";

const { test, finish } = suite("test-winks-wake");

const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  return new Response("{}");
};
const page = { get: (name) => (name === "upgrade-insecure-requests" ? "1" : null) };
const background = { get: () => null };
const signedIn = () => true;
const loggedOut = () => false;

await test("Without ODM_WAKE_URL nothing is sent.", () => {
  delete process.env.ODM_WAKE_URL;
  assert.equal(wakeOnPageLoad({ headers: page, hasCookie: signedIn, now: 1_000_000 }), false);
  assert.equal(calls.length, 0);
});

await test("A logged-out visitor or a background call does not wake the PC.", () => {
  process.env.ODM_WAKE_URL = "http://speech-proxy:8192/touch?why=page";
  assert.equal(wakeOnPageLoad({ headers: page, hasCookie: loggedOut, now: 2_000_000 }), false);
  assert.equal(wakeOnPageLoad({ headers: background, hasCookie: signedIn, now: 2_000_000 }), false);
  assert.equal(calls.length, 0);
});

await test("A signed-in page load wakes it, once a minute at most.", () => {
  process.env.ODM_WAKE_URL = "http://speech-proxy:8192/touch?why=page";
  assert.equal(wakeOnPageLoad({ headers: page, hasCookie: signedIn, now: 3_000_000 }), true);
  assert.equal(wakeOnPageLoad({ headers: page, hasCookie: signedIn, now: 3_030_000 }), false);
  assert.equal(wakeOnPageLoad({ headers: page, hasCookie: signedIn, now: 3_061_000 }), true);
  assert.deepEqual(calls, ["http://speech-proxy:8192/touch?why=page", "http://speech-proxy:8192/touch?why=page"]);
});

finish();
