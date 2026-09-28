// AC5 / AC6 / AC7 API-level checks against http://localhost:3000 + local Supabase (psql).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = "http://localhost:3000";
const DB = "postgresql://postgres:postgres@127.0.0.1:55422/postgres";
const env = readFileSync("/Users/kimgarden/dev/nfc-walk-race/.env.local", "utf8");
const ADMIN_PASSWORD = /^ADMIN_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() ?? "admin123";
const N = 20;

let failures = 0;
function log(...a) { console.log(...a); }
function assert(cond, label, detail = "") {
  if (!cond) failures++;
  log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
}
function psql(sql) {
  return execFileSync("psql", [DB, "-Atc", sql], { encoding: "utf8" }).trim();
}

class Client {
  constructor() { this.cookies = new Map(); }
  async req(path, { method = "GET", body } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }
}

const admin = new Client();
const login = await admin.req("/api/admin/login", { method: "POST", body: { password: ADMIN_PASSWORD } });
assert(login.status === 200, "admin login", `HTTP ${login.status}`);

// session + 3 tags (checkpointCount 2 -> must be raised to 3 by create_tag)
const created = await admin.req("/api/admin/sessions", {
  method: "POST",
  body: { name: "AC 검증 세션", description: "api-check", checkpointCount: 2, awardRanks: 3 },
});
const session = created.json.data;
assert(/^[0-9A-Z]{6}$/.test(session.code) && session.status === "draft", "createSession shape", JSON.stringify(session));
const tags = [];
for (const name of ["A 출발", "B 중간", "C 완주"]) {
  const r = await admin.req(`/api/admin/sessions/${session.id}/tags`, {
    method: "POST",
    body: { name, hint: `${name} 힌트`, nextHint: "", locationNote: "" },
  });
  tags.push(r.json.data);
}
assert(tags.map((t) => t.order).join(",") === "1,2,3", "createTag default order last+1", tags.map((t) => t.order).join(","));
const listed = await admin.req(`/api/admin/sessions/${session.id}/tags`);
assert(listed.json.data.length === 3, "listTags returns 3");
let live = await admin.req(`/api/admin/sessions/${session.id}`);
assert(live.json.data.session.checkpointCount === 3, "createTag raises checkpointCount to tag count", String(live.json.data.session.checkpointCount));

// throwaway tag: updateTag + deleteTag
const extra = (await admin.req(`/api/admin/sessions/${session.id}/tags`, {
  method: "POST", body: { name: "임시", hint: "", nextHint: "", locationNote: "", uid: " 04AABB " },
})).json.data;
assert(extra.uid === "04AABB" && extra.order === 4, "createTag trims uid, order 4", JSON.stringify({ uid: extra.uid, order: extra.order }));
const upd = await admin.req(`/api/admin/sessions/${session.id}/tags/${extra.id}`, { method: "PATCH", body: { name: " 임시2 ", order: 9.7 } });
assert(upd.json.data.name === "임시2" && upd.json.data.order === 9, "updateTag trims name, floors order", JSON.stringify(upd.json.data));
const del = await admin.req(`/api/admin/sessions/${session.id}/tags/${extra.id}`, { method: "DELETE" });
assert(del.status === 200, "deleteTag ok");
const del2 = await admin.req(`/api/admin/sessions/${session.id}/tags/${extra.id}`, { method: "DELETE" });
assert(del2.status === 404, "deleteTag missing -> 404");
// checkpointCount was raised to 4 by the extra tag; set it back to 3 (admin PATCH)
await admin.req(`/api/admin/sessions/${session.id}`, { method: "PATCH", body: { checkpointCount: 3 } });

// participants: leader + N-1 members
const members = [];
for (let i = 0; i < N; i++) {
  const c = new Client();
  const j = await c.req("/api/join", { method: "POST", body: { code: session.code.toLowerCase(), name: `참가자${i + 1}` } });
  if (j.status !== 200) throw new Error(`join failed ${JSON.stringify(j.json)}`);
  members.push(c);
}
const team = (await members[0].req("/api/teams", { method: "POST", body: { name: "동시성팀" } })).json.data.team;
assert(/^[0-9A-Z]{4}$/.test(team.joinCode), "createTeam join code", team.joinCode);
const again = await members[0].req("/api/teams", { method: "POST", body: { name: "또" } });
assert(again.json.error === "이미 팀에 속해 있습니다.", "createTeam twice -> 이미 팀에 속해 있습니다.", again.json.error);
const badJoin = await members[1].req("/api/teams/join", { method: "POST", body: { joinCode: "ZZZZ" } });
assert(badJoin.json.error === "팀 코드를 찾을 수 없습니다.", "joinTeam bad code", badJoin.json.error);
for (const m of members.slice(1)) {
  const r = await m.req("/api/teams/join", { method: "POST", body: { joinCode: team.joinCode.toLowerCase() } });
  if (r.status !== 200) throw new Error(`team join failed ${JSON.stringify(r.json)}`);
}
const me0 = (await members[0].req("/api/me")).json.data;
assert(me0.members.length === N, `team has ${N} members`, String(me0.members.length));

