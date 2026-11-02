import { configGuard, isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

type Ctx = { params: Promise<{ libraryId: string }> };

// 기능: 목록 태그 삭제. SUN 은 언제든, 고정 URL 은 지점에 연결되지 않았을 때만
export async function DELETE(_request: Request, { params }: Ctx) {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { libraryId } = await params;
  const result = await store.deleteLibraryEntry(libraryId);
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk({ id: libraryId });
}
