import { configGuard, isAdmin, jsonError, jsonOk } from "@/lib/auth";
import { mintAdminRealtimeToken } from "@/lib/realtime-jwt";

// 기능: 관리자 쿠키를 확인한 뒤에만 Realtime 구독용 단기 토큰을 발급
export async function GET() {
  // 변경: 운영 설정 오류(비밀 값 누락·기본값)면 쿠키를 읽거나 쓰지 않고 503
  const configError = configGuard();
  if (configError) return configError;
  if (!(await isAdmin())) return jsonError("관리자 권한이 필요합니다.", 401);
  return jsonOk(mintAdminRealtimeToken(), { headers: { "Cache-Control": "no-store" } });
}