// AC6: not live
const notLive = await members[0].req("/api/tag", { method: "POST", body: { token: tags[0].token } });
assert(notLive.json.error === "세션이 진행 중이 아닙니다. 관리자 시작을 기다려 주세요.", "AC6 not-live error", notLive.json.error);

const goLive = await admin.req(`/api/admin/sessions/${session.id}`, { method: "PATCH", body: { status: "live" } });
assert(goLive.json.data.status === "live" && goLive.json.data.startedAt, "updateSession live sets startedAt");

// AC5: N simultaneous POST /api/tag for checkpoint 1 from N members
async function burst(token, label) {
  const results = await Promise.all(members.map((m) => m.req("/api/tag", { method: "POST", body: { token } })));
  const ok = results.filter((r) => r.status === 200).length;
  const errors = {};
  for (const r of results.filter((r) => r.status !== 200)) errors[`${r.status} ${r.json?.error}`] = (errors[`${r.status} ${r.json?.error}`] ?? 0) + 1;
  log(`${label}: ${N} concurrent requests -> ${ok} x HTTP 200, errors ${JSON.stringify(errors)}`);
  return { ok, errors };
}
const b1 = await burst(tags[0].token, "burst #1 (checkpoint A)");
const dbValid1 = psql(`select count(*) from tag_events where team_id='${team.id}' and tag_id='${tags[0].id}' and valid`);
const dbAll1 = psql(`select count(*) from tag_events where team_id='${team.id}' and tag_id='${tags[0].id}'`);
log(`DB: tag_events team=${team.id} tag=A valid=${dbValid1} total=${dbAll1}`);
// total = N burst events + 1 invalid event from the earlier not-live attempt on the same tag
assert(b1.ok === 1 && dbValid1 === "1" && dbAll1 === String(N + 1), "AC5 burst #1 exactly one valid event", `valid=${dbValid1} total=${dbAll1} (expected total ${N + 1})`);
let me = (await members[5].req("/api/me")).json.data;
assert(me.taggedTagIds.length === 1 && me.taggedTagIds[0] === tags[0].id, "AC5 progress advanced by exactly 1", JSON.stringify(me.taggedTagIds));

// AC6: duplicate, out of order, unknown
const dup = await members[3].req("/api/tag", { method: "POST", body: { token: tags[0].token } });
assert(dup.json.error === "이미 태깅한 지점입니다.", "AC6 duplicate error", dup.json.error);
const ooo = await members[3].req("/api/tag", { method: "POST", body: { token: tags[2].token } });
assert(ooo.json.error === '순서가 아닙니다. 다음 지점은 "B 중간" 입니다.', "AC6 out-of-order error", ooo.json.error);
const unknown = await members[3].req("/api/tag", { method: "POST", body: { token: "nope-token" } });
assert(unknown.json.error === "등록되지 않은 NFC 태그입니다.", "unknown tag error", unknown.json.error);
const unknownRow = psql(`select coalesce(tag_id,'<null>') || '|' || valid from tag_events where team_id='${team.id}' and reason='등록되지 않은 NFC 태그입니다.'`);
assert(unknownRow === "<null>|false", "unknown tag event stored with tag_id null", unknownRow);
const adminEvents = (await admin.req(`/api/admin/sessions/${session.id}`)).json.data.events;
assert(adminEvents.some((e) => e.tagId === "" && !e.valid), "unknown tag event mapped to tagId \"\"");

// second burst on checkpoint B (case-insensitive token)
const b2 = await burst(tags[1].token.toUpperCase(), "burst #2 (checkpoint B, uppercased token)");
const dbValid2 = psql(`select count(*) from tag_events where team_id='${team.id}' and tag_id='${tags[1].id}' and valid`);
log(`DB: tag_events team=${team.id} tag=B valid=${dbValid2}`);
assert(b2.ok === 1 && dbValid2 === "1", "AC5 burst #2 exactly one valid event");

