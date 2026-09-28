import {
  checkAdminPassword,
  clientIp,
  configGuard,
  jsonError,
  jsonOk,
  setAdminCookie,
} from "@/lib/auth";
import { store } from "@/lib/db";

export async function POST(request: Request) {
  // 변경: 운영 설정 오류(비밀 값 누락·기본값)면 쿠키 없이 503
  const configError = configGuard();
  if (configError) return configError;
  const body = (await request.json()) as { password?: unknown };

  // 기능: 비밀번호 확인 전에 시도를 센다. 잠긴 IP 는 비밀번호와 상관없이 남은 시간과 함께 429
  const ip = clientIp(request);
  const attempt = await store.adminLoginAttempt(ip);
  if (!attempt.allowed) {
    const minutes = Math.max(1, Math.ceil(attempt.retryAfterSec / 60));
    return Response.json(
      { ok: false, error: `로그인 시도가 너무 많습니다. 약 ${minutes}분 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSec) } },
    );
  }

  if (!checkAdminPassword(body.password)) {
    return jsonError("비밀번호가 올바르지 않습니다.", 401);
  }
  // 기능: 로그인 성공 시 이 IP 의 실패 기록을 지운다
  await store.clearAdminLoginAttempts(ip);
  await setAdminCookie();
  return jsonOk({ ok: true });
}
