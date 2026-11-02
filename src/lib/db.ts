import type { PostgrestError } from "@supabase/supabase-js";
import type {
  AdminLiveView,
  Announcement,
  LibraryEntry,
  LibraryEntryRef,
  LibraryList,
  NfcTag,
  Participant,
  Session,
  SessionStatus,
  StaticTagInfo,
  StaticTokenInfo,
  SunAdminContext,
  TagEvent,
  Team,
  TeamRaceView,
} from "./types";
import { createId, createSessionCode, createTagToken, createTeamCode } from "./ids";
import { buildTeamRaceView, computeRankings, orderedTags } from "./race";
import { getSupabase } from "./supabase-server";

// 변경: 로컬 JSON 파일 저장소를 Supabase(Postgres)로 교체. store 메서드 계약은 그대로 유지한다.
// 변경: 관리자 화면 변경 신호는 DB 트리거(notify_admin_change)가 보내므로 앱 측 publish 호출은 없다.

type Row = Record<string, unknown>;

// 기능: PostgREST timestamptz(마이크로초, +00:00)를 기존과 같은 toISOString 형식으로 맞춘다
function iso(value: unknown): string {
  return new Date(value as string).toISOString();
}

function isoOrNull(value: unknown): string | null {
  return value == null ? null : iso(value);
}

function toSession(r: Row): Session {
  return {
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    code: r.code as string,
    status: r.status as SessionStatus,
    checkpointCount: r.checkpoint_count as number,
    awardRanks: r.award_ranks as number,
    createdAt: iso(r.created_at),
    startedAt: isoOrNull(r.started_at),
    finishedAt: isoOrNull(r.finished_at),
    // 변경: 마이그레이션 적용 전(컬럼 없음)에도 꺼짐으로 읽는다
    allowStaticUrl: r.allow_static_url === true,
  };
}

function toTag(r: Row): NfcTag {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    token: r.token as string,
    uid: r.uid as string,
    name: r.name as string,
    order: r.position as number,
    hint: r.hint as string,
    nextHint: r.next_hint as string,
    locationNote: r.location_note as string,
    createdAt: iso(r.created_at),
    baselineCounter: (r.baseline_ctr as number | null | undefined) ?? null,
    baselineAt: isoOrNull(r.baseline_at),
    // 기능: 마이그레이션 적용 전(컬럼 없음)에는 null
    libraryId: (r.library_id as string | null | undefined) ?? null,
  };
}

// 변경: 태깅 성공 응답에는 참가자 화면이 쓰는 필드만 담는다 (토큰·UID·기준값 제외)
type TagSummary = Pick<NfcTag, "id" | "name" | "order" | "nextHint">;

function toTagSummary(r: Row): TagSummary {
  const tag = toTag(r);
  return { id: tag.id, name: tag.name, order: tag.order, nextHint: tag.nextHint };
}

function toTeam(r: Row): Team {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    name: r.name as string,
    joinCode: r.join_code as string,
    leaderId: r.leader_id as string,
    createdAt: iso(r.created_at),
    startedAt: isoOrNull(r.started_at),
    finishedAt: isoOrNull(r.finished_at),
  };
}

function toParticipant(r: Row): Participant {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    teamId: (r.team_id as string | null) ?? null,
    name: r.name as string,
    isLeader: r.is_leader as boolean,
    createdAt: iso(r.created_at),
  };
}

// 기능: 미등록 태그 이벤트의 tag_id null 을 기존 계약인 "" 로 변환
function toEvent(r: Row): TagEvent {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    teamId: r.team_id as string,
    participantId: r.participant_id as string,
    tagId: (r.tag_id as string | null) ?? "",
    taggedAt: iso(r.tagged_at),
    valid: r.valid as boolean,
    reason: r.reason as string,
  };
}

function toAnnouncement(r: Row): Announcement {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    message: r.message as string,
    createdAt: iso(r.created_at),
    pinned: r.pinned as boolean,
  };
}

function rows(value: unknown): Row[] {
  return (value as Row[] | null) ?? [];
}

// 기능: Supabase 오류는 route handler 에서 500 으로 드러나도록 예외로 올린다
function check<T>(result: { data: T; error: PostgrestError | null }): T {
  if (result.error) {
    throw new Error(`Supabase 오류: ${result.error.message} (${result.error.code})`);
  }
  return result.data;
}

