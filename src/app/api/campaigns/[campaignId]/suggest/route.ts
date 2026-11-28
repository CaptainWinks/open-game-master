import { isErrorResponse, requireVoice } from "@/lib/campaign-api";
import { suggestMoves } from "@/lib/dm/suggest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Suggest my move" (winks fork): a few good options for the character whose
// fight turn this player holds. Like Ask it spends no turn and stores
// nothing; unlike Ask it only answers on the player's own turn in a fight.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const result = await suggestMoves(campaignId, context.user.id);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result);
}
