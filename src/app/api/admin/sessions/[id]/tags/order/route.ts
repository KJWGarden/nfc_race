import { configGuard, isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

// 기능: 세션 경로 순서 변경. 현재 지점 id 전체를 새 순서대로 받는다 (준비 중·대기 세션만)
export async function PUT(request: Request, { params }: Ctx) {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { tagIds?: unknown };
  if (!Array.isArray(body.tagIds) || !body.tagIds.every((tagId) => typeof tagId === "string")) {
    return jsonError("지점 순서가 올바르지 않습니다.");
  }
  const result = await store.reorderTags(id, body.tagIds as string[]);
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error, needsConfirm: result.needsConfirm },
      { status: result.status },
    );
  }
  return jsonOk({ tagIds: body.tagIds });
}
