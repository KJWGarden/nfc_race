// TODO-004 API checks: SUN registration / baseline refresh, admin key + inspect APIs, SUN-only /api/tag,
// plus the TODO-001/003 regressions that TODO-004 can affect (race rules, replay, concurrency, cascade).
// Run: node --env-file=<env> api-check-004.mjs   (CHECK_TARGET=hosted for the hosted project)
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
} from "../TODO-003/sun-lib.mjs";
import { diversifyFileKey, parseKeyHex } from "/Users/kimgarden/dev/nfc-walk-race/src/lib/sun.ts";

let failures = 0;
const participantTexts = [];
const allTexts = [];
function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` -- ${detail}` : ""}`);
}
const brief = (r) => `${r.status} ${r.json?.ok ? "ok" : JSON.stringify(r.json?.error)}`;
async function tag(p, payload) {
  const r = await p.req("/api/tag", { method: "POST", body: payload });
  participantTexts.push(r.text);
  allTexts.push(r.text);
  return r;
}
async function register(client, sessionId, tagId, body) {
  const r = await client.req(`/api/admin/sessions/${sessionId}/tags/${tagId}/sun`, { method: "POST", body });
  allTexts.push(r.text);
  return r;
}
const urlOf = ({ e, c }) => `http://127.0.0.1:3000/t/s?e=${e}&c=${c}`;

const U1 = "04C0FFEE000011";
const U2 = "04C0FFEE000012";
const U3 = "04C0FFEE000013";
const U4 = "04C0FFEE000014";
const UIDS = [U1, U2, U3, U4];
const USED = "이미 사용된 태그 URL입니다. 태그를 다시 찍어 주세요.";
const BASE_ERR = "기준 갱신 이전에 읽힌 태그 URL입니다. 태그를 다시 찍어 주세요.";
const BAD_URL = "유효하지 않은 태그 URL입니다.";

console.log(`target=${TARGET} at ${new Date().toISOString()}`);
for (const u of UIDS) await deleteSunCounters(u);

