import { configGuard, isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

type Ctx = { params: Promise<{ libraryId: string; tagId: string }> };

// 기능: 태그 목록에서 연결 하나 해제 (고정 URL: 지점 연결, SUN: 지점의 UID·기준값). 연결돼 있지 않으면 detached=false
export async function DELETE(_request: Request, { params }: Ctx) {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { libraryId, tagId } = await params;
  const result = await store.detachLibraryBinding(libraryId, tagId);
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk(result.value);
}
