import type { PostgrestError } from "@supabase/supabase-js";
import type {
  AdminLiveView,
  Announcement,
  NfcTag,
  Participant,
  Session,
  SessionStatus,
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

// 기능: record_tag / record_sun_tag 의 공통 jsonb 결과를 RecordTagResult 로 변환
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
        "name" | "description" | "checkpointCount" | "awardRanks" | "status"
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
