// One tool list in and out of a fight (winks fork, DM_STEADY_TOOLS=1,
// src/lib/dm/turn.ts steadyTurnTools): a fight's start and end leave the
// start of the prompt (the tools and the system message) as it was, so a
// provider's prompt cache keeps it, and the fight's rules ride with the game
// state after the history instead (src/lib/dm/prompt.ts fightRulesWithState).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-steady-tools-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_CONTEXT = "131072";
process.env.DM_THINKING = "0";
process.env.DM_TURN_WARMUP = "0";
process.env.DM_MOMENT_AFTER_HISTORY = "1";
process.env.DM_STATE_AFTER_HISTORY = "1";
process.env.DM_STEADY_TOOLS = "1";
register("./lib/register-alias.mjs", import.meta.url);

const { THIS_TURN_HEADING } = await import("../src/lib/prompt-boundary.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const requests = [];
let script = [];
const isDmCall = (body) => Array.isArray(body.tools) && body.tools.length > 5;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (req.url.startsWith("/props")) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ default_generation_settings: { n_ctx: 131_072 } }));
      return;
    }
    if (req.url.endsWith("/v1/models")) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: "fake" }] }));
      return;
    }
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push(body);
    const dm = isDmCall(body);
    const next = dm ? (script.shift() ?? { content: "The road winds on. What do you do?" }) : { content: "[]" };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = next.call
      ? { tool_calls: [{ index: 0, id: `call_${requests.length}`, type: "function", function: { name: next.call, arguments: JSON.stringify(next.args ?? {}) } }] }
      : { content: next.content };
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: next.call ? "tool_calls" : "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateStorySettings, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { createSheet, listSheets, patchSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { getDmTurn, getLatestDmTurnId, listRecentDmTurns } = await import("../src/lib/db/dm-turns.ts");
const { startDmTurn, dmTurnTools } = await import("../src/lib/dm/turn.ts");
const { dmQueueDepth, enqueueDmJob } = await import("../src/lib/dm/queue.ts");
const { getActiveEncounter } = await import("../src/lib/db/encounters.ts");

async function playTurn(campaignId) {
  let own = null;
  await enqueueDmJob(campaignId, async () => {
    const before = new Set(listRecentDmTurns(campaignId, 200).map((turn) => turn.id));
    await startDmTurn(campaignId);
    own = listRecentDmTurns(campaignId, 200).find((turn) => !before.has(turn.id) && turn.actor === "ai")?.id ?? null;
  }, { kind: "turn" });
  while (dmQueueDepth(campaignId) > 0) {
    await enqueueDmJob(campaignId, async () => {});
  }
  return getDmTurn(own ?? getLatestDmTurnId(campaignId));
}