const UNIQUE_VIOLATION = "23505";
const MAX_CODE_ATTEMPTS = 5;
// PostgREST 스키마 캐시에 없는 함수(PGRST202) / Postgres 에 없는 함수(42883)
const FUNCTION_NOT_FOUND = ["PGRST202", "42883"];
// 기능: 태그 목록 마이그레이션 적용 전에는 함수(PGRST202/42883)나 테이블(PGRST205/42P01)이 없다
const LIBRARY_UNAVAILABLE = [...FUNCTION_NOT_FOUND, "PGRST205", "42P01"];
const LIBRARY_UNAVAILABLE_ERROR = "태그 목록 기능을 사용하려면 DB 업데이트가 필요합니다.";

// 기능: 태그 목록 작업 결과. 실패는 라우트가 그대로 HTTP 응답으로 바꾼다
export type LibraryFailure = { ok: false; status: number; error: string; needsConfirm: boolean };
export type LibraryResult<T> = { ok: true; value: T } | LibraryFailure;

const LIBRARY_UNAVAILABLE_RESULT: LibraryFailure = {
  ok: false,
  status: 503,
  error: LIBRARY_UNAVAILABLE_ERROR,
  needsConfirm: false,
};

// 기능: 목록 RPC 호출. DB 업데이트 전이면 unavailable, 함수가 {ok:false} 를 돌려주면 실패 결과로 변환한다
async function libraryRpc(
  fn: string,
  args?: Record<string, unknown>,
): Promise<{ unavailable: true } | { unavailable: false; data: Row | null }> {
  const result = await getSupabase().rpc(fn, args);
  if (result.error && LIBRARY_UNAVAILABLE.includes(result.error.code)) {
    return { unavailable: true };
  }
  return { unavailable: false, data: check(result) as Row | null };
}

function toLibraryFailure(data: Row): LibraryFailure {
  return {
    ok: false,
    status: data.status as number,
    error: data.error as string,
    needsConfirm: data.needsConfirm === true,
  };
}

// 기능: get_library / upsert 결과 jsonb 를 LibraryEntry 로 변환 (타임스탬프는 iso 형식으로 정규화)
function toLibraryEntry(r: Row): LibraryEntry {
  return {
    id: r.id as string,
    kind: r.kind as "sun" | "static",
    name: r.name as string,
    uid: (r.uid as string | null) ?? null,
    counter: (r.counter as number | null) ?? null,
    counterAt: isoOrNull(r.counterAt),
    token: (r.token as string | null) ?? null,
    createdAt: iso(r.createdAt),
    // 변경: SUN·고정 URL 모두 연결된 지점 목록 하나로 읽는다
    bindings: rows(r.bindings).map((b) => ({
      sessionId: b.sessionId as string,
      sessionName: b.sessionName as string,
      sessionStatus: b.sessionStatus as SessionStatus,
      allowStaticUrl: b.allowStaticUrl === true,
      tagId: b.tagId as string,
      tagName: b.tagName as string,
      order: b.order as number,
      baselineCtr: (b.baselineCtr as number | null) ?? null,
    })),
  };
}

// 기능: 공유 태그 목록 마이그레이션(20261102100000) 적용 여부. 성공했을 때만 프로세스 안에서 기억한다
let sharedLibraryReady = false;

async function requireSharedLibrary(): Promise<LibraryFailure | null> {
  if (sharedLibraryReady) return null;
  const result = await libraryRpc("shared_library_schema");
  if (result.unavailable) return LIBRARY_UNAVAILABLE_RESULT;
  sharedLibraryReady = true;
  return null;
}

function toTeamRaceView(data: Row | null): TeamRaceView | null {
  if (!data) return null;
  const participant = toParticipant(data.participant as Row);
  const session = toSession(data.session as Row);
  const team = data.team ? toTeam(data.team as Row) : null;
  const announcement =
    rows(data.announcements)
      .map(toAnnouncement)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  return buildTeamRaceView({
    participant,
    session,
    team,
    members: rows(data.members).map(toParticipant),
    tags: rows(data.tags).map(toTag),
    events: rows(data.events).map(toEvent),
    announcement,
  });
}

function toAdminLiveView(data: Row | null): AdminLiveView | null {
  if (!data) return null;
  const session = toSession(data.session as Row);
  const tags = orderedTags(session.id, rows(data.tags).map(toTag));
  const teams = rows(data.teams).map(toTeam);
  const participants = rows(data.participants).map(toParticipant);
  const events = rows(data.events).map(toEvent);
  const announcements = rows(data.announcements)
    .map(toAnnouncement)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    session,
    tags,
    teams,
    participants,
    events,
    announcements,
    rankings: computeRankings(session, teams, participants, tags, events),
  };
}

