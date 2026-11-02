import { configGuard, isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

type Ctx = { params: Promise<{ libraryId: string }> };

// 변경: 목록 태그 삭제. 연결된 지점을 모두 해제한 뒤 삭제하고 해제한 수(detached)를 돌려준다
export async function DELETE(_request: Request, { params }: Ctx) {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { libraryId } = await params;
  const result = await store.deleteLibraryEntry(libraryId);
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk({ id: libraryId, detached: result.value.detached });
}
