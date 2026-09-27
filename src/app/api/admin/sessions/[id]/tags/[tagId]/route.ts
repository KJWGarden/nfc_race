import { isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

type Ctx = { params: Promise<{ id: string; tagId: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id, tagId } = await params;
  const body = (await request.json()) as {
    name?: string;
    hint?: string;
    nextHint?: string;
    locationNote?: string;
    order?: number;
  };
  // 변경: UID 는 SUN 등록 API(/sun)로만 바꿀 수 있다. 본문에 uid 가 와도 전달하지 않는다.
  const tag = await store.updateTag(id, tagId, {
    name: body.name,
    hint: body.hint,
    nextHint: body.nextHint,
    locationNote: body.locationNote,
    order: body.order,
  });
  if (!tag) return jsonError("태그를 찾을 수 없습니다.", 404);
  return jsonOk(tag);
}

export async function DELETE(_: Request, { params }: Ctx) {
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id, tagId } = await params;
  const ok = await store.deleteTag(id, tagId);
  if (!ok) return jsonError("태그를 찾을 수 없습니다.", 404);
  return jsonOk({ deleted: true });
}
