import { configGuard, isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  // 변경: 운영 설정 오류(비밀 값 누락·기본값)면 쿠키를 읽거나 쓰지 않고 503
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id } = await params;
  return jsonOk(await store.listTags(id));
}

export async function POST(request: Request, { params }: Ctx) {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id } = await params;
  const body = (await request.json()) as {
    name?: string;
    hint?: string;
    nextHint?: string;
    locationNote?: string;
    order?: number;
  };
  if (!body.name?.trim()) return jsonError("지점 이름을 입력해 주세요.");
  const tag = await store.createTag(id, {
    name: body.name,
    hint: body.hint ?? "",
    nextHint: body.nextHint ?? "",
    locationNote: body.locationNote ?? "",
    order: body.order,
  });
  if (!tag) return jsonError("세션을 찾을 수 없습니다.", 404);
  return jsonOk(tag);
}
