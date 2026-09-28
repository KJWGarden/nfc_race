// TODO-006 API checks: participant re-join (session code + team code + normalized name), duplicate-name prevention
// within a team (incl. concurrent joins), generic not-found error, re-join in a finished session,
// plus the join / team create / team join / SUN tag regressions on the same routes.
// Run: node api-check-006.mjs   with the app's env in the process (CHECK_TARGET=hosted reads .env.local)
import {
  TARGET,
  Client,
  adminClient,
  cleanupSession,
  countRows,
  createTestSession,
  deleteSunCounters,
  participant,
  sun,
} from "../TODO-003/sun-lib.mjs";

let failures = 0;
function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` -- ${detail}` : ""}`);
}
const brief = (r) => `${r.status} ${r.json?.ok ? "ok" : JSON.stringify(r.json?.error)}`;
const NOT_FOUND = "일치하는 팀원을 찾을 수 없습니다.";
const DUP = "같은 이름의 팀원이 이미 있습니다. 쿠키를 잃었다면 '다시 들어가기'를 이용해 주세요.";
const U1 = "04C0FFEE000031";
const U2 = "04C0FFEE000032";
const U3 = "04C0FFEE000033";

async function rejoin(body) {
  const c = new Client();
  const r = await c.req("/api/rejoin", { method: "POST", body });
  return { c, r, setCookie: r.headers.getSetCookie() };
}

console.log(`target=${TARGET} at ${new Date().toISOString()}`);
for (const u of [U1, U2, U3]) await deleteSunCounters(u);
const admin = await adminClient();
const { session, tags } = await createTestSession(admin, "rejoin", ["R1 출발", "R2 중간", "R3 도착"]);
const S = session.id;
const CODE = session.code;
// second [TEST] session: a real session code that does not contain the team (AC3), never another user's session
const { session: session2 } = await createTestSession(admin, "rejoin other", ["X1"]);
// codes that cannot exist: session/team codes never contain I or O (src/lib/ids.ts), so lookups can't match real rows
const NO_SESSION = "OOOOOO";
const NO_TEAM = "IIII";
try {
  // setup: register tags, go live, team with leader A + member B, one team-less participant C
  for (const [t, u] of [[tags[0], U1], [tags[1], U2], [tags[2], U3]]) {
    await admin.req(`/api/admin/sessions/${S}/tags/${t.id}/sun`, { method: "POST", body: sun(u, 10) });
  }
  await admin.req(`/api/admin/sessions/${S}`, { method: "PATCH", body: { status: "live" } });
  const A = await participant(CODE, "Kim Lee", { create: "[TEST] 재입장팀" });
  const TEAM = A.joinCode;
  const B = await participant(CODE, "박 민수", { join: TEAM });
  await participant(CODE, "무소속"); // team-less participant C (AC3)
  let r = await A.req("/api/tag", { method: "POST", body: sun(U1, 11) });
  check("setup: A tags R1 -> recorded", r.status === 200, brief(r));
  const meA = (await A.req("/api/me")).json.data;
  const meB = (await B.req("/api/me")).json.data;

  // AC1 re-join restores the same participant, team, leader flag and progress; no new row
  const before = await countRows("participants", { session_id: `eq.${S}` });
  let x = await rejoin({ code: CODE, joinCode: TEAM, name: "Kim Lee" });
  const cookie = x.setCookie.find((c) => c.startsWith("cp_pid="));
  check("AC1 re-join A -> 200 + cp_pid cookie", x.r.status === 200 && !!cookie && x.r.json.data.participantId === meA.participant.id, brief(x.r));
  let me = (await x.c.req("/api/me")).json.data;
  check(
    "AC1 /api/me after re-join: same participant, team, leader, progress",
    me.participant.id === meA.participant.id &&
      me.team.id === meA.team.id &&
      me.participant.isLeader === true &&
      JSON.stringify(me.taggedTagIds) === JSON.stringify(meA.taggedTagIds) &&
      me.taggedTagIds.length === 1 &&
      me.nextTag?.id === tags[1].id,
    `leader=${me.participant.isLeader} tagged=${me.taggedTagIds.length} next=${me.nextTag?.name}`,
  );
  x = await rejoin({ code: CODE, joinCode: TEAM, name: "박 민수" });
  me = (await x.c.req("/api/me")).json.data;
  check("AC1 re-join B -> same participant, not leader", x.r.status === 200 && me.participant.id === meB.participant.id && me.participant.isLeader === false, brief(x.r));
  const after = await countRows("participants", { session_id: `eq.${S}` });
  check("AC1 participant rows unchanged by re-joins", before === after && after === 3, `before=${before} after=${after}`);
  r = await A.req("/api/me");
  check("old device cookie still works (not invalidated)", r.status === 200 && r.json.data.participant.id === meA.participant.id, brief(r));

  // AC2 normalization: spaces, repeated inner whitespace, Latin case, lower-case codes
  for (const variant of ["  Kim Lee  ", "kim   lee", "KIM LEE", "kIm \t lEe"]) {
    x = await rejoin({ code: CODE, joinCode: TEAM, name: variant });
    check(`AC2 name ${JSON.stringify(variant)} -> A`, x.r.status === 200 && x.r.json.data.participantId === meA.participant.id, brief(x.r));
  }
  x = await rejoin({ code: ` ${CODE.toLowerCase()} `, joinCode: ` ${TEAM.toLowerCase()} `, name: "박 민수" });
  check("AC2 lower-case/padded session and team codes -> B", x.r.status === 200 && x.r.json.data.participantId === meB.participant.id, brief(x.r));

  // AC3 generic error, no cookie
  const wrong = [
    ["wrong session code", { code: NO_SESSION, joinCode: TEAM, name: "Kim Lee" }],
    ["wrong team code", { code: CODE, joinCode: NO_TEAM, name: "Kim Lee" }],
    ["non-member name", { code: CODE, joinCode: TEAM, name: "없는 사람" }],
    ["team-less participant", { code: CODE, joinCode: TEAM, name: "무소속" }],
    ["member of this team but other ([TEST]) session code", { code: session2.code, joinCode: TEAM, name: "Kim Lee" }],
  ];
  for (const [label, body] of wrong) {
    x = await rejoin(body);
    check(`AC3 ${label} -> 400 "${NOT_FOUND}", no Set-Cookie`, x.r.status === 400 && x.r.json.error === NOT_FOUND && x.setCookie.length === 0, `${brief(x.r)} set-cookie=${x.setCookie.length}`);
  }
  x = await rejoin({ code: CODE, joinCode: TEAM, name: "   " });
  check("empty name -> 400 이름 입력 안내, no cookie", x.r.status === 400 && x.setCookie.length === 0, brief(x.r));

  // AC4 duplicate normalized name in a team is refused; other teams unaffected
  const D = await participant(CODE, " kim   LEE ");
  r = await D.req("/api/teams/join", { method: "POST", body: { joinCode: TEAM } });
  check("AC4 join with a normalized-equal name -> refused with '다시 들어가기' message", r.status === 400 && r.json.error === DUP, brief(r));
  r = await D.req("/api/me");
  check("AC4 refused participant stays team-less", r.json.data.team === null, `team=${r.json.data.team?.id ?? null}`);
  r = await D.req("/api/teams", { method: "POST", body: { name: "[TEST] 다른팀" } });
  check("AC4 same name can create/lead a different team (uniqueness is per team)", r.status === 200, brief(r));
  const OTHER = r.json.data.team.joinCode;
  const E = await participant(CODE, "박 민수");
  r = await E.req("/api/teams/join", { method: "POST", body: { joinCode: OTHER } });
  check("AC4 same name as a member of another team -> join OK", r.status === 200, brief(r));
  x = await rejoin({ code: CODE, joinCode: OTHER, name: "박 민수" });
  check("re-join resolves by team: 박 민수 in the other team -> E", x.r.status === 200 && x.r.json.data.participantId === (await E.req("/api/me")).json.data.participant.id, brief(x.r));

  // AC4 concurrency: pairs of participants with normalized-equal names join the same team at once
  for (let round = 1; round <= 5; round++) {
    const p1 = await participant(CODE, `동시 참가${round}`);
    const p2 = await participant(CODE, `  동시   참가${round} `);
    const res = await Promise.all([p1, p2].map((p) => p.req("/api/teams/join", { method: "POST", body: { joinCode: TEAM } })));
    const ok = res.filter((q) => q.status === 200).length;
    const dup = res.filter((q) => q.status === 400 && q.json.error === DUP).length;
    check(`AC4 concurrent same-name join round ${round} -> exactly 1 success, 1 duplicate refusal`, ok === 1 && dup === 1, res.map(brief).join(" | "));
  }
  const members = (await A.req("/api/me")).json.data.members.map((m) => m.name);
  check("AC4 team has 7 members (A, B, 5 concurrent winners)", members.length === 7, JSON.stringify(members));

  // AC5 (API part): re-joined device can tag for the team; the browser run covers the pending-SUN flow
  x = await rejoin({ code: CODE, joinCode: TEAM, name: "박 민수" });
  r = await x.c.req("/api/tag", { method: "POST", body: sun(U2, 11) });
  me = (await A.req("/api/me")).json.data;
  check("AC5 re-joined member tags R2 -> team advances to 2/3", r.status === 200 && me.taggedTagIds.length === 2, `${brief(r)} tagged=${me.taggedTagIds.length}`);

  // re-join allowed in a finished session (MASTER decision Q3)
  await admin.req(`/api/admin/sessions/${S}`, { method: "PATCH", body: { status: "finished" } });
  x = await rejoin({ code: CODE, joinCode: TEAM, name: "Kim Lee" });
  me = x.r.status === 200 ? (await x.c.req("/api/me")).json.data : null;
  check("finished session: re-join -> 200 and /api/me shows finished session", x.r.status === 200 && me?.session.status === "finished", brief(x.r));
  r = await new Client().req("/api/join", { method: "POST", body: { code: CODE, name: "새 사람" } });
  check("finished session: new join still refused (unchanged)", r.status === 400 && r.json.error === "이미 종료된 세션입니다.", brief(r));

  check("final participant rows", (await countRows("participants", { session_id: `eq.${S}` })) === 15, `${await countRows("participants", { session_id: `eq.${S}` })}`);
} finally {
  for (const id of [S, session2.id]) {
    const c = await cleanupSession(admin, id);
    check("cleanup", c.ok, c.line);
  }
  for (const u of [U1, U2, U3]) {
    const d = await deleteSunCounters(u);
    check(`cleanup sun_counters ${u}`, d.after === 0, `before=${d.before} after=${d.after}`);
  }
}
console.log(`\nRESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