const admin = await adminClient();
const s1 = await createTestSession(admin, "SUN register", ["T1 출발", "T2 중간", "T3 도착"]);
const s2 = await createTestSession(admin, "SUN second", ["X1"]);
const sessions = [s1.session.id, s2.session.id];
const anon = new Client();
const forged = new Client();
forged.cookies.set("cp_admin", `ok.${"0".repeat(24)}`);
try {
  const [t1, t2, t3] = s1.tags;
  const S = s1.session.id;

  // --- AC4/AC5 registration and baseline rules
  let r = await register(admin, S, t1.id, { url: urlOf(sun(U1, 10)) });
  check("AC4 register T1 from SUN URL -> uid + baseline 10 + time", r.status === 200 && r.json.data.uid === U1 && r.json.data.baselineCounter === 10 && !!r.json.data.baselineAt, brief(r));
  r = await register(admin, S, t2.id, sun(U2, 10));
  check("AC4 register T2 from {e,c}", r.status === 200 && r.json.data.uid === U2, brief(r));
  r = await register(admin, S, t3.id, sun(U3, 10));
  check("AC4 register T3", r.status === 200 && r.json.data.uid === U3, brief(r));
  const good = sun(U1, 40);
  const badC = (parseInt(good.c.slice(0, 2), 16) ^ 1).toString(16).padStart(2, "0").toUpperCase() + good.c.slice(2);
  r = await register(admin, S, t1.id, { e: good.e, c: badC });
  check("AC5 bad-MAC registration -> 400 invalid URL", r.status === 400 && r.json.error === BAD_URL, brief(r));
  r = await register(admin, S, t1.id, { url: "https://example.com/t/abc123" });
  check("AC5 non-SUN URL registration -> 400", r.status === 400 && r.json.error === BAD_URL, brief(r));
  let row = (await selectRows("tags", { id: `eq.${t1.id}` }, "uid,baseline_ctr"))[0];
  check("AC5 bad registrations changed nothing", row.uid === U1 && row.baseline_ctr === 10, JSON.stringify(row));
  r = await register(admin, S, t1.id, sun(U1, 5));
  check("baseline never decreases (same UID, lower counter) -> 409", r.status === 409 && r.json.error === "더 최근에 읽은 태그 URL로 갱신해 주세요.", brief(r));
  r = await register(admin, S, t1.id, sun(U1, 10));
  check("same counter re-register is idempotent -> 200", r.status === 200 && r.json.data.baselineCounter === 10, brief(r));
  r = await register(admin, S, t2.id, sun(U1, 12));
  check("UID already on another checkpoint in session -> 409", r.status === 409 && r.json.error === "이 세션의 다른 지점에 이미 등록된 태그입니다.", brief(r));
  r = await register(admin, S, t3.id, sun(U4, 3));
  check("different UID on registered checkpoint -> needsConfirm", r.status === 409 && r.json.needsConfirm === true, brief(r));
  row = (await selectRows("tags", { id: `eq.${t3.id}` }, "uid,baseline_ctr"))[0];
  check("unconfirmed replacement changed nothing", row.uid === U3 && row.baseline_ctr === 10, JSON.stringify(row));
  r = await register(admin, S, t3.id, { ...sun(U4, 3), replace: true });
  check("confirmed replacement rebinds with new baseline", r.status === 200 && r.json.data.uid === U4 && r.json.data.baselineCounter === 3, brief(r));
  r = await register(admin, S, t3.id, { ...sun(U3, 10), replace: true });
  check("rebind T3 back to U3", r.status === 200 && r.json.data.uid === U3, brief(r));
  r = await register(admin, s2.session.id, s2.tags[0].id, sun(U1, 10));
  check("cross-session reuse of the same UID allowed", r.status === 200 && r.json.data.uid === U1, brief(r));
  for (const [who, c] of [["no cookie", anon], ["forged cp_admin", forged]]) {
    r = await register(c, S, t1.id, sun(U1, 50));
    check(`register with ${who} -> 401`, r.status === 401, brief(r));
  }
  // item 9: no UID binding without SUN through the admin API
  r = await admin.req(`/api/admin/sessions/${S}/tags/${t2.id}`, { method: "PATCH", body: { uid: "04AAAAAAAAAAAA", name: "T2 중간" } });
  check("admin PATCH {uid} does not bind a UID", r.status === 200 && r.json.data.uid === U2, JSON.stringify(r.json?.data?.uid));
  r = await admin.req(`/api/admin/sessions/${s2.session.id}/tags`, { method: "POST", body: { name: "X2", uid: "04BBBBBBBBBBBB" } });
  check("admin create tag with {uid} stores no UID", r.status === 200 && r.json.data.uid === "", JSON.stringify(r.json?.data?.uid));

  // --- AC6 key lookup
  const expectedKey = diversifyFileKey(parseKeyHex(env("SUN_MASTER_KEY")), U1).toString("hex").toUpperCase();
  for (const [who, c] of [["no cookie", anon], ["forged cp_admin", forged]]) {
    r = await c.req(`/api/admin/sdm-key?uid=${U1}`);
    check(`AC6 sdm-key with ${who} -> 401`, r.status === 401 && !r.text.includes(expectedKey), brief(r));
  }
  r = await admin.req(`/api/admin/sdm-key?uid=${U1.toLowerCase()}`);
  check("AC6 sdm-key admin -> 200 derived key, no-store", r.status === 200 && r.json.data.fileReadKey === expectedKey && r.json.data.uid === U1 && r.headers.get("cache-control")?.includes("no-store"), `${r.status} cache-control=${r.headers.get("cache-control")}`);
  r = await admin.req(`/api/admin/sdm-key?uid=12345`);
  check("AC6 sdm-key bad uid -> 400", r.status === 400, brief(r));

  // --- AC8 inspect (read-only)
  const beforeCounts = [await countRows("tag_events", { session_id: `in.(${sessions.join(",")})` }), await countRows("sun_counters", { uid: `in.(${UIDS.join(",")})` })].join(",");
  const probe = sun(U1, 30);
  for (const [who, c] of [["no cookie", anon], ["forged cp_admin", forged]]) {
    r = await c.req("/api/admin/sun/inspect", { method: "POST", body: probe });
    check(`AC8 inspect with ${who} -> 401`, r.status === 401, brief(r));
  }
  r = await admin.req("/api/admin/sun/inspect", { method: "POST", body: probe });
  allTexts.push(r.text);
  const b = r.json?.data?.bindings ?? [];
  check("AC8 inspect -> uid, ctr, bindings in both sessions", r.status === 200 && r.json.data.uid === U1 && r.json.data.ctr === 30 && b.some((x) => x.tagId === t1.id && x.baselineCtr === 10) && b.some((x) => x.sessionId === s2.session.id), `bindings=${b.length}`);
  check("AC8 inspect lists pickable sessions with checkpoints", r.json?.data?.sessions?.some((x) => x.id === S && x.tags.length === 3), "");
  check("AC8 inspect no-store", r.headers.get("cache-control")?.includes("no-store"));
  r = await admin.req("/api/admin/sun/inspect", { method: "POST", body: { e: probe.e, c: badC } });
  check("AC8 inspect bad MAC -> 400", r.status === 400 && r.json.error === BAD_URL, brief(r));
  const afterCounts = [await countRows("tag_events", { session_id: `in.(${sessions.join(",")})` }), await countRows("sun_counters", { uid: `in.(${UIDS.join(",")})` })].join(",");
  check("AC8 inspect wrote no tag_events / sun_counters", beforeCounts === afterCounts, `${beforeCounts} -> ${afterCounts}`);

  // --- participant flow (AC1-AC4 at API level; TODO-003 regression)
  const A1 = await participant(s1.session.code, "A1", { create: "[TEST] 팀A" });
  const A2 = await participant(s1.session.code, "A2", { join: A1.joinCode });
  const B1 = await participant(s1.session.code, "B1", { create: "[TEST] 팀B" });
  await admin.req(`/api/admin/sessions/${S}`, { method: "PATCH", body: { status: "live" } });
  const ev0 = await countRows("tag_events", { session_id: `eq.${S}` });
  r = await tag(A1, { token: t1.token });
  check("AC3 static token body -> 400 태그 정보가 없습니다.", r.status === 400 && r.json.error === "태그 정보가 없습니다.", brief(r));
  r = await tag(A1, { uid: U1 });
  check("AC3 UID-only body -> 400 태그 정보가 없습니다.", r.status === 400 && r.json.error === "태그 정보가 없습니다.", brief(r));
  r = await tag(A1, { token: t1.token, uid: U1 });
  check("AC3 token+uid body -> 400", r.status === 400, brief(r));
  check("AC3 no events from token/uid bodies", (await countRows("tag_events", { session_id: `eq.${S}` })) === ev0);
  r = await tag(A1, sun(U1, 10));
  check("AC4 counter == registered baseline -> baseline error", r.status === 400 && r.json.error === BASE_ERR, brief(r));
  const p11 = sun(U1, 11);
  r = await tag(A1, p11);
  check("AC1/AC4 newer counter -> recorded", r.status === 200 && r.json.data.view.taggedTagIds.includes(t1.id), brief(r));
  check("tag summary only id,name,order,nextHint", r.json?.data && JSON.stringify(Object.keys(r.json.data.tag).sort()) === JSON.stringify(["id", "name", "nextHint", "order"]));
  r = await tag(A2, p11);
  check("AC1 same URL again -> already used", r.status === 400 && r.json.error === USED, brief(r));
  // admin refreshes the baseline mid-session: older unsubmitted URLs die, newer ones work
  const stale = sun(U1, 15);
  r = await register(admin, S, t1.id, sun(U1, 20));
  check("baseline refresh to 20", r.status === 200 && r.json.data.baselineCounter === 20, brief(r));
  r = await tag(B1, stale);
  check("URL read before refresh -> baseline error", r.status === 400 && r.json.error === BASE_ERR, brief(r));
  r = await tag(B1, sun(U1, 20));
  check("the registration URL itself is invalid for participants", r.status === 400 && r.json.error === BASE_ERR, brief(r));
  r = await tag(B1, sun(U1, 21));
  check("second team with a fresh counter advances", r.status === 200 && r.json.data.view.taggedTagIds.includes(t1.id), brief(r));

  // TODO-003 AC5 regression: 20 teams, one payload
  const racers = [];
  for (let i = 1; i <= 20; i++) racers.push(await participant(s1.session.code, `D${i}`, { create: `[TEST] 팀D${i}` }));
  const p80 = sun(U1, 80);
  const burst = await Promise.all(racers.map((p) => tag(p, p80)));
  check("20 concurrent identical payloads -> 1 accepted, 19 used", burst.filter((x) => x.status === 200).length === 1 && burst.filter((x) => x.json?.error === USED).length === 19, burst.map((x) => x.status).join(","));
  // TODO-001 AC5 regression via SUN: 20 members of one team, 20 different fresh URLs for the same checkpoint
  const lead = await participant(s1.session.code, "M0", { create: "[TEST] 동시성팀" });
  const members = [lead];
  for (let i = 1; i < 20; i++) members.push(await participant(s1.session.code, `M${i}`, { join: lead.joinCode }));
  const burst2 = await Promise.all(members.map((p, i) => tag(p, sun(U1, 100 + i))));
  const errs = burst2.filter((x) => x.status === 400).map((x) => x.json.error);
  check("one team, 20 concurrent fresh URLs -> 1x200, 19x 이미 태깅한 지점입니다.", burst2.filter((x) => x.status === 200).length === 1 && errs.length === 19 && errs.every((x) => x === "이미 태깅한 지점입니다."), `errors=${JSON.stringify([...new Set(errs)])}`);
  const teamM = (await lead.req("/api/me")).json.data.team.id;
  check("DB: that team has exactly 1 valid event for T1", (await countRows("tag_events", { team_id: `eq.${teamM}`, tag_id: `eq.${t1.id}`, valid: "is.true" })) === 1);

  // race rules + finish (TODO-003 AC8 regression)
  r = await tag(A2, sun(U3, 30));
  check("out of order -> 순서가 아닙니다", r.status === 400 && r.json.error === `순서가 아닙니다. 다음 지점은 "${t2.name}" 입니다.`, brief(r));
  r = await tag(A2, sun(U2, 30));
  check("T2 by teammate -> ok", r.status === 200, brief(r));
  r = await tag(A1, sun(U3, 31));
  check("T3 -> finished", r.status === 200 && r.json.data.view.finished === true, brief(r));
  const live = await admin.req(`/api/admin/sessions/${S}`);
  allTexts.push(live.text);
  const rankA = live.json.data.rankings.find((x) => x.teamName === "[TEST] 팀A");
  check("admin ranking: team A rank 1 finished", rankA?.rank === 1 && rankA?.finished === true);
  check("admin live view carries uid + baseline for tags", live.json.data.tags.every((t) => t.uid && t.baselineCounter != null));

  // AC6: participant APIs never return UIDs or keys
  for (const p of [A1, B1]) {
    const me = await p.req("/api/me");
    participantTexts.push(me.text);
    allTexts.push(me.text);
  }
  const secrets = secretStrings(UIDS);
  check("AC6 participant responses contain no UID", !participantTexts.some((t) => UIDS.some((u) => t.includes(u) || t.includes(u.toLowerCase()))), `responses=${participantTexts.length}`);
  check("AC6/AC7 no meta/master/file key in any participant or admin response (except sdm-key)", !allTexts.some((t) => secrets.some((s) => t.includes(s))), `responses=${allTexts.length}`);
} finally {
  for (const id of sessions) {
    const c = await cleanupSession(admin, id);
    check("cleanup", c.ok, c.line);
  }
  for (const u of UIDS) {
    const c = await deleteSunCounters(u);
    check(`cleanup sun_counters ${u}`, c.after === 0, `before=${c.before} after=${c.after}`);
  }
}
console.log(`RESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
