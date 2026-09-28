import { isAdmin } from "@/lib/auth";
import { store } from "@/lib/db";
import { STATIC_TOKEN_PATTERN, toSunParams } from "@/lib/nfc";
import type { StaticTagInfo } from "@/lib/types";
import { AdminStaticView } from "./admin-static-view";
import { AdminSunPanel } from "./admin-sun-panel";
import { ParticipantStaticLanding, ParticipantTagLanding } from "./participant-landing";

// 기능: 고정 URL 토큰 조회. 마이그레이션 미적용·DB 오류면 null 로 두어 기존 화면을 보여 준다
async function lookupStaticTag(token: string): Promise<StaticTagInfo | null> {
  try {
    return await store.getStaticTagInfo(token);
  } catch {
    return null;
  }
}

// 변경: 서버 컴포넌트에서 관리자 쿠키(HMAC)를 확인해 관리자 모드와 참가자 태깅 화면 중 하나만 렌더링한다.
// 관리자 모드에서는 참가자 제출 코드가 아예 마운트되지 않으므로 참가자 태깅·pendingTag 저장이 일어날 수 없다.
// 변경: SUN 파라미터가 없는 고정 URL 은 토큰 지점 세션의 스위치가 켜져 있을 때만 참가자 제출 화면을 렌더링한다.
export default async function TagLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const e = typeof query.e === "string" ? query.e : "";
  const c = typeof query.c === "string" ? query.c : "";
  const admin = await isAdmin();
  if (toSunParams(e, c) || !STATIC_TOKEN_PATTERN.test(token)) {
    return admin ? <AdminSunPanel e={e} c={c} /> : <ParticipantTagLanding e={e} c={c} />;
  }
  const info = await lookupStaticTag(token);
  if (admin) return <AdminStaticView info={info} />;
  // 기능: 참가자 화면에는 URL 에 이미 있는 토큰만 넘긴다 (지점·세션 이름 없음)
  if (info?.allowStaticUrl) return <ParticipantStaticLanding token={token.toLowerCase()} />;
  return <ParticipantTagLanding e="" c="" />;
}
