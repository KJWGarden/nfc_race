import { configGuard, isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

type Ctx = { params: Promise<{ id: string; tagId: string }> };

// 변경: 목록 태그를 지점에 연결한다. SUN 은 목록의 UID·카운터로 등록 규칙을, 고정 URL 은 지점별 연결(세션당 한 번, 다른 태그 교체 확인)을 적용한다
export async function POST(request: Request, { params }: Ctx) {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id, tagId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    libraryId?: unknown;
    replace?: unknown;
  };
  if (typeof body.libraryId !== "string" || !body.libraryId) {
    return jsonError("연결할 태그를 선택해 주세요.");
  }
  const result = await store.matchLibrary({
    sessionId: id,
    tagId,
    libraryId: body.libraryId,
    replace: body.replace === true,
  });
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error, needsConfirm: result.needsConfirm },
      { status: result.status },
    );
  }
  return jsonOk(result.value);
}

// 기능: 이 지점의 고정 URL 목록 태그 연결만 해제한다 (다른 세션·지점 연결은 그대로)
export async function DELETE(_request: Request, { params }: Ctx) {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id, tagId } = await params;
  const result = await store.detachLibraryTag(id, tagId);
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk(result.value);
}
