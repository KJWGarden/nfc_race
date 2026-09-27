import "server-only";
import { createHmac } from "crypto";

const TOKEN_TTL_SECONDS = 60 * 60;

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

// 기능: 관리자 전용 Realtime JWT(HS256) 발급. cp_role=admin 클레임만 realtime.messages 정책을 통과한다.
export function mintAdminRealtimeToken(): { token: string; expiresAt: number } {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("SUPABASE_JWT_SECRET 환경 변수가 설정되지 않았습니다.");
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      role: "authenticated",
      aud: "authenticated",
      sub: "checkpoint-admin",
      cp_role: "admin",
      iat,
      exp,
    }),
  );
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return { token: `${header}.${payload}.${signature}`, expiresAt: exp * 1000 };
}
