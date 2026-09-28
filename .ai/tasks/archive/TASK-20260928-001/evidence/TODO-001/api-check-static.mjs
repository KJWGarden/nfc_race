// TODO-001 API checks: per-session static-URL switch (sessions.allow_static_url) and POST /api/tag {token}.
// Covers AC2-AC9 through the app at http://127.0.0.1:3000 on the LOCAL stack only.
// Run: node api-check-static.mjs   (Supabase/app values from the process environment, never .env.local)
import {
  TARGET,
  Client,
  adminClient,
  cleanupSession,
  countRows,
  createTestSession,
  deleteSunCounters,
  env,
  participant,
  secretStrings,
  selectRows,
  sun,
} from "../../../../archive/TASK-20260927-001/evidence/TODO-003/sun-lib.mjs";

if (TARGET !== "local") throw new Error("TODO-001 checks run on the local stack only");

let failures = 0;
const participantTexts = [];
function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` -- ${detail}` : ""}`);
}
const brief = (r) => `${r.status} ${r.json?.ok ? "ok" : JSON.stringify(r.json?.error)}`;
async function tag(p, payload) {
  const r = await p.req("/api/tag", { method: "POST", body: payload });
  participantTexts.push(r.text);
  return r;
}
async function me(p) {
  const r = await p.req("/api/me");
  participantTexts.push(r.text);
  return r;
}
async function patchSession(client, id, body) {
  return client.req(`/api/admin/sessions/${id}`, { method: "PATCH", body });
}
async function register(client, sessionId, tagId, body) {
  return client.req(`/api/admin/sessions/${sessionId}/tags/${tagId}/sun`, { method: "POST", body });
}
async function switchOf(id) {
  return (await selectRows("sessions", { id: `eq.${id}` }, "allow_static_url"))[0]?.allow_static_url;
}
async function teamRow(teamId) {
  return (await selectRows("teams", { id: `eq.${teamId}` }, "started_at,finished_at"))[0];
}
async function events(sessionId) {
  return selectRows("tag_events", { session_id: `eq.${sessionId}`, order: "tagged_at.asc" }, "team_id,tag_id,valid,reason");
}

const DISABLED_BODY = JSON.stringify({ ok: false, error: "태그 정보가 없습니다." });
const NOT_LIVE = "세션이 진행 중이 아닙니다. 관리자 시작을 기다려 주세요.";
const DUP = "이미 태깅한 지점입니다.";
const DONE = "이미 완주했습니다.";
const UNKNOWN = "등록되지 않은 NFC 태그입니다.";
const NO_TEAM = "먼저 팀에 참가해 주세요.";
const USED = "이미 사용된 태그 URL입니다. 태그를 다시 찍어 주세요.";
const BASE_ERR = "기준 갱신 이전에 읽힌 태그 URL입니다. 태그를 다시 찍어 주세요.";
const U1 = "04C0FFEE000021";
const U2 = "04C0FFEE000022";
const UIDS = [U1, U2];
const PARTICIPANT_SESSION_KEYS = "allowStaticUrl,checkpointCount,description,id,name,status";

console.log(`target=${TARGET} at ${new Date().toISOString()}`);
for (const u of UIDS) await deleteSunCounters(u);

const admin = await adminClient();
const on = await createTestSession(admin, "static ON", ["A1 출발", "A2 중간", "A3 도착"]);
const off = await createTestSession(admin, "static OFF", ["B1", "B2"]);
const other = await createTestSession(admin, "static OTHER", ["C1"]);
const sessionIds = [on.session.id, off.session.id, other.session.id];
const anon = new Client();
const forged = new Client();
forged.cookies.set("cp_admin", `ok.${"0".repeat(24)}`);
try {
  const S = on.session.id;
  const [a1, a2, a3] = on.tags;

  // --- AC7 admin PATCH
  check("AC7 new session defaults allowStaticUrl=false", on.session.allowStaticUrl === false && (await switchOf(S)) === false, JSON.stringify(on.session.allowStaticUrl));
  let r = await patchSession(admin, S, { allowStaticUrl: true });
  check("AC7 PATCH true -> 200, response includes allowStaticUrl=true, DB true", r.status === 200 && r.json.data.allowStaticUrl === true && (await switchOf(S)) === true, brief(r));
  for (const v of ["false", 0, null, "", {}]) {
    r = await patchSession(admin, S, { allowStaticUrl: v });
    check(`AC7 PATCH non-boolean ${JSON.stringify(v)} leaves switch unchanged`, r.status === 200 && r.json.data.allowStaticUrl === true && (await switchOf(S)) === true, brief(r));
  }
  r = await patchSession(admin, S, { name: on.session.name, description: "settings save", checkpointCount: 3, awardRanks: 3 });
  check("AC7 SettingsPanel-shaped PATCH does not reset the switch", r.status === 200 && r.json.data.allowStaticUrl === true && r.json.data.description === "settings save", brief(r));
  r = await patchSession(admin, S, { allowStaticUrl: false });
  check("AC7 PATCH false -> off", r.status === 200 && r.json.data.allowStaticUrl === false && (await switchOf(S)) === false, brief(r));
  for (const [who, c] of [["no cookie", anon], ["forged cp_admin", forged]]) {
    r = await patchSession(c, S, { allowStaticUrl: true });
    check(`AC7 PATCH with ${who} -> 401, switch unchanged`, r.status === 401 && (await switchOf(S)) === false, brief(r));
  }
  r = await patchSession(admin, S, { allowStaticUrl: true });
  check("AC7 PATCH true again", r.status === 200 && r.json.data.allowStaticUrl === true, brief(r));
  r = await admin.req(`/api/admin/sessions/${S}`);
  check("AC7 admin GET session carries allowStaticUrl", r.status === 200 && r.json.data.session.allowStaticUrl === true, brief(r));
  r = await patchSession(admin, other.session.id, { allowStaticUrl: true });
  check("setup: OTHER session switch on", r.status === 200 && r.json.data.allowStaticUrl === true, brief(r));

  // setup: SUN registration for mixed mode (A1=U1, A2=U2, baseline 10)
  r = await register(admin, S, a1.id, sun(U1, 10));
  check("setup: register A1 SUN U1 baseline 10", r.status === 200, brief(r));
  r = await register(admin, S, a2.id, sun(U2, 10));
  check("setup: register A2 SUN U2 baseline 10", r.status === 200, brief(r));

  // --- AC3 / AC6 switch-off session: same 400 body as before, nothing written
  const offTeam = await participant(off.session.code, "끔팀원", { create: "끔팀" });
  const offNoTeam = await participant(off.session.code, "끔무소속");
  const offTeamId = (await me(offTeam)).json.data.team.id;
  const offBodies = [
    ["{token}", { token: off.tags[0].token }],
    ["{token} upper", { token: off.tags[0].token.toUpperCase() }],
    ["{token+uid}", { token: off.tags[0].token, uid: U1 }],
    ["{uid}", { uid: U1 }],
    ["{} empty", {}],
  ];
  const countersBefore = await countRows("sun_counters", {});
  const teamBefore = JSON.stringify(await teamRow(offTeamId));
  for (const status of ["draft", "live"]) {
    if (status === "live") {
      r = await patchSession(admin, off.session.id, { status: "live" });
      check("setup: OFF session live", r.status === 200 && r.json.data.status === "live" && r.json.data.allowStaticUrl === false, brief(r));
    }
    for (const [who, p] of [["team", offTeam], ["no-team", offNoTeam]]) {
      for (const [label, body] of offBodies) {
        r = await tag(p, body);
        check(`AC3/AC6 OFF(${status}) ${who} ${label} -> 400 byte-equal pre-change body`, r.status === 400 && r.text === DISABLED_BODY, `${r.status} ${r.text}`);
      }
    }
  }
  check("AC3 OFF: 0 tag_events", (await countRows("tag_events", { session_id: `eq.${off.session.id}` })) === 0);
  check("AC3 OFF: 0 new sun_counters rows", (await countRows("sun_counters", {})) === countersBefore);
  check("AC3 OFF: team row unchanged", JSON.stringify(await teamRow(offTeamId)) === teamBefore, teamBefore);
  // switch-on token posted by a switch-off participant: participant's session decides
  r = await tag(offTeam, { token: a1.token });
  check("AC3 OFF participant with a switch-on session's token -> same 400 body", r.status === 400 && r.text === DISABLED_BODY, `${r.status} ${r.text}`);
  check("AC3 ON session has no events from OFF participant", (await countRows("tag_events", { session_id: `eq.${S}` })) === 0);

  // --- AC2 switch-on session, static token
  const t1 = await participant(on.session.code, "켬팀원1", { create: "켬팀1" });
  const onNoTeam = await participant(on.session.code, "켬무소속");
  const t1Id = (await me(t1)).json.data.team.id;
  r = await tag(onNoTeam, { token: a1.token });
  check("AC2 ON no-team participant -> 먼저 팀에 참가", r.status === 400 && r.json.error === NO_TEAM, brief(r));
  r = await tag(onNoTeam, { uid: U1 });
  check("AC6 ON {uid} only -> 400 byte-equal body", r.status === 400 && r.text === DISABLED_BODY, `${r.status} ${r.text}`);
  r = await tag(t1, { uid: U1 });
  check("AC6 ON team {uid} only -> 400 byte-equal body", r.status === 400 && r.text === DISABLED_BODY, `${r.status} ${r.text}`);
  r = await tag(t1, { token: "short" });
  check("ON malformed token -> 400 태그 정보가 없습니다.", r.status === 400 && r.text === DISABLED_BODY, `${r.status} ${r.text}`);
  check("AC6 ON {uid}/malformed wrote nothing", (await countRows("tag_events", { session_id: `eq.${S}` })) === 0);

  r = await tag(t1, { token: a1.token });
  let ev = await events(S);
  check("AC2 ON draft -> not-live message, invalid event like SUN", r.status === 400 && r.json.error === NOT_LIVE && ev.length === 1 && ev[0].valid === false && ev[0].reason === NOT_LIVE && ev[0].tag_id === a1.id, brief(r));
  r = await patchSession(admin, S, { status: "live" });
  check("setup: ON session live", r.status === 200 && r.json.data.status === "live", brief(r));

  r = await tag(t1, { token: a2.token });
  ev = await events(S);
  const orderMsg = `순서가 아닙니다. 다음 지점은 "${a1.name}" 입니다.`;
  check("AC2 ON wrong order -> order message, invalid event", r.status === 400 && r.json.error === orderMsg && ev.at(-1).valid === false && ev.at(-1).tag_id === a2.id, brief(r));
  let n = ev.length;
  r = await tag(t1, { token: "zzzzzzzzzz" });
  check("AC2 ON unknown token -> 등록되지 않은, no event", r.status === 400 && r.json.error === UNKNOWN && (await events(S)).length === n, brief(r));
  r = await tag(t1, { token: other.tags[0].token });
  check("AC2 ON other-session token -> 등록되지 않은, no event", r.status === 400 && r.json.error === UNKNOWN && (await events(S)).length === n && (await countRows("tag_events", { session_id: `eq.${other.session.id}` })) === 0, brief(r));
  check("AC2 team not started after invalid taps", (await teamRow(t1Id)).started_at === null);

  r = await tag(t1, { token: ` ${a1.token.toUpperCase()} ` });
  const d = r.json?.data;
  check("AC2 ON valid static A1 (case/space-insensitive) -> 200 ok", r.status === 200 && d?.ok === true && d.event.valid === true && d.event.tagId === a1.id, brief(r));
  check("AC2/AC8 tag summary is {id,name,order,nextHint} only", d && Object.keys(d.tag).sort().join(",") === "id,name,nextHint,order", JSON.stringify(d?.tag));
  check("AC8 /api/tag view.session keys = old keys + allowStaticUrl(boolean)", d && Object.keys(d.view.session).sort().join(",") === PARTICIPANT_SESSION_KEYS && d.view.session.allowStaticUrl === true, JSON.stringify(d?.view?.session));
  let team = await teamRow(t1Id);
  check("AC2 valid tap sets team started_at", team.started_at !== null && team.finished_at === null, JSON.stringify(team));
  r = await tag(t1, { token: a1.token });
  ev = await events(S);
  check("AC2 ON duplicate -> 이미 태깅한 지점, invalid event", r.status === 400 && r.json.error === DUP && ev.at(-1).valid === false && ev.at(-1).reason === DUP, brief(r));
  r = await tag(t1, { token: a2.token });
  check("AC2 ON A2 in order -> ok", r.status === 200 && r.json.data.ok === true, brief(r));
  r = await tag(t1, { token: a3.token });
  team = await teamRow(t1Id);
  check("AC2 ON last checkpoint A3 -> ok, sets finished_at", r.status === 200 && r.json.data.view.finished === true && team.finished_at !== null, `${brief(r)} ${JSON.stringify(team)}`);
  r = await tag(t1, { token: a2.token });
  check("AC2 ON after finish, tagged checkpoint -> duplicate (same precedence as SUN)", r.status === 400 && r.json.error === DUP, brief(r));

  // finished message: required=2 of 3 tags (checkpointCount 2), team F finishes after A1, A2
  r = await patchSession(admin, S, { checkpointCount: 2 });
  check("setup: ON checkpointCount 2", r.status === 200 && r.json.data.checkpointCount === 2 && r.json.data.allowStaticUrl === true, brief(r));
  const tf = await participant(on.session.code, "완주팀원", { create: "완주팀" });
  const tfId = (await me(tf)).json.data.team.id;
  await tag(tf, { token: a1.token });
  r = await tag(tf, { token: a2.token });
  team = await teamRow(tfId);
  check("AC2 required reached -> finished_at set", r.status === 200 && team.finished_at !== null, `${brief(r)} ${JSON.stringify(team)}`);
  const finishedAt = team.finished_at;
  r = await tag(tf, { token: a3.token });
  ev = await events(S);
  check("AC2 ON after finish, new checkpoint -> 이미 완주했습니다., invalid event, finished_at unchanged", r.status === 400 && r.json.error === DONE && ev.at(-1).valid === false && ev.at(-1).reason === DONE && (await teamRow(tfId)).finished_at === finishedAt, brief(r));
  r = await patchSession(admin, S, { checkpointCount: 3 });
  check("setup: ON checkpointCount back to 3", r.status === 200, brief(r));

  // --- AC4 mixed mode in a switch-on session
  const tm = await participant(on.session.code, "혼합팀원", { create: "혼합팀" });
  r = await tag(tm, sun(U1, 11));
  check("AC4 mixed: A1 by SUN -> ok", r.status === 200 && r.json.data.event.tagId === a1.id, brief(r));
  r = await tag(tm, { token: a1.token });
  check("AC4 mixed: A1 again by static -> duplicate", r.status === 400 && r.json.error === DUP, brief(r));
  r = await tag(tm, { token: a2.token });
  check("AC4 mixed: A2 by static -> ok (in order)", r.status === 200 && r.json.data.event.tagId === a2.id, brief(r));
  const tn = await participant(on.session.code, "혼합팀원2", { create: "혼합팀2" });
  r = await tag(tn, { token: a1.token });
  check("AC4 mixed: team N A1 by static -> ok", r.status === 200, brief(r));
  const replay = sun(U1, 12);
  r = await tag(tn, replay);
  check("AC4 mixed: A1 again by SUN -> duplicate", r.status === 400 && r.json.error === DUP, brief(r));
  r = await tag(tn, replay);
  check("AC4 SUN replay in switch-on session -> 이미 사용된 태그 URL", r.status === 400 && r.json.error === USED, brief(r));
  r = await tag(tn, sun(U2, 10));
  check("AC4 SUN baseline-equal in switch-on session -> rejected", r.status === 400 && r.json.error === BASE_ERR, brief(r));
  r = await tag(tn, sun(U2, 9));
  check("AC4 SUN below baseline in switch-on session -> rejected", r.status === 400 && r.json.error === BASE_ERR, brief(r));
  r = await tag(tn, sun(U2, 13));
  check("AC4 mixed: A2 by SUN -> ok", r.status === 200 && r.json.data.event.tagId === a2.id, brief(r));
  r = await tag(tn, { e: 5, c: "x", token: a3.token });
  check("SUN fields present take the SUN path even with token (malformed -> 유효하지 않은 태그)", r.status === 400 && r.json.error === "유효하지 않은 태그입니다.", brief(r));

  // --- AC5 concurrency: 20 concurrent same-token posts by one team (2 members)
  const c1 = await participant(on.session.code, "동시1", { create: "동시팀" });
  const c2 = await participant(on.session.code, "동시2", { join: c1.joinCode });
  const cId = (await me(c1)).json.data.team.id;
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => tag(i % 2 ? c2 : c1, { token: a1.token })),
  );
  const oks = results.filter((x) => x.status === 200).length;
  const valid = await countRows("tag_events", { team_id: `eq.${cId}`, valid: "is.true" });
  const dups = results.filter((x) => x.status === 400 && x.json?.error === DUP).length;
  check("AC5 20 concurrent static posts -> exactly 1 ok, 19 duplicate, 1 valid event", oks === 1 && dups === 19 && valid === 1, `ok=${oks} dup=${dups} validEvents=${valid}`);

  // --- toggle off mid-race: further static taps fail with the disabled body, credits stay
  r = await patchSession(admin, S, { allowStaticUrl: false });
  const validBefore = await countRows("tag_events", { session_id: `eq.${S}`, valid: "is.true" });
  const evBefore = await countRows("tag_events", { session_id: `eq.${S}` });
  r = await tag(tm, { token: a3.token });
  check("switch turned off live -> static tap 400 byte-equal body, no event", r.status === 400 && r.text === DISABLED_BODY && (await countRows("tag_events", { session_id: `eq.${S}` })) === evBefore, `${r.status} ${r.text}`);
  check("credits already recorded stay", (await countRows("tag_events", { session_id: `eq.${S}`, valid: "is.true" })) === validBefore, String(validBefore));
  r = await tag(tn, sun(U1, 20));
  check("switch off: SUN still works (duplicate rule reached, not disabled)", r.status === 400 && r.json.error === DUP, brief(r));
  r = await me(tm);
  check("AC8 /api/me view.session.allowStaticUrl follows switch (false)", r.status === 200 && r.json.data.session.allowStaticUrl === false && Object.keys(r.json.data.session).sort().join(",") === PARTICIPANT_SESSION_KEYS, JSON.stringify(r.json?.data?.session));
  r = await patchSession(admin, S, { allowStaticUrl: true });
  r = await me(tm);
  check("AC8 /api/me view.session.allowStaticUrl follows switch (true)", r.json.data.session.allowStaticUrl === true, JSON.stringify(r.json?.data?.session));

  // --- AC8 no token / UID / key material in participant responses
  for (const p of [t1, tm, tn, tf, onNoTeam, offTeam, offNoTeam, c1]) await me(p);
  const joinR = await new Client().req("/api/join", { method: "POST", body: { code: on.session.code, name: "스캔" } });
  participantTexts.push(joinR.text);
  const tokens = [...on.tags, ...off.tags, ...other.tags].map((t) => t.token);
  const needles = [...tokens, ...tokens.map((t) => t.toUpperCase()), ...UIDS, ...UIDS.map((u) => u.toLowerCase()), ...secretStrings(UIDS)];
  const hits = needles.filter((s) => participantTexts.some((t) => t.includes(s)));
  check(`AC8 ${participantTexts.length} participant responses contain no tag token / UID / key`, hits.length === 0, hits.length ? `hits=${hits.length}` : `needles=${needles.length}`);
  check("AC8 /api/join session only adds the boolean", joinR.status === 200 && typeof joinR.json.data.session?.allowStaticUrl === "boolean", JSON.stringify(Object.keys(joinR.json?.data?.session ?? {})));

  // --- AC9 anon key privileges (REST)
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const rest = async (method, path, body) => {
    const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, {
      method,
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  };
  let a = await rest("POST", "rpc/record_static_tag", { p_participant_id: "x", p_token: a1.token, p_event_id: "x" });
  check("AC9 anon rpc record_static_tag -> 42501", a.text.includes('"42501"'), `${a.status} ${a.text}`);
  a = await rest("GET", "sessions?select=allow_static_url");
  check("AC9 anon select sessions.allow_static_url -> 42501", a.text.includes('"42501"'), `${a.status} ${a.text}`);
  a = await rest("PATCH", `sessions?id=eq.${S}`, { allow_static_url: false });
  check("AC9 anon update sessions.allow_static_url -> 42501, unchanged", a.text.includes('"42501"') && (await switchOf(S)) === true, `${a.status} ${a.text}`);
} finally {
  for (const id of sessionIds) {
    const c = await cleanupSession(admin, id);
    check(`cleanup ${id}`, c.ok, c.line);
  }
  for (const u of UIDS) {
    const c = await deleteSunCounters(u);
    check(`cleanup sun_counters ${u}`, c.after === 0, `before=${c.before} after=${c.after}`);
  }
}
console.log(failures === 0 ? "ALL PASS" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
