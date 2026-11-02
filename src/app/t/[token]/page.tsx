import { getParticipantId, isAdmin } from "@/lib/auth";
import { store } from "@/lib/db";
import { STATIC_TOKEN_PATTERN, toSunParams } from "@/lib/nfc";
import type { StaticTagInfo, StaticTokenInfo } from "@/lib/types";
import { AdminStaticView } from "./admin-static-view";
import { AdminSunPanel } from "./admin-sun-panel";
import { ParticipantStaticLanding, ParticipantTagLanding } from "./participant-landing";

// 변경: 고정 토큰 조회 (목록 고정 URL 토큰 또는 지점 자동 토큰). 공유 목록 스키마 전이면 기존 단일 지점 조회,
// DB 오류면 null 로 두어 기존 화면을 보여 준다
async function lookupStaticToken(token: string): Promise<StaticTokenInfo | StaticTagInfo | null> {
  try {
    return await store.resolveStaticToken(token);
  } catch {
    return null;
  }
}

// 기능: 서명이 확인된 참가자 쿠키의 세션 id (쿠키 없음·참가자 없음·오류면 null)
async function participantSessionId(): Promise<string | null> {
  try {
    const pid = await getParticipantId();
    if (!pid) return null;
    return (await store.getParticipant(pid))?.sessionId ?? null;
  } catch {
    return null;
  }
}

// 기능: 참가자 제출 화면을 보여 줄지 결정한다.
// 목록 토큰: 참가자 세션에 연결된 지점이 있고 그 세션 스위치가 켜졌을 때 (쿠키가 없으면 연결된 세션 중 하나라도 켜졌을 때, 기록 여부는 참가 후 서버가 판단).
// 목록 태그가 연결된 지점의 자동 토큰: 인정되지 않으므로 보여 주지 않는다. 그 밖의 지점 토큰: 토큰 지점 세션의 스위치.
async function showStaticLanding(info: StaticTokenInfo | StaticTagInfo | null): Promise<boolean> {
  if (!info) return false;
  if (!("kind" in info)) return info.allowStaticUrl;
  if (info.kind === "checkpoint") return !info.attached && info.allowStaticUrl;
  const sessionId = await participantSessionId();
  if (sessionId) return info.bindings.some((b) => b.sessionId === sessionId && b.allowStaticUrl);
  return info.bindings.some((b) => b.allowStaticUrl);
}

// 변경: 서버 컴포넌트에서 관리자 쿠키(HMAC)를 확인해 관리자 모드와 참가자 태깅 화면 중 하나만 렌더링한다.
// 관리자 모드에서는 참가자 제출 코드가 아예 마운트되지 않으므로 참가자 태깅·pendingTag 저장이 일어날 수 없다.
// 변경: SUN 파라미터가 없는 고정 URL 은 showStaticLanding 규칙을 만족할 때만 참가자 제출 화면을 렌더링한다.
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
  const info = await lookupStaticToken(token);
  if (admin) return <AdminStaticView info={info} />;
  // 기능: 참가자 화면에는 URL 에 이미 있는 토큰만 넘긴다 (지점·세션·목록 이름 없음)
  if (await showStaticLanding(info)) return <ParticipantStaticLanding token={token.toLowerCase()} />;
  return <ParticipantTagLanding e="" c="" />;
}
