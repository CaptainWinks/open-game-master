// "Suggest my move" (winks fork): the reply is read leniently and never
// trusted to be well formed, and the fight it is built from is the player's
// own view (no hidden enemies, no enemy numbers). Pure tests on
// src/lib/dm/suggest-logic.ts.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { SUGGEST_MAX_OPTIONS, describeFightForPlayer, parseSuggestions } from "../src/lib/dm/suggest-logic.ts";

const { test, finish } = suite("test-suggest");

await test("A clean reply gives its options in order.", () => {
  const raw = JSON.stringify({
    options: [
      { label: "Longsword the enforcer", why: "He is bloodied.", action: "I attack the Corpo Enforcer with my longsword." },
      { label: "Help Nyx", why: "She is dying.", action: "I use my healer's kit on Nyx." },
    ],
  });
  const options = parseSuggestions(raw);
  assert.equal(options.length, 2);
  assert.equal(options[0].label, "Longsword the enforcer");
  assert.equal(options[1].action, "I use my healer's kit on Nyx.");
});

await test("Code fences and prose around the object are ignored.", () => {
  const raw = "Here you go:\n```json\n{\"options\":[{\"label\":\"Fire Bolt\",\"why\":\"Safe from range.\",\"action\":\"I cast Fire Bolt at the scout.\"}]}\n```";
  assert.equal(parseSuggestions(raw)?.[0].action, "I cast Fire Bolt at the scout.");
});

await test("Options with no action are skipped; a missing label falls back to the action; at most the cap is kept.", () => {
  const raw = JSON.stringify({
    options: [
      { label: "Nothing", why: "x" },
      { action: "I dodge." },
      { label: "a", action: "I attack." },
      { label: "b", action: "I shove." },
      { label: "c", action: "I hide." },
    ],
  });
  const options = parseSuggestions(raw);
  assert.equal(options.length, SUGGEST_MAX_OPTIONS);
  assert.equal(options[0].label, "I dodge.");
  assert.equal(options[0].why, "");
});

await test("Unusable replies give null.", () => {
  assert.equal(parseSuggestions(""), null);
  assert.equal(parseSuggestions("no json here"), null);
  assert.equal(parseSuggestions("{\"options\": []}"), null);
  assert.equal(parseSuggestions("{\"options\": \"attack\"}"), null);
  assert.equal(parseSuggestions("{broken"), null);
});

await test("Long fields are clipped.", () => {
  const options = parseSuggestions(JSON.stringify({ options: [{ label: "x".repeat(200), why: "y".repeat(500), action: "z".repeat(900) }] }));
  assert.ok(options[0].label.length <= 60);
  assert.ok(options[0].why.length <= 220);
  assert.ok(options[0].action.length <= 300);
});

await test("The fight leaves out hidden and dead enemies, shows health words, the party's hit points and what the turn used.", () => {
  const text = describeFightForPlayer({
    round: 2,
    actingName: "Poppy",
    order: [
      { name: "Nyx", kind: "pc" },
      { name: "Ambusher", kind: "enemy", hidden: true },
      { name: "Corpo Enforcer", kind: "enemy" },
    ],
    enemies: [
      { name: "Corpo Enforcer", health: "bloodied", status: "alive", conditions: ["prone"] },
      { name: "Ambusher", health: "healthy", status: "alive", hidden: true },
      { name: "Old Guard", health: "dead", status: "dead" },
    ],
    party: [
      { name: "Nyx", currentHp: 0, maxHp: 11, conditions: ["unconscious"] },
      { name: "Poppy", currentHp: 9, maxHp: 13, conditions: [] },
    ],
    turn: { actionUsed: true, attacksMade: 1, attacksAllowed: 1 },
  });
  assert.match(text, /Round 2\. It is Poppy's turn\./);
  assert.match(text, /Corpo Enforcer: bloodied \(prone\)/);
  assert.doesNotMatch(text, /Ambusher/);
  assert.doesNotMatch(text, /Old Guard/);
  assert.match(text, /Nyx: 0\/11 hit points \(down, dying\), unconscious/);
  assert.match(text, /action used, 1 of 1 attacks made/);
});

finish();
