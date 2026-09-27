import { getParticipantId, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";
import { verifySun } from "@/lib/sun-keys";

export async function POST(request: Request) {
  const participantId = await getParticipantId();
  if (!participantId) return jsonError("참가 정보가 없습니다.", 401);
  const body = (await request.json()) as { e?: unknown; c?: unknown };

  // 변경: SUN 파라미터(e, c)만 받는다. 정적 토큰·UID 만 있는 요청은 지점으로 인정하지 않는다.
  if (body.e == null && body.c == null) {
    return jsonError("태그 정보가 없습니다.");
  }
  if (typeof body.e !== "string" || typeof body.c !== "string") {
    return jsonError("유효하지 않은 태그입니다.");
  }

  // 기능: 서버에서 복호화·MAC 검증 후 검증된 UID·카운터로만 기록한다
  const sun = verifySun(body.e, body.c);
  if (!sun.ok) return jsonError(sun.error, sun.status);
  const result = await store.recordSunTag({ participantId, uid: sun.uid, ctr: sun.ctr });
  if (!result.ok) {
    return jsonError(result.error, 400);
  }
  return jsonOk(result);
}