const lead = createUser(`lead${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
const campaign = (() => {
  const made = createCampaign(lead.id, { title: "Steady", description: "A road.", theme: "a road", maxPlayers: 2, startingLevel: 1, difficulty: "normal", gameSettings: { ttsEnabled: false } });
  updateStorySettings(made.id, { textProvider: "custom", customBaseUrl: baseUrl, customModel: "fake", imageGenerationEnabled: false, autoImages: false });
  setCampaignStatus(made.id, "active");
  const sheet = createSheet(made.id, lead.id, 1, createSheetSchema.parse({
    name: "Bram", race: "human", class: "fighter", abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, maxHp: 300, ac: 16,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: ["athletics"], languages: ["common"], tools: [], armor: [], weapons: [] },
  }));
  patchSheet(sheet.id, { maxHp: 300, currentHp: 300 });
  insertCampaignMessage({ campaignId: made.id, seq: allocateSeq(made.id), authorType: "player", userId: lead.id, characterId: sheet.id, content: "Bandits leap from the ditch! I draw my sword." });
  return getCampaignById(made.id);
})();

const names = (tools) => tools.map((tool) => tool.function.name);
const FIGHT_OPENING = "Combat rules (an encounter is active):";
const fightRuleMessages = (body) => body.messages.filter((message) => typeof message.content === "string" && message.content.includes(FIGHT_OPENING));

let openingSystem = "";
let openingTools = null;

await test("the list is one list: both sides of a fight, each tool once", () => {
  const outside = dmTurnTools(campaign, false, false, false);
  const inside = dmTurnTools(campaign, true, false, false);
  assert.deepEqual(outside, inside, "the same list in and out of a fight");
  const listed = names(outside);
  assert.equal(new Set(listed).size, listed.length, "no tool twice");
  for (const name of ["start_encounter", "pc_attack", "enemy_attack", "end_turn", "end_encounter", "take_rest", "move_party"]) {
    assert.ok(listed.includes(name), `${name} offered`);
  }
  delete process.env.DM_STEADY_TOOLS;
  assert.notDeepEqual(names(dmTurnTools(campaign, false, false, false)), names(dmTurnTools(campaign, true, false, false)), "off, the list still follows the fight");
  process.env.DM_STEADY_TOOLS = "1";
});

await test("a fight begun mid-turn leaves the tools and the rules message as they were, and its rules come as one update", async () => {
  script = [{ call: "start_encounter", args: { enemies: [{ monster: "bandit" }, { monster: "bandit" }] } }, { content: "Steel rings as two bandits close in." }];
  requests.length = 0;
  const turn = await playTurn(campaign.id);
  assert.equal(turn.status, "done", `the opening finished (${turn.status}): ${turn.error ?? ""}`);
  assert.ok(getActiveEncounter(campaign.id), "the fight is on");
  const calls = requests.filter(isDmCall);
  assert.ok(calls.length >= 2, "the fight opened and the turn went on");
  openingSystem = calls[0].messages[0].content;
  openingTools = calls[0].tools;
  assert.ok(!openingSystem.includes(FIGHT_OPENING), "no fight rules in the system message");
  for (const body of calls) {
    assert.equal(body.messages[0].content, openingSystem, "the system message never changed");
    assert.deepEqual(body.tools, openingTools, "the tools never changed");
  }
  const update = (message) => message.role === "user" && message.content.startsWith(`${THIS_TURN_HEADING}\n[GAME STATE UPDATE] A fight began this turn.`);
  assert.ok(update(fightRuleMessages(calls[1])[0] ?? { content: "" }), "the call after start_encounter has the fight's rules as an update");
  for (const body of calls) {
    assert.ok(fightRuleMessages(body).length <= 1, "the fight's rules ride once a call");
  }
  assert.equal(fightRuleMessages(calls[0]).length, 0, "and not before the fight began");
});

await test("the fight's next turn reads the same start of the prompt, with the fight's rules beside the state", async () => {
  const bram = listSheets(campaign.id)[0];
  insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId: lead.id, characterId: bram.id, content: "I swing my longsword at the nearest bandit." });
  script = [{ content: "The bandit circles, wary." }];
  requests.length = 0;
  const turn = await playTurn(campaign.id);
  assert.equal(turn.status, "done", `the next turn finished (${turn.status}): ${turn.error ?? ""}`);
  const first = requests.filter(isDmCall)[0];
  assert.equal(first.messages[0].content, openingSystem, "the system message is the one before the fight");
  assert.deepEqual(first.tools, openingTools, "the tools are the ones before the fight");
  const held = fightRuleMessages(first);
  assert.equal(held.length, 1, "the fight's rules ride once");
  assert.ok(held[0].content.startsWith(THIS_TURN_HEADING) && held[0].content.includes("=== GAME STATE, THIS MOMENT"), "in the state's message after the history");
  assert.ok(held[0].content.indexOf(FIGHT_OPENING) < held[0].content.indexOf("=== GAME STATE, THIS MOMENT"), "standing with the rules that change, ahead of the moment");
});

server.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`winks steady tools: ${passed} tests passed`);
process.exit(0);
