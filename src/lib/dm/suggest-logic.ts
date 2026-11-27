// "Suggest my move": a few good options for the character whose fight turn it
// is, for a player still learning the rules (winks fork). Pure parts only:
// the instruction, the fight as the player sees it, and the reply's parsing.
// The model call is src/lib/dm/suggest.ts.

export const SUGGEST_MAX_OPTIONS = 3;
const LABEL_MAX = 60;
const WHY_MAX = 220;
const ACTION_MAX = 300;

export type MoveSuggestion = {
  // A few words for the button: "Longsword the enforcer".
  label: string;
  // One sentence on why it is a good move right now.
  why: string;
  // What the player sends, in their own voice: "I attack the enforcer with my longsword."
  action: string;
};

export const SUGGEST_SYSTEM = `You are a friendly tactics coach sitting beside a player who is new to 5e combat. It is their character's turn in a fight. Suggest the ${SUGGEST_MAX_OPTIONS} best things they could do THIS turn, best first.

Rules:
- Use only what the character really has: the weapons, spells (with slots left), features and items on their sheet. Never invent an ability.
- Use only what the player can see in the fight data. Never guess an enemy's exact hit points or anything hidden.
- Respect what the turn has already used (action, bonus action, attacks made).
- Prefer moves that keep the party alive: protect or heal a downed or badly hurt ally, focus the most wounded or most dangerous enemy, take cover or withdraw when the character is about to fall.
- Each option may combine an action with a bonus action or movement when the sheet allows it.
- Write "action" as the player would type it to the Game Master, first person, one or two short sentences, naming the target: "I attack the Corpo Enforcer with my longsword."
- Plain words, no rules jargon the player would not know, no dice math.

Reply with ONLY a strict JSON object, no code fences, shaped exactly:
{"options": [{"label": string (at most 6 words), "why": string (one short sentence), "action": string}]}`;

function clip(text: unknown, max: number): string {
  const value = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

// The model's reply, read leniently: code fences and prose around the object
// are dropped, unusable options skipped, at most SUGGEST_MAX_OPTIONS kept.
// Null when nothing usable came back.
export function parseSuggestions(raw: string): MoveSuggestion[] | null {
  // Whatever stands before the first brace and after the last one goes.
  const body = String(raw ?? "").replace(/^[^{]*/, "").replace(/[^}]*$/, "");
  if (!body) return null;
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  const list = (data as { options?: unknown })?.options;
  if (!Array.isArray(list)) return null;
  const options: MoveSuggestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const action = clip(entry.action, ACTION_MAX);
    if (!action) continue;
    options.push({
      label: clip(entry.label, LABEL_MAX) || clip(action, LABEL_MAX),
      why: clip(entry.why, WHY_MAX),
      action,
    });
    if (options.length >= SUGGEST_MAX_OPTIONS) break;
  }
  return options.length ? options : null;
}

export type FightViewInput = {
  round: number;
  actingName: string;
  order: Array<{ name: string; kind: string; hidden?: boolean }>;
  enemies: Array<{ name: string; health: string; status: "alive" | "dead" | "fled"; hidden?: boolean; conditions?: string[]; knockedOut?: boolean }>;
  party: Array<{ name: string; currentHp: number; maxHp: number; conditions: string[] }>;
  turn?: { actionUsed?: boolean; bonusUsed?: boolean; attacksMade?: number; attacksAllowed?: number; dashed?: boolean; disengaged?: boolean } | null;
};

// The fight as the player's own screen shows it: hidden combatants left out,
// enemies by their health word, never their numbers.
export function describeFightForPlayer(view: FightViewInput): string {
  const lines: string[] = [];
  lines.push(`Round ${view.round}. It is ${view.actingName}'s turn.`);
  const order = view.order.filter((entry) => !entry.hidden).map((entry) => entry.name);
  if (order.length) lines.push(`Turn order: ${order.join(", ")}.`);
  const enemies = view.enemies.filter((enemy) => !enemy.hidden && enemy.status === "alive");
  lines.push(
    enemies.length
      ? `Enemies still in the fight:\n${enemies
          .map((enemy) => {
            const extra = [...(enemy.knockedOut ? ["knocked out"] : []), ...(enemy.conditions ?? [])];
            return `- ${enemy.name}: ${enemy.health}${extra.length ? ` (${extra.join(", ")})` : ""}`;
          })
          .join("\n")}`
      : "No enemies are visible right now.",
  );
  if (view.party.length) {
    lines.push(
      `The party:\n${view.party
        .map((member) => `- ${member.name}: ${member.currentHp}/${member.maxHp} hit points${member.currentHp <= 0 ? " (down, dying)" : ""}${member.conditions.length ? `, ${member.conditions.join(", ")}` : ""}`)
        .join("\n")}`,
    );
  }
  const turn = view.turn;
  if (turn) {
    const used: string[] = [];
    if (turn.actionUsed) used.push("action used");
    if (turn.bonusUsed) used.push("bonus action used");
    if (turn.attacksMade) used.push(`${turn.attacksMade} of ${turn.attacksAllowed ?? 1} attacks made`);
    if (turn.dashed) used.push("dashed");
    if (turn.disengaged) used.push("disengaged");
    lines.push(used.length ? `This turn so far: ${used.join(", ")}.` : "Nothing used yet this turn.");
  }
  return lines.join("\n");
}
