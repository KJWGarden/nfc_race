import { configGuard, isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  // 변경: 운영 설정 오류(비밀 값 누락·기본값)면 쿠키를 읽거나 쓰지 않고 503
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id } = await params;
  const live = await store.getAdminLive(id);
  if (!live) return jsonError("세션을 찾을 수 없습니다.", 404);
  return jsonOk(live);
}

export async function PATCH(request: Request, { params }: Ctx) {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id } = await params;
  const body = (await request.json()) as {
    name?: string;
    description?: string;
    checkpointCount?: number;
    awardRanks?: number;
    status?: "draft" | "ready" | "live" | "finished";
    allowStaticUrl?: unknown;
  };
  // 변경: 고정 URL 허용 스위치는 boolean 값만 받고 그 외 값은 무시한다
  const { allowStaticUrl, ...rest } = body;
  const session = await store.updateSession(id, {
    ...rest,
    allowStaticUrl: typeof allowStaticUrl === "boolean" ? allowStaticUrl : undefined,
  });
  if (!session) return jsonError("세션을 찾을 수 없습니다.", 404);
  return jsonOk(session);
}

export async function DELETE(_: Request, { params }: Ctx) {
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id } = await params;
  const ok = await store.deleteSession(id);
  if (!ok) return jsonError("세션을 찾을 수 없습니다.", 404);
  return jsonOk({ deleted: true });
}
