import type {
  Announcement,
  NfcTag,
  Participant,
  RankedTeam,
  Session,
  TagEvent,
  Team,
  TeamRaceView,
} from "./types";

export function requiredCheckpoints(session: Session, tags: NfcTag[]): number {
  const sessionTags = tags
    .filter((t) => t.sessionId === session.id)
    .sort((a, b) => a.order - b.order);
  if (sessionTags.length === 0) return session.checkpointCount;
  return Math.min(session.checkpointCount, sessionTags.length) || sessionTags.length;
}

export function orderedTags(sessionId: string, tags: NfcTag[]): NfcTag[] {
  return tags
    .filter((t) => t.sessionId === sessionId)
    .sort((a, b) => a.order - b.order);
}

export function validTagIdsForTeam(teamId: string, events: TagEvent[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const list = events
    .filter((e) => e.teamId === teamId && e.valid)
    .sort((a, b) => a.taggedAt.localeCompare(b.taggedAt));
  for (const event of list) {
    if (seen.has(event.tagId)) continue;
    seen.add(event.tagId);
    ids.push(event.tagId);
  }
  return ids;
}

export function computeRankings(
  session: Session,
  teams: Team[],
  participants: Participant[],
  tags: NfcTag[],
  events: TagEvent[],
): RankedTeam[] {
  const required = requiredCheckpoints(session, tags);
  const sessionTeams = teams.filter((t) => t.sessionId === session.id);

  const rows = sessionTeams.map((team) => {
    const members = participants
      .filter((p) => p.teamId === team.id)
      .map((p) => ({ id: p.id, name: p.name, isLeader: p.isLeader }));
    const taggedTagIds = validTagIdsForTeam(team.id, events);
    const finished = Boolean(team.finishedAt) || taggedTagIds.length >= required;
    const durationMs =
      team.startedAt && team.finishedAt
        ? new Date(team.finishedAt).getTime() - new Date(team.startedAt).getTime()
        : null;
    const lastTaggedAt =
      events
        .filter((e) => e.teamId === team.id && e.valid)
        .sort((a, b) => b.taggedAt.localeCompare(a.taggedAt))[0]?.taggedAt ?? null;

    return {
      teamId: team.id,
      teamName: team.name,
      memberCount: members.length,
      members,
      progress: taggedTagIds.length,
      required,
      finished,
      startedAt: team.startedAt,
      finishedAt: team.finishedAt,
      durationMs,
      lastTaggedAt,
      taggedTagIds,
    };
  });

  rows.sort((a, b) => {
    if (a.finished && b.finished) {
      return (a.durationMs ?? Infinity) - (b.durationMs ?? Infinity);
    }
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.progress !== b.progress) return b.progress - a.progress;
    return (a.lastTaggedAt ?? "").localeCompare(b.lastTaggedAt ?? "");
  });

  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function findTagByPayload(
  tags: NfcTag[],
  sessionId: string,
  payload: { token?: string; uid?: string },
): NfcTag | undefined {
  const sessionTags = tags.filter((t) => t.sessionId === sessionId);
  const token = payload.token?.trim().toLowerCase();
  const uid = payload.uid?.trim().toLowerCase();
  if (token) {
    const byToken = sessionTags.find((t) => t.token.toLowerCase() === token);
    if (byToken) return byToken;
  }
  if (uid) {
    const byUid = sessionTags.find((t) => t.uid && t.uid.toLowerCase() === uid);
    if (byUid) return byUid;
  }
  return undefined;
}

export function validateTagAttempt(input: {
  session: Session;
  team: Team;
  tag: NfcTag;
  tags: NfcTag[];
  events: TagEvent[];
}): { valid: true } | { valid: false; reason: string } {
  if (input.session.status !== "live") {
    return { valid: false, reason: "세션이 진행 중이 아닙니다. 관리자 시작을 기다려 주세요." };
  }
  if (input.tag.sessionId !== input.session.id) {
    return { valid: false, reason: "이 세션에 등록되지 않은 태그입니다." };
  }

  const sequence = orderedTags(input.session.id, input.tags);
  if (sequence.length === 0) {
    return { valid: false, reason: "등록된 NFC 지점이 없습니다." };
  }

  const tagged = new Set(validTagIdsForTeam(input.team.id, input.events));
  if (tagged.has(input.tag.id)) {
    return { valid: false, reason: "이미 태깅한 지점입니다." };
  }

  const required = requiredCheckpoints(input.session, input.tags);
  if (tagged.size >= required) {
    return { valid: false, reason: "이미 완주했습니다." };
  }

  const next = sequence.find((t) => !tagged.has(t.id));
  if (!next) {
    return { valid: false, reason: "이미 완주했습니다." };
  }
  if (next.id !== input.tag.id) {
    return { valid: false, reason: `순서가 아닙니다. 다음 지점은 "${next.name}" 입니다.` };
  }

  return { valid: true };
}

export function buildTeamRaceView(input: {
  participant: Participant;
  session: Session;
  team: Team | null;
  members: Participant[];
  tags: NfcTag[];
  events: TagEvent[];
  announcement: Announcement | null;
}): TeamRaceView {
  const sequence = orderedTags(input.session.id, input.tags);
  const required = requiredCheckpoints(input.session, input.tags);
  const taggedTagIds = input.team ? validTagIdsForTeam(input.team.id, input.events) : [];
  const tagged = new Set(taggedTagIds);
  const nextTag = sequence.find((t) => !tagged.has(t.id)) ?? null;
  const lastValidEvent =
    input.team
      ? input.events
          .filter((e) => e.teamId === input.team!.id && e.valid)
          .sort((a, b) => b.taggedAt.localeCompare(a.taggedAt))[0] ?? null
      : null;
  const finished = Boolean(input.team?.finishedAt) || taggedTagIds.length >= required;
  const elapsedMs =
    input.team?.startedAt
      ? (input.team.finishedAt ? new Date(input.team.finishedAt).getTime() : Date.now()) -
        new Date(input.team.startedAt).getTime()
      : null;

  return {
    participant: input.participant,
    session: {
      id: input.session.id,
      name: input.session.name,
      status: input.session.status,
      checkpointCount: input.session.checkpointCount,
      description: input.session.description,
    },
    team: input.team,
    members: input.members,
    tags: sequence.map((t) => ({ id: t.id, name: t.name, order: t.order })),
    taggedTagIds,
    nextTag: nextTag
      ? {
          id: nextTag.id,
          name: nextTag.name,
          order: nextTag.order,
          hint: nextTag.hint,
          nextHint: nextTag.nextHint,
          locationNote: nextTag.locationNote,
        }
      : null,
    lastValidEvent,
    announcement: input.announcement,
    elapsedMs,
    finished,
    required,
  };
}
