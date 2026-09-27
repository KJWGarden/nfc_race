import { isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id } = await params;
  const live = await store.getAdminLive(id);
  if (!live) return jsonError("세션을 찾을 수 없습니다.", 404);
  return jsonOk(live);
}

export async function PATCH(request: Request, { params }: Ctx) {
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id } = await params;
  const body = (await request.json()) as {
    name?: string;
    description?: string;
    checkpointCount?: number;
    awardRanks?: number;
    status?: "draft" | "ready" | "live" | "finished";
  };
  const session = await store.updateSession(id, body);
  if (!session) return jsonError("세션을 찾을 수 없습니다.", 404);
  return jsonOk(session);
}

export async function DELETE(_: Request, { params }: Ctx) {
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id } = await params;
  const ok = await store.deleteSession(id);
  if (!ok) return jsonError("세션을 찾을 수 없습니다.", 404);
  return jsonOk({ deleted: true });
}
