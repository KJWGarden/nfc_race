import { configGuard, jsonError, jsonOk, setParticipantCookie } from "@/lib/auth";
import { store } from "@/lib/db";

const NOT_FOUND = "일치하는 팀원을 찾을 수 없습니다.";

// 기능: 쿠키를 잃은 참가자가 세션 코드 + 팀 코드 + 이름으로 기존 참가자로 다시 들어온다.
// 어느 값이 틀렸는지 알리지 않도록 조회 실패는 모두 같은 오류로 돌려주고 쿠키를 설정하지 않는다.
export async function POST(request: Request) {
  const configError = configGuard();
  if (configError) return configError;
  const body = (await request.json()) as { code?: unknown; joinCode?: unknown; name?: unknown };
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const joinCode = typeof body.joinCode === "string" ? body.joinCode.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!code) return jsonError("세션 코드를 입력해 주세요.");
  if (!joinCode) return jsonError("팀 코드를 입력해 주세요.");
  if (!name) return jsonError("이름을 입력해 주세요.");
  const result = await store.findRejoinParticipant(code, joinCode, name);
  if (!result.ok) {
    if (result.reason === "ambiguous") {
      return jsonError("같은 이름의 팀원이 여러 명입니다. 운영진에게 문의해 주세요.", 409);
    }
    return jsonError(NOT_FOUND, 400);
  }
  await setParticipantCookie(result.participantId);
  return jsonOk({ participantId: result.participantId });
}
