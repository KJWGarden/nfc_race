import { configGuard, getParticipantId, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";
import { verifySun } from "@/lib/sun-keys";

// 지점 토큰 형식 (createTagToken: 소문자·숫자 10자)
const STATIC_TOKEN = /^[0-9a-z]{10}$/i;

export async function POST(request: Request) {
  // 변경: 운영 설정 오류(비밀 값 누락·기본값)면 쿠키를 읽거나 쓰지 않고 503
  const configError = configGuard();
  if (configError) return configError;
  const participantId = await getParticipantId();
  if (!participantId) return jsonError("참가 정보가 없습니다.", 401);
  const body = (await request.json()) as { e?: unknown; c?: unknown; token?: unknown };

  // 변경: SUN 파라미터(e, c)가 없으면 고정 URL 토큰만 받는다. 세션 스위치 확인은 DB 함수 안에서 하며, UID 만 있는 요청은 인정하지 않는다.
  if (body.e == null && body.c == null) {
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!STATIC_TOKEN.test(token)) return jsonError("태그 정보가 없습니다.");
    const result = await store.recordStaticTag({ participantId, token });
    if (!result.ok) return jsonError(result.error, 400);
    return jsonOk(result);
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
