import { isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";
import { parseSunUrl, toSunParams } from "@/lib/nfc";
import { verifySun } from "@/lib/sun-keys";

type Ctx = { params: Promise<{ id: string; tagId: string }> };

// 기능: 태그에서 읽은 SUN URL(또는 e, c)로 지점에 물리 태그를 등록하거나 기준 카운터를 갱신한다
export async function POST(request: Request, { params }: Ctx) {
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id, tagId } = await params;
  const body = (await request.json()) as { url?: unknown; e?: unknown; c?: unknown; replace?: unknown };
  const sunParams =
    typeof body.url === "string" ? parseSunUrl(body.url) : toSunParams(body.e, body.c);
  if (!sunParams) return jsonError("유효하지 않은 태그 URL입니다.");
  const sun = verifySun(sunParams.e, sunParams.c);
  if (!sun.ok) {
    return jsonError(sun.status === 503 ? sun.error : "유효하지 않은 태그 URL입니다.", sun.status);
  }
  const result = await store.registerTagSun({
    sessionId: id,
    tagId,
    uid: sun.uid,
    ctr: sun.ctr,
    replace: body.replace === true,
  });
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error, needsConfirm: result.needsConfirm },
      { status: result.status },
    );
  }
  return jsonOk(result.tag);
}
