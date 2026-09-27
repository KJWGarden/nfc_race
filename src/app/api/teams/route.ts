import { getParticipantId, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

export async function POST(request: Request) {
  const participantId = await getParticipantId();
  if (!participantId) return jsonError("참가 정보가 없습니다.", 401);
  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name) return jsonError("팀 이름을 입력해 주세요.");
  const result = await store.createTeam(participantId, name);
  if (!result.ok) return jsonError(result.error);
  return jsonOk(result);
}
