import { isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";
import { toSunParams } from "@/lib/nfc";
import { verifySun } from "@/lib/sun-keys";

// 기능: 관리자 모드(/t)의 읽기 전용 조회. SUN 을 검증해 UID·카운터와 등록 현황만 반환하고 아무것도 기록하지 않는다.
export async function POST(request: Request) {
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const body = (await request.json()) as { e?: unknown; c?: unknown };
  const sunParams = toSunParams(body.e, body.c);
  if (!sunParams) return jsonError("유효하지 않은 태그 URL입니다.");
  const sun = verifySun(sunParams.e, sunParams.c);
  if (!sun.ok) {
    return jsonError(sun.status === 503 ? sun.error : "유효하지 않은 태그 URL입니다.", sun.status);
  }
  const context = await store.getSunAdminContext(sun.uid);
  return jsonOk(
    { uid: sun.uid, ctr: sun.ctr, ...context },
    { headers: { "Cache-Control": "no-store" } },
  );
}
