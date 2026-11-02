import { configGuard, isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

type Ctx = { params: Promise<{ libraryId: string }> };

// 변경: 고정 URL 태그를 모든 세션·지점에서 연결 해제한다. SUN 태그는 400
export async function POST(_request: Request, { params }: Ctx) {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { libraryId } = await params;
  const result = await store.releaseLibrary(libraryId);
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk(result.value);
}
