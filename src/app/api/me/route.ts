import { getParticipantId, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

export async function GET() {
  const participantId = await getParticipantId();
  if (!participantId) return jsonError("참가 정보가 없습니다.", 401);
  const view = await store.getTeamRace(participantId);
  if (!view) return jsonError("참가 정보를 찾을 수 없습니다.", 404);
  return jsonOk(view);
}
