import { clearAdminCookie, configGuard, jsonOk } from "@/lib/auth";

export async function POST() {
  // 변경: 운영 설정 오류(비밀 값 누락·기본값)면 쿠키를 읽거나 쓰지 않고 503
  const configError = configGuard();
  if (configError) return configError;
  await clearAdminCookie();
  return jsonOk({ ok: true });
}
