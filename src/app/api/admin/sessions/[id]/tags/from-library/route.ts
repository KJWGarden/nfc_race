import { configGuard, isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

// 기능: 목록 태그로 지점을 만들어 경로 끝에 붙이고 연결한다 (준비 중·대기 세션만, 이름은 목록 태그 이름)
export async function POST(request: Request, { params }: Ctx) {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    libraryId?: unknown;
    hint?: unknown;
    nextHint?: unknown;
    locationNote?: unknown;
  };
  if (typeof body.libraryId !== "string" || !body.libraryId) {
    return jsonError("연결할 태그를 선택해 주세요.");
  }
  // 기능: 안내 문구는 문자열만 받는다 (없으면 빈 값)
  const text = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : null);
  const hint = text(body.hint);
  const nextHint = text(body.nextHint);
  const locationNote = text(body.locationNote);
  if (hint === null || nextHint === null || locationNote === null) {
    return jsonError("안내 문구가 올바르지 않습니다.");
  }
  const result = await store.addTagFromLibrary(id, {
    libraryId: body.libraryId,
    hint,
    nextHint,
    locationNote,
  });
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error, needsConfirm: result.needsConfirm },
      { status: result.status },
    );
  }
  return jsonOk(result.value);
}
