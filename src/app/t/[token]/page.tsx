import { isAdmin } from "@/lib/auth";
import { AdminSunPanel } from "./admin-sun-panel";
import { ParticipantTagLanding } from "./participant-landing";

// 변경: 서버 컴포넌트에서 관리자 쿠키(HMAC)를 확인해 관리자 모드와 참가자 태깅 화면 중 하나만 렌더링한다.
// 관리자 모드에서는 참가자 제출 코드가 아예 마운트되지 않으므로 참가자 태깅·pendingTag 저장이 일어날 수 없다.
export default async function TagLandingPage({
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const e = typeof query.e === "string" ? query.e : "";
  const c = typeof query.c === "string" ? query.c : "";
  if (await isAdmin()) {
    return <AdminSunPanel e={e} c={c} />;
  }
  return <ParticipantTagLanding e={e} c={c} />;
}
