import { getParticipantId, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

export async function POST(request: Request) {
  const participantId = await getParticipantId();
  if (!participantId) return jsonError("참가 정보가 없습니다.", 401);
  const body = (await request.json()) as { joinCode?: string };
  const joinCode = body.joinCode?.trim();
  if (!joinCode) return jsonError("팀 코드를 입력해 주세요.");
  const result = await store.joinTeam(participantId, joinCode);
  if (!result.ok) return jsonError(result.error);
  return jsonOk(result);
}