// finish with checkpoint C via a burst too
const b3 = await burst(tags[2].token, "burst #3 (checkpoint C, final)");
const teamRow = psql(`select started_at is not null, finished_at is not null, (select count(*) from tag_events where team_id='${team.id}' and valid) from teams where id='${team.id}'`);
log(`DB: team started,finished,valid_events = ${teamRow}`);
assert(b3.ok === 1 && teamRow === "t|t|3", "AC6 last checkpoint sets finishedAt (exactly 3 valid events)");
me = (await members[0].req("/api/me")).json.data;
assert(me.finished === true && me.team.finishedAt, "participant view finished");
const afterFinish = await members[0].req("/api/tag", { method: "POST", body: { token: tags[0].token } });
assert(afterFinish.json.error === "이미 태깅한 지점입니다.", "tag after finish (already tagged)", afterFinish.json.error);

// second team to check ranking order
const solo = new Client();
await solo.req("/api/join", { method: "POST", body: { code: session.code, name: "솔로" } });
await solo.req("/api/teams", { method: "POST", body: { name: "느린팀" } });
const soloTag = await solo.req("/api/tag", { method: "POST", body: { token: tags[0].token } });
assert(soloTag.status === 200 && soloTag.json.data.tag.id === tags[0].id && soloTag.json.data.view.taggedTagIds.length === 1, "recordTag ok result has tag + view");

// announcements
await admin.req(`/api/admin/sessions/${session.id}/announcements`, { method: "POST", body: { message: "첫 공지" } });
const ann2 = await admin.req(`/api/admin/sessions/${session.id}/announcements`, { method: "POST", body: { message: " 둘째 공지 " } });
assert(ann2.json.data.pinned === true && ann2.json.data.message === "둘째 공지", "createAnnouncement pinned + trimmed");

live = (await admin.req(`/api/admin/sessions/${session.id}`)).json.data;
const r = live.rankings;
log(`rankings: ${JSON.stringify(r.map((x) => ({ rank: x.rank, team: x.teamName, progress: x.progress, finished: x.finished, durationMs: x.durationMs })))}`);
assert(r[0].teamName === "동시성팀" && r[0].finished && r[0].progress === 3 && r[0].durationMs >= 0, "AC6 admin rankings: finished team rank 1");
assert(r[1].teamName === "느린팀" && r[1].progress === 1 && !r[1].finished, "AC6 admin rankings: second team rank 2");
assert(live.announcements.filter((a) => a.pinned).length === 1 && live.announcements[0].message === "둘째 공지", "only newest announcement pinned, newest first");
assert(live.events.every((e) => /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.taggedAt)), "timestamps normalized to toISOString format");
me = (await solo.req("/api/me")).json.data;
assert(me.announcement?.message === "둘째 공지", "participant view shows pinned announcement");

// status transitions
const fin = (await admin.req(`/api/admin/sessions/${session.id}`, { method: "PATCH", body: { status: "finished" } })).json.data;
assert(fin.status === "finished" && fin.finishedAt, "updateSession finished sets finishedAt");
const lateJoin = await new Client().req("/api/join", { method: "POST", body: { code: session.code, name: "늦음" } });
assert(lateJoin.json.error === "이미 종료된 세션입니다.", "join finished session rejected", lateJoin.json.error);
const rdy = (await admin.req(`/api/admin/sessions/${session.id}`, { method: "PATCH", body: { status: "ready" } })).json.data;
assert(rdy.status === "ready" && rdy.finishedAt === null && rdy.startedAt === goLive.json.data.startedAt, "updateSession ready clears finishedAt, keeps startedAt");
const list = (await admin.req("/api/admin/sessions")).json.data;
assert(list[0].id === session.id, "listSessions newest first");
const badCode = await new Client().req("/api/join", { method: "POST", body: { code: "XXXXXX", name: "x" } });
assert(badCode.json.error === "세션 코드를 찾을 수 없습니다.", "join unknown code", badCode.json.error);

// AC7: delete session cascades
const countsSql = (id) => `select (select count(*) from sessions where id='${id}') || ',' || (select count(*) from tags where session_id='${id}') || ',' || (select count(*) from teams where session_id='${id}') || ',' || (select count(*) from participants where session_id='${id}') || ',' || (select count(*) from tag_events where session_id='${id}') || ',' || (select count(*) from announcements where session_id='${id}')`;
const before = psql(countsSql(session.id));
log(`DB before delete (sessions,tags,teams,participants,tag_events,announcements) = ${before}`);
const d = await admin.req(`/api/admin/sessions/${session.id}`, { method: "DELETE" });
const after = psql(countsSql(session.id));
log(`DB after delete  (sessions,tags,teams,participants,tag_events,announcements) = ${after}`);
assert(d.status === 200 && after === "0,0,0,0,0,0", "AC7 deleteSession removes all child rows");
const d2 = await admin.req(`/api/admin/sessions/${session.id}`, { method: "DELETE" });
assert(d2.status === 404, "deleteSession missing -> 404");
const gone = await members[0].req("/api/me");
assert(gone.status === 404, "participant of deleted session -> 404");

log(`\nRESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
