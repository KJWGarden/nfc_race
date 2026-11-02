export type SessionStatus = "draft" | "ready" | "live" | "finished";

export interface Session {
  id: string;
  name: string;
  description: string;
  code: string;
  status: SessionStatus;
  checkpointCount: number;
  awardRanks: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  // 기능: 이 세션에서 고정 URL(QR·일반 NFC) 태깅을 허용하는지 (기본 꺼짐)
  allowStaticUrl: boolean;
}

export interface NfcTag {
  id: string;
  sessionId: string;
  token: string;
  uid: string;
  name: string;
  order: number;
  hint: string;
  nextHint: string;
  locationNote: string;
  createdAt: string;
  // 변경: SUN 기준 카운터와 갱신 시각 (미등록·기준 미설정이면 null)
  baselineCounter: number | null;
  baselineAt: string | null;
  // 기능: 이 지점에 연결된 고정 URL 목록 태그 id (관리자 전용, 참가자 응답에는 담지 않는다)
  libraryId: string | null;
}

export interface Team {
  id: string;
  sessionId: string;
  name: string;
  joinCode: string;
  leaderId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Participant {
  id: string;
  sessionId: string;
  teamId: string | null;
  name: string;
  isLeader: boolean;
  createdAt: string;
}

export interface TagEvent {
  id: string;
  sessionId: string;
  teamId: string;
  participantId: string;
  tagId: string;
  taggedAt: string;
  valid: boolean;
  reason: string;
}

export interface Announcement {
  id: string;
  sessionId: string;
  message: string;
  createdAt: string;
  pinned: boolean;
}

export interface DbShape {
  sessions: Session[];
  tags: NfcTag[];
  teams: Team[];
  participants: Participant[];
  events: TagEvent[];
  announcements: Announcement[];
}

export interface RankedTeam {
  rank: number;
  teamId: string;
  teamName: string;
  memberCount: number;
  members: { id: string; name: string; isLeader: boolean }[];
  progress: number;
  required: number;
  finished: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  lastTaggedAt: string | null;
  taggedTagIds: string[];
}

export interface TeamRaceView {
  participant: Participant;
  session: Pick<
    Session,
    "id" | "name" | "status" | "checkpointCount" | "description" | "allowStaticUrl"
  >;
  team: Team | null;
  members: Participant[];
  tags: Pick<NfcTag, "id" | "name" | "order">[];
  taggedTagIds: string[];
  nextTag: Pick<NfcTag, "id" | "name" | "order" | "hint" | "nextHint" | "locationNote"> | null;
  lastValidEvent: TagEvent | null;
  announcement: Announcement | null;
  elapsedMs: number | null;
  finished: boolean;
  required: number;
}

export interface AdminLiveView {
  session: Session;
  tags: NfcTag[];
  teams: Team[];
  participants: Participant[];
  events: TagEvent[];
  announcements: Announcement[];
  rankings: RankedTeam[];
}

// 기능: 고정 URL(/t/{token}) 화면 분기용 지점·세션 정보. 서버 컴포넌트에서만 읽고 토큰은 담지 않는다.
export interface StaticTagInfo {
  tagName: string;
  order: number;
  sessionId: string;
  sessionName: string;
  sessionStatus: SessionStatus;
  allowStaticUrl: boolean;
}

// 기능: /t 화면 분기용 고정 토큰 조회 결과 (서버 컴포넌트 전용). 목록 고정 URL 토큰 또는 지점 자동 토큰.
export type StaticTokenInfo =
  | {
      kind: "library";
      name: string;
      bindings: {
        sessionId: string;
        sessionName: string;
        sessionStatus: SessionStatus;
        allowStaticUrl: boolean;
        tagId: string;
        tagName: string;
        order: number;
      }[];
    }
  | ({ kind: "checkpoint"; attached: boolean; libraryName: string | null } & StaticTagInfo);

// 기능: 관리자 모드(/t) SUN 조회 결과. UID·카운터·기준값만 담고 키는 담지 않는다.
export interface SunAdminContext {
  uid: string;
  ctr: number;
  bindings: {
    sessionId: string;
    sessionName: string;
    sessionStatus: SessionStatus;
    tagId: string;
    tagName: string;
    order: number;
    baselineCtr: number | null;
    baselineAt: string | null;
  }[];
  sessions: {
    id: string;
    name: string;
    status: SessionStatus;
    tags: { id: string; name: string; order: number; uid: string; baselineCtr: number | null }[];
  }[];
  // 변경: 태그 목록 항목 (목록에 없으면 null, 구버전 서버 응답이면 undefined)
  library?: LibraryEntryRef | null;
}

// 기능: 태그 목록(관리자 전용). 참가자 응답에는 절대 담지 않는다.
// 변경: SUN(UID 로 묶인 지점)과 고정 URL(library_id 로 연결된 지점) 모두 같은 연결 형태를 쓴다
export interface LibraryBinding {
  sessionId: string;
  sessionName: string;
  sessionStatus: SessionStatus;
  allowStaticUrl: boolean;
  tagId: string;
  tagName: string;
  order: number;
  // SUN 지점의 기준 카운터 (고정 URL 은 null)
  baselineCtr: number | null;
}

export interface LibraryEntry {
  id: string;
  kind: "sun" | "static";
  name: string;
  uid: string | null;
  counter: number | null;
  counterAt: string | null;
  token: string | null;
  createdAt: string;
  // 변경: 이 태그가 연결된 모든 세션·지점 (여러 세션에서 동시에 사용)
  bindings: LibraryBinding[];
}

export interface LibraryList {
  available: boolean;
  entries: LibraryEntry[];
}

// 기능: 관리자 모드(/t) 조회 응답에 붙는 목록 항목 요약
export interface LibraryEntryRef {
  id: string;
  name: string;
  counter: number;
}