async function findSessionById(id: string): Promise<Session | null> {
  const data = check(await getSupabase().from("sessions").select("*").eq("id", id).maybeSingle());
  return data ? toSession(data) : null;
}

async function findSessionByCode(code: string): Promise<Session | null> {
  const normalized = code.trim().toUpperCase();
  const data = check(
    await getSupabase().from("sessions").select("*").eq("code", normalized).maybeSingle(),
  );
  return data ? toSession(data) : null;
}

type RecordTagResult =
  | { ok: false; error: string; event?: TagEvent; view?: TeamRaceView | null }
  | { ok: true; event: TagEvent; view: TeamRaceView | null; tag: TagSummary };

// 기능: record_sun_tag / record_static_tag 의 공통 jsonb 결과를 RecordTagResult 로 변환
function toRecordTagResult(data: Row): RecordTagResult {
  if (!data.event) return { ok: false, error: data.error as string };
  const event = toEvent(data.event as Row);
  if (!data.race) return { ok: false, error: data.error as string, event };
  const view = toTeamRaceView(data.race as Row);
  if (!data.ok) return { ok: false, error: data.error as string, event, view };
  return { ok: true, event, view, tag: toTagSummary(data.tag as Row) };
}

export const store = {
  async listSessions(): Promise<Session[]> {
    const data = check(
      await getSupabase()
        .from("sessions")
        .select("*")
        .order("created_at", { ascending: false })
        .order("seq", { ascending: true }),
    );
    return rows(data).map(toSession);
  },

  getSession(id: string) {
    return findSessionById(id);
  },

  getSessionByCode(code: string) {
    return findSessionByCode(code);
  },

  async createSession(input: {
    name: string;
    description: string;
    checkpointCount: number;
    awardRanks: number;
  }): Promise<Session> {
    // 기능: 세션 코드가 겹치면(unique 위반) 새 코드로 재시도
    for (let attempt = 0; ; attempt++) {
      const result = await getSupabase()
        .from("sessions")
        .insert({
          id: createId(),
          name: input.name.trim(),
          description: input.description.trim(),
          code: createSessionCode(),
          status: "draft",
          checkpoint_count: Math.max(1, Math.floor(input.checkpointCount)),
          award_ranks: Math.max(1, Math.floor(input.awardRanks)),
        })
        .select("*")
        .single();
      if (result.error?.code === UNIQUE_VIOLATION && attempt + 1 < MAX_CODE_ATTEMPTS) continue;
      const session = toSession(check(result));
      return session;
    }
  },

  async updateSession(
    id: string,
    patch: Partial<
      Pick<
        Session,
        "name" | "description" | "checkpointCount" | "awardRanks" | "status" | "allowStaticUrl"
      >
    >,
  ): Promise<Session | null> {
    const current = await findSessionById(id);
    if (!current) return null;
    const update: Row = {};
    if (patch.name != null) update.name = patch.name.trim();
    if (patch.description != null) update.description = patch.description.trim();
    if (patch.checkpointCount != null) {
      update.checkpoint_count = Math.max(1, Math.floor(patch.checkpointCount));
    }
    if (patch.awardRanks != null) {
      update.award_ranks = Math.max(1, Math.floor(patch.awardRanks));
    }
    // 기능: 고정 URL 허용 스위치는 boolean 일 때만 반영
    if (typeof patch.allowStaticUrl === "boolean") update.allow_static_url = patch.allowStaticUrl;
        // 기능: 상태 전환 시 시작/종료 시각 규칙은 기존과 동일
    if (patch.status != null) {
      const at = new Date().toISOString();
      update.status = patch.status;
      if (patch.status === "live" && !current.startedAt) update.started_at = at;
      if (patch.status === "finished") update.finished_at = at;
      if (patch.status === "ready" || patch.status === "draft") update.finished_at = null;
    }
    let session = current;
    if (Object.keys(update).length > 0) {
      const data = check(
        await getSupabase().from("sessions").update(update).eq("id", id).select("*").maybeSingle(),
      );
      if (!data) return null;
      session = toSession(data);
    }
    return session;
  },

  // 기능: 하위 행(지점·팀·참가자·기록·공지)은 FK on delete cascade 로 함께 삭제된다
  async deleteSession(id: string): Promise<boolean> {
    const data = check(await getSupabase().from("sessions").delete().eq("id", id).select("id"));
    if (rows(data).length === 0) return false;
    return true;
  },

  async listTags(sessionId: string): Promise<NfcTag[]> {
    const data = check(
      await getSupabase()
        .from("tags")
        .select("*")
        .eq("session_id", sessionId)
        .order("seq", { ascending: true }),
    );
    return orderedTags(sessionId, rows(data).map(toTag));
  },

  async createTag(
    sessionId: string,
    input: {
      name: string;
      hint: string;
      nextHint: string;
      locationNote: string;
      order?: number;
    },
  ): Promise<NfcTag | null> {
    // 기능: 순서 계산·checkpoint_count 보정은 create_tag 함수 안에서 원자적으로 처리, 토큰 충돌 시 재시도
    for (let attempt = 0; ; attempt++) {
      const data = check(
        await getSupabase().rpc("create_tag", {
          p_session_id: sessionId,
          p_id: createId(),
          p_token: createTagToken(),
          // 변경: UID 는 SUN 등록(registerTagSun)으로만 묶는다
          p_uid: "",
          p_name: input.name,
          p_position: input.order == null ? null : Math.floor(input.order),
          p_hint: input.hint,
          p_next_hint: input.nextHint,
          p_location_note: input.locationNote,
        }),
      ) as Row | null;
      if (!data) return null;
      if (data.retry) {
        if (attempt + 1 < MAX_CODE_ATTEMPTS) continue;
        throw new Error("태그 토큰 생성에 실패했습니다.");
      }
      return toTag(data);
    }
  },

  async updateTag(
    sessionId: string,
    tagId: string,
    patch: Partial<Pick<NfcTag, "name" | "hint" | "nextHint" | "locationNote" | "order">>,
  ): Promise<NfcTag | null> {
    const update: Row = {};
    if (patch.name != null) update.name = patch.name.trim();
    if (patch.hint != null) update.hint = patch.hint.trim();
    if (patch.nextHint != null) update.next_hint = patch.nextHint.trim();
    if (patch.locationNote != null) update.location_note = patch.locationNote.trim();
    if (patch.order != null) update.position = Math.max(1, Math.floor(patch.order));
    const table = getSupabase().from("tags");
    const query =
      Object.keys(update).length > 0 ? table.update(update).select("*") : table.select("*");
    const data = check(await query.eq("id", tagId).eq("session_id", sessionId).maybeSingle());
    if (!data) return null;
    return toTag(data);
  },

  // 기능: 해당 지점의 태깅 기록은 FK cascade 로 함께 삭제된다
  async deleteTag(sessionId: string, tagId: string): Promise<boolean> {
    const data = check(
      await getSupabase()
        .from("tags")
        .delete()
        .eq("id", tagId)
        .eq("session_id", sessionId)
        .select("id"),
    );
    if (rows(data).length === 0) return false;
    return true;
  },

  async joinSession(code: string, name: string) {
    const session = await findSessionByCode(code);
    if (!session) return { ok: false as const, error: "세션 코드를 찾을 수 없습니다." };
    if (session.status === "finished") {
      return { ok: false as const, error: "이미 종료된 세션입니다." };
    }
    const data = check(
      await getSupabase()
        .from("participants")
        .insert({
          id: createId(),
          session_id: session.id,
          team_id: null,
          name: name.trim(),
          is_leader: false,
        })
        .select("*")
        .single(),
    );
    const participant = toParticipant(data);
    return { ok: true as const, participant, session };
  },

  // 기능: 세션 코드 + 팀 코드 + 정규화 이름으로 기존 참가자를 찾는다 (이름 비교는 DB normalize_name 하나로만)
  async findRejoinParticipant(
    code: string,
    joinCode: string,
    name: string,
  ): Promise<{ ok: true; participantId: string } | { ok: false; reason: "not_found" | "ambiguous" }> {
    const data = check(
      await getSupabase().rpc("rejoin_lookup", { p_code: code, p_join_code: joinCode, p_name: name }),
    ) as Row;
    if (typeof data.participantId === "string") return { ok: true, participantId: data.participantId };
    return { ok: false, reason: data.error === "ambiguous" ? "ambiguous" : "not_found" };
  },

  async getParticipant(id: string): Promise<Participant | null> {
    const data = check(
      await getSupabase().from("participants").select("*").eq("id", id).maybeSingle(),
    );
    return data ? toParticipant(data) : null;
  },

  async createTeam(participantId: string, teamName: string) {
    // 기능: 팀 생성+참가자 소속을 create_team 함수에서 원자적으로 처리, 팀 코드 충돌 시 재시도
    for (let attempt = 0; ; attempt++) {
      const data = check(
        await getSupabase().rpc("create_team", {
          p_participant_id: participantId,
          p_team_id: createId(),
          p_name: teamName,
          p_join_code: createTeamCode(),
        }),
      ) as Row;
      if (data.retry) {
        if (attempt + 1 < MAX_CODE_ATTEMPTS) continue;
        throw new Error("팀 코드 생성에 실패했습니다.");
      }
      if (!data.ok) return { ok: false as const, error: data.error as string };
      const team = toTeam(data.team as Row);
      const participant = toParticipant(data.participant as Row);
      return { ok: true as const, team, participant };
    }
  },

  async joinTeam(participantId: string, joinCode: string) {
    const data = check(
      await getSupabase().rpc("join_team", {
        p_participant_id: participantId,
        p_join_code: joinCode,
      }),
    ) as Row;
    if (!data.ok) return { ok: false as const, error: data.error as string };
    const team = toTeam(data.team as Row);
    const participant = toParticipant(data.participant as Row);
    return { ok: true as const, team, participant };
  },

  async listOpenTeams(sessionId: string) {
    const data = check(
      await getSupabase()
        .from("teams")
        .select("id, name, join_code, participants(count)")
        .eq("session_id", sessionId)
        .order("seq", { ascending: true }),
    );
    return rows(data).map((team) => ({
      id: team.id as string,
      name: team.name as string,
      joinCode: team.join_code as string,
      memberCount: (rows(team.participants)[0]?.count as number | undefined) ?? 0,
    }));
  },

  async createAnnouncement(sessionId: string, message: string): Promise<Announcement | null> {
    const data = check(
      await getSupabase().rpc("create_announcement", {
        p_session_id: sessionId,
        p_id: createId(),
        p_message: message,
      }),
    ) as Row | null;
    if (!data) return null;
    return toAnnouncement(data);
  },

  // 변경: 정적 토큰·UID 만으로 기록하는 recordTag 는 제거됨. 태깅은 SUN 검증을 거친 recordSunTag 로만 기록한다.
  // 기능: 서버에서 검증된 SUN UID·카운터로 카운터 소비·기준값 확인·경주 규칙·기록을 record_sun_tag 한 트랜잭션에서 처리
  async recordSunTag(input: { participantId: string; uid: string; ctr: number }): Promise<RecordTagResult> {
    const data = check(
      await getSupabase().rpc("record_sun_tag", {
        p_participant_id: input.participantId,
        p_uid: input.uid,
        p_ctr: input.ctr,
        p_event_id: createId(),
      }),
    ) as Row;
    return toRecordTagResult(data);
  },

  // 기능: 고정 URL 토큰 태깅. 스위치 확인·팀 잠금·경주 규칙·기록을 record_static_tag 한 트랜잭션에서 처리
  async recordStaticTag(input: { participantId: string; token: string }): Promise<RecordTagResult> {
    const result = await getSupabase().rpc("record_static_tag", {
      p_participant_id: input.participantId,
      p_token: input.token,
      p_event_id: createId(),
    });
    // 기능: 마이그레이션 적용 전(함수 없음)에는 기존과 같은 400 응답을 유지한다
    if (result.error && FUNCTION_NOT_FOUND.includes(result.error.code)) {
      return { ok: false, error: "태그 정보가 없습니다." };
    }
    return toRecordTagResult(check(result) as Row);
  },

  // 기능: 고정 URL 토큰으로 지점과 그 세션의 스위치 상태를 읽는다 (읽기 전용, /t 서버 컴포넌트 전용)
  async getStaticTagInfo(token: string): Promise<StaticTagInfo | null> {
    const data = check(
      await getSupabase()
        .from("tags")
        .select("name,position,session_id,sessions(name,status,allow_static_url)")
        .eq("token", token.toLowerCase())
        .maybeSingle(),
    ) as Row | null;
    const session = data?.sessions as Row | null | undefined;
    if (!data || !session) return null;
    return {
      tagName: data.name as string,
      order: data.position as number,
      sessionId: data.session_id as string,
      sessionName: session.name as string,
      sessionStatus: session.status as SessionStatus,
      allowStaticUrl: session.allow_static_url === true,
    };
  },

  // 기능: 검증된 SUN 읽기로 지점에 태그를 묶고 기준 카운터를 설정 (register_tag_sun 한 트랜잭션)
  async registerTagSun(input: {
    sessionId: string;
    tagId: string;
    uid: string;
    ctr: number;
    replace: boolean;
  }): Promise<
    | { ok: true; tag: NfcTag }
    | { ok: false; status: number; error: string; needsConfirm: boolean }
  > {
    const data = check(
      await getSupabase().rpc("register_tag_sun", {
        p_session_id: input.sessionId,
        p_tag_id: input.tagId,
        p_uid: input.uid,
        p_ctr: input.ctr,
        p_replace: input.replace,
      }),
    ) as Row;
    if (!data.ok) {
      return {
        ok: false,
        status: data.status as number,
        error: data.error as string,
        needsConfirm: data.needsConfirm === true,
      };
    }
    return { ok: true, tag: toTag(data.tag as Row) };
  },

  // 기능: 관리자 모드(/t) 조회. UID 가 묶인 지점들과 등록 가능한 종료 전 세션·지점 목록
  async getSunAdminContext(uid: string): Promise<Omit<SunAdminContext, "uid" | "ctr">> {
    const data = check(
      await getSupabase().rpc("get_sun_admin_context", { p_uid: uid }),
    ) as Row;
    return {
      bindings: rows(data.bindings).map((b) => ({
        sessionId: b.sessionId as string,
        sessionName: b.sessionName as string,
        sessionStatus: b.sessionStatus as SessionStatus,
        tagId: b.tagId as string,
        tagName: b.tagName as string,
        order: b.order as number,
        baselineCtr: (b.baselineCtr as number | null) ?? null,
        baselineAt: isoOrNull(b.baselineAt),
      })),
      sessions: rows(data.sessions).map((x) => ({
        id: x.id as string,
        name: x.name as string,
        status: x.status as SessionStatus,
        tags: rows(x.tags).map((t) => ({
          id: t.id as string,
          name: t.name as string,
          order: t.order as number,
          uid: t.uid as string,
          baselineCtr: (t.baselineCtr as number | null) ?? null,
        })),
      })),
    };
  },

  // 기능: 태그 목록 전체와 현재 연결 상태. DB 업데이트 전이면 available=false 의 빈 목록
  async listLibrary(): Promise<LibraryList> {
    // 변경: 공유 목록 스키마가 아니면(구 스키마 포함) 목록 기능을 끈다
    if (await requireSharedLibrary()) return { available: false, entries: [] };
    const result = await libraryRpc("get_library");
    if (result.unavailable) return { available: false, entries: [] };
    return { available: true, entries: rows(result.data?.entries).map(toLibraryEntry) };
  },

  // 기능: 검증된 SUN 읽기(uid, ctr)와 이름으로 목록에 등록한다. 같은 UID 면 이름·카운터(최댓값)만 갱신
  async registerLibrarySun(input: {
    uid: string;
    ctr: number;
    name: string;
  }): Promise<LibraryResult<LibraryEntry>> {
    // 변경: 모든 목록 쓰기는 공유 목록 스키마 확인 후에만 실행한다 (구 스키마면 503)
    const unavailable = await requireSharedLibrary();
    if (unavailable) return unavailable;
    const result = await libraryRpc("upsert_library_sun", {
      p_id: createId(),
      p_uid: input.uid,
      p_ctr: input.ctr,
      p_name: input.name,
      p_rename: true,
    });
    if (result.unavailable) return LIBRARY_UNAVAILABLE_RESULT;
    return { ok: true, value: toLibraryEntry(result.data as Row) };
  },

  // 기능: 이름으로 고정 URL 태그를 발급한다 (새 토큰, 충돌 시 재시도)
  async issueLibraryStatic(name: string): Promise<LibraryResult<LibraryEntry>> {
    const unavailable = await requireSharedLibrary();
    if (unavailable) return unavailable;
    for (let attempt = 0; ; attempt++) {
      const result = await libraryRpc("issue_library_static", {
        p_id: createId(),
        p_name: name,
        p_token: createTagToken(),
      });
      if (result.unavailable) return LIBRARY_UNAVAILABLE_RESULT;
      const data = result.data as Row;
      if (data.retry) {
        if (attempt + 1 < MAX_CODE_ATTEMPTS) continue;
        throw new Error("태그 토큰 생성에 실패했습니다.");
      }
      return { ok: true, value: toLibraryEntry(data) };
    }
  },

  // 기능: 목록 태그 삭제 (SUN 은 언제든, 고정 URL 은 어느 지점에도 연결되지 않았을 때만)
  async deleteLibraryEntry(libraryId: string): Promise<LibraryResult<null>> {
    const unavailable = await requireSharedLibrary();
    if (unavailable) return unavailable;
    const result = await libraryRpc("delete_library_entry", { p_library_id: libraryId });
    if (result.unavailable) return LIBRARY_UNAVAILABLE_RESULT;
    const data = result.data as Row;
    return data.ok ? { ok: true, value: null } : toLibraryFailure(data);
  },

  // 변경: 목록 태그를 지점에 연결 (SUN 은 register_tag_sun 규칙, 고정 URL 은 library_id 연결). 종류는 DB 함수가 구분한다
  async matchLibrary(input: {
    sessionId: string;
    tagId: string;
    libraryId: string;
    replace: boolean;
  }): Promise<LibraryResult<NfcTag>> {
    const unavailable = await requireSharedLibrary();
    if (unavailable) return unavailable;
    const result = await libraryRpc("match_library", {
      p_session_id: input.sessionId,
      p_tag_id: input.tagId,
      p_library_id: input.libraryId,
      p_replace: input.replace,
    });
    if (result.unavailable) return LIBRARY_UNAVAILABLE_RESULT;
    const data = result.data as Row;
    return data.ok ? { ok: true, value: toTag(data.tag as Row) } : toLibraryFailure(data);
  },

  // 변경: 고정 URL 태그를 모든 세션·지점에서 연결 해제. 연결이 없었으면 released=false
  async releaseLibrary(libraryId: string): Promise<LibraryResult<{ released: boolean; count: number }>> {
    const unavailable = await requireSharedLibrary();
    if (unavailable) return unavailable;
    const result = await libraryRpc("release_library_static", { p_library_id: libraryId });
    if (result.unavailable) return LIBRARY_UNAVAILABLE_RESULT;
    const data = result.data as Row;
    if (!data.ok) return toLibraryFailure(data);
    return { ok: true, value: { released: data.released === true, count: (data.count as number) ?? 0 } };
  },

  // 기능: 지점 하나의 고정 URL 목록 태그 연결 해제 (다른 세션·지점 연결은 그대로)
  async detachLibraryTag(
    sessionId: string,
    tagId: string,
  ): Promise<LibraryResult<{ detached: boolean; tag: NfcTag }>> {
    const unavailable = await requireSharedLibrary();
    if (unavailable) return unavailable;
    const result = await libraryRpc("detach_library_tag", { p_session_id: sessionId, p_tag_id: tagId });
    if (result.unavailable) return LIBRARY_UNAVAILABLE_RESULT;
    const data = result.data as Row;
    if (!data.ok) return toLibraryFailure(data);
    return { ok: true, value: { detached: data.detached === true, tag: toTag(data.tag as Row) } };
  },

  // 기능: 목록 태그로 지점을 만들어 경로 끝에 붙이고 연결 (한 트랜잭션, 토큰·id 충돌 시 재시도)
  async addTagFromLibrary(
    sessionId: string,
    input: { libraryId: string; hint: string; nextHint: string; locationNote: string },
  ): Promise<LibraryResult<NfcTag>> {
    const unavailable = await requireSharedLibrary();
    if (unavailable) return unavailable;
    for (let attempt = 0; ; attempt++) {
      const result = await libraryRpc("add_tag_from_library", {
        p_session_id: sessionId,
        p_id: createId(),
        p_token: createTagToken(),
        p_library_id: input.libraryId,
        p_hint: input.hint,
        p_next_hint: input.nextHint,
        p_location_note: input.locationNote,
      });
      if (result.unavailable) return LIBRARY_UNAVAILABLE_RESULT;
      const data = result.data as Row;
      if (data.retry) {
        if (attempt + 1 < MAX_CODE_ATTEMPTS) continue;
        throw new Error("태그 토큰 생성에 실패했습니다.");
      }
      return data.ok ? { ok: true, value: toTag(data.tag as Row) } : toLibraryFailure(data);
    }
  },

  // 기능: 세션 경로 순서 변경. 현재 지점 id 전체를 새 순서대로 받는다
  async reorderTags(sessionId: string, tagIds: string[]): Promise<LibraryResult<null>> {
    const unavailable = await requireSharedLibrary();
    if (unavailable) return unavailable;
    const result = await libraryRpc("reorder_session_tags", { p_session_id: sessionId, p_tag_ids: tagIds });
    if (result.unavailable) return LIBRARY_UNAVAILABLE_RESULT;
    const data = result.data as Row;
    return data.ok ? { ok: true, value: null } : toLibraryFailure(data);
  },

  // 기능: /t 화면 분기용 고정 토큰 조회. 공유 목록 스키마가 아니면 기존 단일 지점 조회로 대신한다
  async resolveStaticToken(token: string): Promise<StaticTokenInfo | StaticTagInfo | null> {
    const result = await libraryRpc("resolve_static_token", { p_token: token });
    if (result.unavailable) return store.getStaticTagInfo(token);
    const data = result.data;
    if (!data) return null;
    if (data.kind === "library") {
      return {
        kind: "library",
        name: data.name as string,
        bindings: rows(data.bindings).map((b) => ({
          sessionId: b.sessionId as string,
          sessionName: b.sessionName as string,
          sessionStatus: b.sessionStatus as SessionStatus,
          allowStaticUrl: b.allowStaticUrl === true,
          tagId: b.tagId as string,
          tagName: b.tagName as string,
          order: b.order as number,
        })),
      };
    }
    return {
      kind: "checkpoint",
      tagName: data.tagName as string,
      order: data.order as number,
      sessionId: data.sessionId as string,
      sessionName: data.sessionName as string,
      sessionStatus: data.sessionStatus as SessionStatus,
      allowStaticUrl: data.allowStaticUrl === true,
      attached: data.attached === true,
      libraryName: (data.libraryName as string | null) ?? null,
    };
  },

  // 기능: 직접 등록 성공 뒤 목록에 추가·갱신한다. 실패해도 등록 응답에 영향이 없도록 절대 던지지 않는다
  async autoAddLibrarySun(input: { uid: string; ctr: number; name: string }): Promise<void> {
    try {
      // 변경: 공유 목록 스키마가 아니면 목록 쓰기 없이 건너뛴다
      if (await requireSharedLibrary()) return;
      await libraryRpc("upsert_library_sun", {
        p_id: createId(),
        p_uid: input.uid,
        p_ctr: input.ctr,
        p_name: input.name,
        p_rename: false,
      });
    } catch (error) {
      console.error("태그 목록 자동 추가 실패", error instanceof Error ? error.message : error);
    }
  },

  // 기능: 관리자 모드(/t) 조회용. UID 가 목록에 있으면 요약을, 없거나 DB 업데이트 전이면 null
  async getLibraryEntryByUid(uid: string): Promise<LibraryEntryRef | null> {
    const result = await libraryRpc("get_library_entry_by_uid", { p_uid: uid });
    if (result.unavailable || !result.data) return null;
    return {
      id: result.data.id as string,
      name: result.data.name as string,
      counter: result.data.counter as number,
    };
  },

  // 기능: 관리자 로그인 시도를 비밀번호 확인 전에 DB 에서 원자적으로 센다 (IP 별 15분 창, 5회 초과 시 잠금)
  async adminLoginAttempt(
    ip: string,
  ): Promise<{ allowed: true } | { allowed: false; retryAfterSec: number }> {
    const data = check(await getSupabase().rpc("admin_login_attempt", { p_ip: ip })) as Row;
    if (data.allowed === true) return { allowed: true };
    return { allowed: false, retryAfterSec: data.retryAfterSec as number };
  },

  async clearAdminLoginAttempts(ip: string): Promise<void> {
    check(await getSupabase().rpc("admin_login_success", { p_ip: ip }));
  },

  async getTeamRace(participantId: string): Promise<TeamRaceView | null> {
    const data = check(
      await getSupabase().rpc("get_team_race_data", { p_participant_id: participantId }),
    ) as Row | null;
    return toTeamRaceView(data);
  },

  async getAdminLive(sessionId: string): Promise<AdminLiveView | null> {
    const data = check(
      await getSupabase().rpc("get_admin_live_data", { p_session_id: sessionId }),
    ) as Row | null;
    return toAdminLiveView(data);
  },
};
