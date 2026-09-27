import { isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

export async function GET() {
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  return jsonOk(await store.listSessions());
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const body = (await request.json()) as {
    name?: string;
    description?: string;
    checkpointCount?: number;
    awardRanks?: number;
  };
  if (!body.name?.trim()) return jsonError("세션 이름을 입력해 주세요.");
  const session = await store.createSession({
    name: body.name,
    description: body.description ?? "",
    checkpointCount: body.checkpointCount ?? 4,
    awardRanks: body.awardRanks ?? 3,
  });
  return jsonOk(session);
}
