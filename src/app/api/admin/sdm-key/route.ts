import { isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { fileReadKeyFor, SUN_CONFIG_ERROR } from "@/lib/sun-keys";

// 기능: UID 별 SDM 파일 읽기 키 조회 (관리자 전용, 캐시 금지). 태그를 NXP 도구로 설정할 때 입력하는 값이다.
export async function GET(request: Request) {
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const uid = (new URL(request.url).searchParams.get("uid") ?? "").trim().toUpperCase();
  if (!/^[0-9A-F]{14}$/.test(uid)) return jsonError("UID는 14자리 16진수여야 합니다.");
  const fileReadKey = fileReadKeyFor(uid);
  if (!fileReadKey) return jsonError(SUN_CONFIG_ERROR, 503);
  return jsonOk({ uid, fileReadKey }, { headers: { "Cache-Control": "no-store" } });
}
