import { configGuard, isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { store } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  // 변경: 운영 설정 오류(비밀 값 누락·기본값)면 쿠키를 읽거나 쓰지 않고 503
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  const { id } = await params;
  const body = (await request.json()) as { message?: string };
  if (!body.message?.trim()) return jsonError("공지 내용을 입력해 주세요.");
  const announcement = await store.createAnnouncement(id, body.message);
  if (!announcement) return jsonError("세션을 찾을 수 없습니다.", 404);
  return jsonOk(announcement);
}
