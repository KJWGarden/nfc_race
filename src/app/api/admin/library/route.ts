import { configGuard, isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";
import { parseSunUrl, toSunParams } from "@/lib/nfc";
import { verifySun } from "@/lib/sun-keys";

// 기능: 태그 목록과 현재 연결 상태 (DB 업데이트 전이면 available=false)
export async function GET() {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  return jsonOk(await store.listLibrary(), { headers: { "Cache-Control": "no-store" } });
}

// 기능: 목록에 태그 등록. SUN 은 검증된 읽기(url 또는 e, c)와 이름, 고정 URL 은 이름만 받아 새 토큰을 발급한다
export async function POST(request: Request) {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const body = (await request.json().catch(() => ({}))) as {
    kind?: unknown;
    name?: unknown;
    url?: unknown;
    e?: unknown;
    c?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("태그 이름을 입력해 주세요.");

  if (body.kind === "static") {
    const result = await store.issueLibraryStatic(name);
    if (!result.ok) return jsonError(result.error, result.status);
    return jsonOk(result.value);
  }
  if (body.kind !== "sun") return jsonError("태그 종류가 올바르지 않습니다.");

  const sunParams =
    typeof body.url === "string" ? parseSunUrl(body.url) : toSunParams(body.e, body.c);
  if (!sunParams) return jsonError("유효하지 않은 태그 URL입니다.");
  const sun = verifySun(sunParams.e, sunParams.c);
  if (!sun.ok) {
    return jsonError(sun.status === 503 ? sun.error : "유효하지 않은 태그 URL입니다.", sun.status);
  }
  const result = await store.registerLibrarySun({ uid: sun.uid, ctr: sun.ctr, name });
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk(result.value);
}
