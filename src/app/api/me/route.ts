import { configGuard, getParticipantId, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

export async function GET() {
  // 변경: 운영 설정 오류(비밀 값 누락·기본값)면 쿠키를 읽거나 쓰지 않고 503
  const configError = configGuard();
  if (configError) return configError;
  const participantId = await getParticipantId();
  if (!participantId) return jsonError("참가 정보가 없습니다.", 401);
  const view = await store.getTeamRace(participantId);
  if (!view) return jsonError("참가 정보를 찾을 수 없습니다.", 404);
  return jsonOk(view);
}
