"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { SessionBanner, bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import type { Floor } from "@/lib/db/campaigns";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import { extraTurnTagT, litOrderRows, orderRowKey } from "@/lib/battlemap/initiative-rows";
import { floorNoticeKey, liveNotice, type HandNotice } from "@/lib/battlemap/hand-table";
import { useT } from "@/lib/locale";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { TurnHoldNote, useTurnHeld } from "@/app/campaigns/[campaignId]/TurnHoldNote";
import type { MoveSuggestion } from "@/lib/dm/suggest-logic";

// Spotlight, held-responses, and initiative banners above the composer;
// the lead gets the release/skip buttons, the current player gets End turn.
export function FloorBanners({
  campaignId,
  floor,
  spotlighted,
  heldSpotlightNames,
  encounter,
  steersStory,
  meUserId = "",
  onRelease,
  onUseSuggestion,
}: {
  campaignId: string;
  floor: Floor;
  spotlighted: CharacterSheet[];
  heldSpotlightNames: string[];
  encounter?: PublicEncounter | null;
  steersStory: boolean;
  meUserId?: string;
  onRelease: () => void;
  // "Suggest my move" (winks fork): put a suggested action in the message
  // box, and with send, send it at once.
  onUseSuggestion?: (action: string, send: boolean) => void;
}) {
  const [endingTurn, setEndingTurn] = useState(false);
  const t = useT();
  // The end-turn route's refusal, in its own words, under the banner, for
  // the turn it answered only (issue 668).
  const [refusalEntry, setRefusalEntry] = useState<HandNotice | null>(null);
  const refusalKey = floorNoticeKey(floor);
  const refusal = liveNotice(refusalEntry, refusalKey);
  const setRefusal = (text: string) => setRefusalEntry(text ? { text, key: refusalKey } : null);
  const myInitiativeTurn =
    floor.mode === "initiative" && meUserId !== "" && floor.userIds.includes(meUserId);
  // The End Turn is in and the move waits on a watcher's stop.
  const held = useTurnHeld(encounter);
  // "Suggest my move" (winks fork): options for this turn only, so they are
  // keyed like the refusal and vanish when the turn moves on.
  const [suggestEntry, setSuggestEntry] = useState<{ stamp: string; options: MoveSuggestion[]; error: string } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const turnStamp: string = refusalKey;
  const suggestions = suggestEntry && suggestEntry.stamp === turnStamp ? suggestEntry : null;

  async function suggest() {
    setSuggesting(true);
    const stamp = turnStamp;
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/suggest`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { options?: MoveSuggestion[]; error?: string };
      setSuggestEntry({ stamp, options: response.ok ? (data.options ?? []) : [], error: response.ok ? "" : (data.error ?? t("No suggestions right now.")) });
    } catch {
      setSuggestEntry({ stamp, options: [], error: t("Could not reach the table.") });
    } finally {
      setSuggesting(false);
    }
  }

  function applySuggestion(action: string, send: boolean) {
    setSuggestEntry(null);
    onUseSuggestion?.(action, send);
  }

  // Attacks no longer end the turn by themselves (movement and bonus
  // actions stay open), so this is the player's way to say "done".
  async function endTurn() {
    setEndingTurn(true);
    setRefusal("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/encounter/end-turn`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setRefusal(data.error ?? t("The turn could not be ended."));
      }
    } catch {
      setRefusal(t("Could not reach the table."));
    } finally {
      setEndingTurn(false);
    }
  }

  return (
    <>
      {floor.mode === "initiative" ? (
        <SessionBanner
          glyph="attitude-hostile"
          tone="blood"
          title={<>{t("Round {round}", { round: floor.round })}</>}
          actions={
            myInitiativeTurn || steersStory ? (
              <>
                {myInitiativeTurn && onUseSuggestion ? (
                  <button
                    type="button"
                    onClick={() => void suggest()}
                    disabled={suggesting || Boolean(held)}
                    aria-busy={suggesting ? true : undefined}
                    className={bannerButtonClass()}
                    title={t("Not sure what to do? Get three good options for this turn.")}
                  >
                    {suggesting ? t("Thinking…") : t("Suggest")}
                  </button>
                ) : null}
                {myInitiativeTurn ? (
                  <button
                    type="button"
                    onClick={endTurn}
                    disabled={endingTurn || Boolean(held)}
                    aria-busy={held ? true : undefined}
                    className={bannerButtonClass(true)}
                    title={t("Done with your action, movement, and bonus action? End your combat turn.")}
                  >
                    {held ? t("Ending turn…") : t("End turn")}
                  </button>
                ) : null}
                {steersStory ? (
                  <button
                    type="button"
                    onClick={onRelease}
                    className={bannerButtonClass()}
                    // Marks the banner as holding something only it offers
                    // (world.css keeps it over a docked Hand for this).
                    data-banner-lead=""
                    title={t("Skip the current player's turn")}
                  >
                    {t("Skip turn")}
                  </button>
                ) : null}
              </>
            ) : null
          }
        >
          <span className="block truncate">
              {encounter?.orderReady && encounter.order.length ? (
                <>
                  {encounter.order.map((entry, index) => {
                    // A player's order leaves hidden combatants out, so the
                    // pointer's index can point past them; the engine names
                    // who it rests on. A thief's second round-1 turn is a
                    // second row with the same id (Thief's Reflexes).
                    const current = litOrderRows(encounter.order, encounter.turnIndex, encounter.acting, encounter.enemiesUp).includes(index);
                    return (
                      <span
                        key={orderRowKey(entry, index)}
                        title={extraTurnTagT(t, entry)?.title}
                        className={cn(
                          "transition-opacity duration-200",
                          current ? "font-semibold" : "opacity-60",
                        )}
                      >
                        {index > 0 ? " > " : ""}
                        {entry.name}
                        {entry.reflex ? <sup className="motion-pop ml-0.5 text-[9px] text-amber-300">{extraTurnTagT(t, entry)?.short}</sup> : null}
                      </span>
                    );
                  })}
                </>
              ) : (
                <>{t("{name}'s turn", { name: floor.currentName })}</>
              )}
          </span>
          {held ? <TurnHoldNote held={held} mine={myInitiativeTurn} className="mt-0.5" /> : null}
          {refusal ? (
            <span key={refusal} role="alert" className="mt-0.5 block animate-fade-up text-xs text-amber-200">
              {refusal}
            </span>
          ) : null}
          {myInitiativeTurn && suggestions ? (
            <span className="mt-1.5 block animate-fade-up space-y-1.5" data-suggestions="">
              {suggestions.error ? (
                <span role="alert" className="block text-xs text-amber-200">
                  {suggestions.error}
                </span>
              ) : null}
              {suggestions.options.map((option, index) => (
                <span key={`${index}-${option.label}`} className="flex items-start gap-2 rounded-md border border-amber-900/50 bg-stone-950/40 px-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-amber-100">{option.label}</span>
                    {option.why ? <span className="block text-xs text-stone-300">{option.why}</span> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => applySuggestion(option.action, false)}
                    className={bannerButtonClass()}
                    title={option.action}
                  >
                    {t("Use")}
                  </button>
                  {index === 0 ? (
                    <button
                      type="button"
                      onClick={() => applySuggestion(option.action, true)}
                      className={bannerButtonClass(true)}
                      title={option.action}
                    >
                      {t("Do it for me")}
                    </button>
                  ) : null}
                </span>
              ))}
            </span>
          ) : null}
        </SessionBanner>
      ) : null}
      {floor.mode === "spotlight" ? (
        <SessionBanner
          glyph="sense-truesight"
          title={floor.respondedUserIds.length ? t("Spotlight, waiting on") : t("Spotlight")}
          lead={
            spotlighted.some((sheet) => sheet.portrait) ? (
              <span className="flex shrink-0 -space-x-2">
                {spotlighted
                  .filter((sheet) => sheet.portrait)
                  .slice(0, 4)
                  .map((sheet) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={sheet.id}
                      src={sheet.portrait!.url}
                      alt=""
                      className="size-8 rounded-full border border-amber-500/60 object-cover shadow-glow-gold"
                    />
                  ))}
              </span>
            ) : undefined
          }
          actions={
            steersStory ? (
              <button type="button" onClick={onRelease} className={bannerButtonClass(true)}>
                {t("Release")}
              </button>
            ) : null
          }
        >
            <span>
              {spotlighted.length
                ? spotlighted.map((sheet, index) => {
                    const responded = floor.respondedUserIds.includes(sheet.userId);
                    return (
                      <span
                        key={sheet.id}
                        className={responded ? "opacity-50" : undefined}
                      >
                        {index > 0 ? ", " : ""}
                        {sheet.name}
                        {responded ? <Check className="inline size-3 align-baseline" /> : null}
                      </span>
                    );
                  })
                : t("Someone")}
              {floor.prompt ? (
                <span className="opacity-80"> · {floor.prompt}</span>
              ) : null}
            </span>
        </SessionBanner>
      ) : null}
      {floor.mode === "hold" && floor.next.mode === "initiative" && encounter?.enemyTurns ? (
        // A fight held for the enemies' turns (src/lib/dm/enemies-due.ts).
        // Reactions still go through. Held responses wrap the fight's floor
        // too, and keep their own banner below.
        <SessionBanner
          glyph="tab-battle"
          title={t("Enemy turns")}
          actions={
            steersStory ? (
              <button type="button" onClick={onRelease} className={bannerButtonClass(true)}>
                {t("Hand on the turn", { context: "lead.floor.handOn" })}
              </button>
            ) : null
          }
        >
          <span>
            {t("The enemies act before {name}; the GM hands on the turn.", { name: floor.next.currentName || t("the next turn") })}
          </span>
        </SessionBanner>
      ) : floor.mode === "hold" ? (
        <SessionBanner
          glyph="rest-inspiration"
          title={t("Responses held")}
          actions={
            steersStory ? (
              <button type="button" onClick={onRelease} className={bannerButtonClass(true)}>
                {t("Allow responses")}
              </button>
            ) : null
          }
        >
          <span>
            {t("Talk it over; the lead opens the floor.")}
            {heldSpotlightNames.length ? (
              <span className="opacity-80">
                {" "}
                {t("Next: spotlight on {names}", { names: heldSpotlightNames.join(", ") })}
              </span>
            ) : null}
          </span>
        </SessionBanner>
      ) : null}
    </>
  );
}
