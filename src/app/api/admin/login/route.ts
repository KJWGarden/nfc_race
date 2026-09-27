import { adminPassword, jsonError, jsonOk, setAdminCookie } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json()) as { password?: string };
  if (!body.password || body.password !== adminPassword()) {
    return jsonError("비밀번호가 올바르지 않습니다.", 401);
  }
  await setAdminCookie();
  return jsonOk({ ok: true });
}
