// "Suggest my move" (winks fork): asks the utility model for a few good options
// for the character whose fight turn it is, from that character's sheet and
// the fight as the player's own screen shows it. Read-only: nothing is
// stored, no turn is spent, and the storyteller's prompt is untouched.
import { getCampaignById } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { listRecentMessages } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { describeSheet } from "@/lib/dm/prompt";
import { requestUtilityMessage } from "@/lib/dm/model";
import { trackUtilityCall } from "@/lib/dm/call-tracker";
import { withLanguage } from "@/lib/dm/table-language-logic";
import { arcTextTimeoutMs, type ChatMessage } from "@/lib/model-client";
import { initiativeCharacter } from "@/lib/player-characters";
import {
  SUGGEST_SYSTEM,
  describeFightForPlayer,
  parseSuggestions,
  type MoveSuggestion,
} from "@/lib/dm/suggest-logic";

const RECENT_MESSAGES = 8;
const RECENT_CHARS = 700;

export type SuggestResult = { characterName: string; options: MoveSuggestion[] } | { error: string; status: number };

export async function suggestMoves(campaignId: string, userId: string): Promise<SuggestResult> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return { error: "Campaign not found.", status: 404 };
  const encounter = getActiveEncounter(campaignId);
  const view = activePublicEncounter(campaignId);
  if (!encounter || !view?.orderReady) return { error: "Suggestions are for a fight in progress.", status: 409 };
  const current = encounter.order[encounter.turnIndex];
  const sheets = listSheets(campaignId);
  // The character whose turn it is, if this player acts for it: their own
  // hero or a companion they command (the same rule the Hand follows).
  const acting = current?.kind === "pc" ? initiativeCharacter(sheets, userId, current.characterId) : null;
  if (!acting) return { error: "It is not your turn.", status: 409 };

  const fight = describeFightForPlayer({
    round: view.round,
    actingName: acting.name,
    order: view.order.map((entry) => ({ name: entry.name, kind: entry.kind, hidden: entry.hidden })),
    enemies: view.enemies.map((enemy) => ({
      name: enemy.name,
      health: enemy.health,
      status: enemy.status,
      hidden: enemy.hidden,
      conditions: enemy.conditions,
      knockedOut: enemy.knockedOut,
    })),
    party: sheets
      .filter((sheet) => !sheet.summon)
      .map((sheet) => ({ name: sheet.name, currentHp: sheet.currentHp, maxHp: effectiveMaxHp(sheet), conditions: sheet.conditions })),
    turn: view.turn ?? null,
  });
  const recent = listRecentMessages(campaignId, RECENT_MESSAGES)
    .filter((message) => message.authorType !== "system" || /turn|round|death save|falls|down/i.test(message.content))
    .map((message) => {
      const text = message.content.replace(/\[roll:[^\]]+\]\s*/g, "").replace(/\s+/g, " ").trim();
      const clipped = text.length > RECENT_CHARS ? `…${text.slice(-RECENT_CHARS)}` : text;
      return `${message.authorType === "dm" ? "GM" : message.authorType === "player" ? "Player" : "Table"}: ${clipped}`;
    })
    .filter((line) => line.length > 8);

  const messages: ChatMessage[] = [
    { role: "system", content: withLanguage(SUGGEST_SYSTEM, campaign.gameSettings.tableLanguage) },
    {
      role: "user",
      content: [
        "READ-ONLY DATA START",
        `[sheet] The character whose turn it is:\n${describeSheet(acting, "the player", false, {
          encumbrance: campaign.gameSettings.variantRules.encumbrance,
        })}`,
        `[fight]\n${fight}`,
        recent.length ? `[recent] The last moments at the table:\n${recent.join("\n")}` : "",
        "READ-ONLY DATA END",
        "",
        `Suggest ${acting.name}'s best moves this turn.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];

  const reply = await trackUtilityCall(campaignId, "ask", () =>
    requestUtilityMessage(campaign.settings, messages, { meta: { task: "suggest" }, timeoutMs: arcTextTimeoutMs() }),
  );
  if (reply.error) {
    const payload = (await reply.error.json().catch(() => null)) as { error?: string } | null;
    console.error(`[suggest] the model call failed (${reply.error.status}): ${payload?.error ?? "no detail"}`);
    return { error: "The coach is unavailable; try again shortly.", status: 502 };
  }
  const options = parseSuggestions(typeof reply.message?.content === "string" ? reply.message.content : "");
  if (!options) return { error: "No usable suggestions came back; try again.", status: 502 };
  return { characterName: acting.name, options };
}
