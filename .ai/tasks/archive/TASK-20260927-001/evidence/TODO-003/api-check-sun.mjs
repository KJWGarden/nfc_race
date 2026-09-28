// TODO-003 API checks: SUN verification, single use, baseline, concurrency, race rules, key exposure.
// Run: node --env-file=<env> api-check-sun.mjs   (CHECK_TARGET=hosted for the hosted project)
import {
  TARGET,
  Client,
  adminClient,
  cleanupSession,
  countRows,
  createTestSession,
  deleteSunCounters,
  participant,
  secretStrings,
  selectRows,
  setBaseline,
  sun,
} from "./sun-lib.mjs";

let failures = 0;
const allTexts = [];
function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` -- ${detail}` : ""}`);
}
async function tag(p, payload) {
  const r = await p.req("/api/tag", { method: "POST", body: payload });
  allTexts.push(r.text);
  return r;
}
const brief = (r) => `${r.status} ${r.json?.ok ? "ok" : JSON.stringify(r.json?.error)}`;

const U1 = "04C0FFEE000001";
const U2 = "04C0FFEE000002";
const U3 = "04C0FFEE000003";
const U9 = "04C0FFEE000009"; // never registered
const UIDS = [U1, U2, U3, U9];
const USED = "이미 사용된 태그 URL입니다. 태그를 다시 찍어 주세요.";
const BASE_ERR = "기준 갱신 이전에 읽힌 태그 URL입니다. 태그를 다시 찍어 주세요.";
const INVALID = "유효하지 않은 태그입니다.";
const UNREG = "등록되지 않은 NFC 태그입니다.";

console.log(`target=${TARGET} at ${new Date().toISOString()}`);
for (const u of UIDS) await deleteSunCounters(u); // leftovers from earlier runs

const admin = await adminClient();
const s1 = await createTestSession(admin, "SUN main", ["T1 출발", "T2 중간", "T3 도착"]);
const s2 = await createTestSession(admin, "SUN no-baseline", ["X1"]);
const sessions = [s1.session.id, s2.session.id];
try {
  const [t1, t2, t3] = s1.tags;
  // bind UIDs through the existing admin tag API, then set baselines (test-only DB write; UI is TODO-004)
  for (const [t, u] of [[t1, U1], [t2, U2], [t3, U3]]) {
    const r = await admin.req(`/api/admin/sessions/${s1.session.id}/tags/${t.id}`, { method: "PATCH", body: { uid: u } });
    check(`bind ${t.name} uid`, r.status === 200 && r.json.data.uid === u && r.json.data.baselineCounter === null);
    await setBaseline(t.id, 10);
  }
  await admin.req(`/api/admin/sessions/${s2.session.id}/tags/${s2.tags[0].id}`, { method: "PATCH", body: { uid: U1 } });

  const A1 = await participant(s1.session.code, "A1", { create: "[TEST] 팀A" });
  const A2 = await participant(s1.session.code, "A2", { join: A1.joinCode });
  const B1 = await participant(s1.session.code, "B1", { create: "[TEST] 팀B" });
  const C1 = await participant(s1.session.code, "C1", { create: "[TEST] 팀C" });
  const E1 = await participant(s1.session.code, "E1", { create: "[TEST] 팀E" });

  // AC8 not-live, and the counter is consumed by it
  let r = await tag(A1, sun(U1, 11));
  check("AC8 not live -> 400 not-live", r.status === 400 && r.json.error.startsWith("세션이 진행 중이 아닙니다"), brief(r));

  await admin.req(`/api/admin/sessions/${s1.session.id}`, { method: "PATCH", body: { status: "live" } });

  // AC2 fresh valid payload
  const p12 = sun(U1, 12);
  const eventsBefore = await countRows("tag_events", { session_id: `eq.${s1.session.id}` });
  r = await tag(A1, p12);
  check("AC2 fresh SUN -> 200 ok", r.status === 200 && r.json.ok === true, brief(r));
  const d = r.json.data;
  check("AC2 same success shape (event, view, tag)", d && d.event?.valid === true && d.view?.taggedTagIds?.includes(t1.id) && d.tag?.name === t1.name && d.tag?.nextHint === t1.nextHint);
  check("AC2 tag summary has only id,name,order,nextHint", d && JSON.stringify(Object.keys(d.tag).sort()) === JSON.stringify(["id", "name", "nextHint", "order"]), JSON.stringify(d?.tag));
  check("AC2 sun_counters row (U1,12) exists", (await countRows("sun_counters", { uid: `eq.${U1}`, ctr: "eq.12" })) === 1);

  // AC3 replay: same participant, teammate, other team
  const validBefore = await countRows("tag_events", { session_id: `eq.${s1.session.id}`, valid: "is.true" });
  const totalBefore = await countRows("tag_events", { session_id: `eq.${s1.session.id}` });
  for (const [who, p] of [["same participant", A1], ["teammate", A2], ["other team", B1]]) {
    r = await tag(p, p12);
    check(`AC3 replay by ${who} -> 400 used`, r.status === 400 && r.json.error === USED, brief(r));
  }
  r = await tag(A1, sun(U1, 11)); // consumed by the not-live attempt
  check("AC3 URL consumed by a race-rule rejection cannot be retried", r.status === 400 && r.json.error === USED, brief(r));
  check("AC3 replays created no events", (await countRows("tag_events", { session_id: `eq.${s1.session.id}` })) === totalBefore &&
    (await countRows("tag_events", { session_id: `eq.${s1.session.id}`, valid: "is.true" })) === validBefore);
  check("AC3 total events: +1 from AC2 only", totalBefore === eventsBefore + 1, `${eventsBefore} -> ${totalBefore}`);

  // AC8 race rules for SUN submissions
  r = await tag(A2, sun(U1, 13));
  check("AC8 teammate fresh URL same checkpoint -> 이미 태깅한 지점입니다. (team credit)", r.status === 400 && r.json.error === "이미 태깅한 지점입니다.", brief(r));
  r = await tag(A2, sun(U3, 11));
  check("AC8 out of order -> 순서가 아닙니다 (next T2)", r.status === 400 && r.json.error === `순서가 아닙니다. 다음 지점은 "${t2.name}" 입니다.`, brief(r));
  const me = await A2.req("/api/me");
  check("AC8 team-level credit visible to teammate", me.json.data.taggedTagIds.includes(t1.id) && me.json.data.taggedTagIds.length === 1);

  // AC6 baseline / bad MAC / unregistered
  r = await tag(B1, sun(U1, 10));
  check("AC6 counter == baseline -> baseline error", r.status === 400 && r.json.error === BASE_ERR, brief(r));
  r = await tag(B1, sun(U1, 3));
  check("AC6 counter < baseline -> baseline error", r.status === 400 && r.json.error === BASE_ERR, brief(r));
  const good = sun(U1, 50);
  const badC = (parseInt(good.c.slice(0, 2), 16) ^ 1).toString(16).padStart(2, "0").toUpperCase() + good.c.slice(2);
  r = await tag(B1, { e: good.e, c: badC });
  check("AC6 bad MAC -> 유효하지 않은 태그입니다.", r.status === 400 && r.json.error === INVALID, brief(r));
  check("AC6 bad MAC consumed nothing", (await countRows("sun_counters", { uid: `eq.${U1}`, ctr: "eq.50" })) === 0);
  r = await tag(B1, { e: good.e.slice(0, 30), c: good.c });
  check("AC6 malformed e -> invalid", r.status === 400 && r.json.error === INVALID, brief(r));
  r = await tag(B1, { e: good.e });
  check("AC6 missing c -> invalid", r.status === 400 && r.json.error === INVALID, brief(r));
  r = await tag(B1, sun(U9, 5));
  check("AC6 UID not registered in session -> 등록되지 않은 NFC 태그입니다.", r.status === 400 && r.json.error === UNREG, brief(r));
  const X1 = await participant(s2.session.code, "X1", { create: "[TEST] 팀X" });
  r = await tag(X1, sun(U2, 60));
  check("AC6 UID registered only in another session -> unregistered", r.status === 400 && r.json.error === UNREG, brief(r));
  r = await tag(X1, sun(U1, 61));
  check("AC6 registered tag without baseline -> baseline error", r.status === 400 && r.json.error === BASE_ERR, brief(r));
  r = await tag(X1, p12);
  check("AC3 counter used in session 1 is also dead in session 2", r.status === 400 && r.json.error === USED, brief(r));
  r = await tag(B1, good);
  check("AC6 after bad-MAC attempt the genuine URL still works", r.status === 200 && r.json.ok, brief(r));

  // AC4 two teams, different fresh counters, concurrently
  const [rc, re] = await Promise.all([tag(C1, sun(U1, 70)), tag(E1, sun(U1, 71))]);
  check("AC4 concurrent different counters -> both 200", rc.status === 200 && re.status === 200, `${brief(rc)} / ${brief(re)}`);
  const meC = await C1.req("/api/me");
  const meE = await E1.req("/api/me");
  check("AC4 both teams advanced", meC.json.data.taggedTagIds.includes(t1.id) && meE.json.data.taggedTagIds.includes(t1.id));

  // AC5 20 concurrent submissions of one payload by 20 different teams
  const racers = [];
  for (let i = 1; i <= 20; i++) racers.push(await participant(s1.session.code, `D${i}`, { create: `[TEST] 팀D${i}` }));
  const p80 = sun(U1, 80);
  const burst = await Promise.all(racers.map((p) => tag(p, p80)));
  const ok = burst.filter((x) => x.status === 200).length;
  const used = burst.filter((x) => x.status === 400 && x.json?.error === USED).length;
  check("AC5 20 concurrent identical -> exactly 1 accepted, 19 used", ok === 1 && used === 19, `ok=${ok} used=${used} statuses=${burst.map((x) => x.status).join(",")}`);
  check("AC5 exactly one sun_counters row (U1,80)", (await countRows("sun_counters", { uid: `eq.${U1}`, ctr: "eq.80" })) === 1);
  let dEvents = 0;
  let dValid = 0;
  for (const p of racers) {
    const m = await p.req("/api/me");
    dValid += m.json.data.taggedTagIds.length;
    dEvents += await countRows("tag_events", { team_id: `eq.${m.json.data.team.id}` });
  }
  check("AC5 exactly one event / one valid tag across the 20 teams", dEvents === 1 && dValid === 1, `events=${dEvents} valid=${dValid}`);

  // AC8 finish via SUN
  r = await tag(A1, sun(U2, 90));
  check("AC8 T2 in order -> ok", r.status === 200 && r.json.ok, brief(r));
  r = await tag(A2, sun(U3, 91));
  check("AC8 T3 by teammate -> ok and finished", r.status === 200 && r.json.data.view.finished === true, brief(r));
  r = await tag(A1, sun(U3, 92));
  check("AC8 after finish -> 이미 태깅한 지점입니다.", r.status === 400 && r.json.error === "이미 태깅한 지점입니다.", brief(r));
  const live = await admin.req(`/api/admin/sessions/${s1.session.id}`);
  allTexts.push(live.text);
  const rankA = live.json.data.rankings.find((x) => x.teamName === "[TEST] 팀A");
  check("AC8 admin ranking: team A finished rank 1", rankA?.finished === true && rankA?.rank === 1, JSON.stringify({ rank: rankA?.rank, progress: rankA?.progress }));
  const teamA = (await selectRows("teams", { name: "eq.[TEST] 팀A", session_id: `eq.${s1.session.id}` }, "started_at,finished_at"))[0];
  check("AC8 team started_at/finished_at set", !!teamA.started_at && !!teamA.finished_at);

  // regression: static-token path still accepted until TODO-004; response tag trimmed there too
  r = await tag(E1, { token: t2.token });
  check("regression token path still works -> ok", r.status === 200 && r.json.ok, brief(r));
  check("regression token response tag trimmed", r.json?.data && !("token" in r.json.data.tag) && !("uid" in r.json.data.tag));

  // AC7 no key material in API responses or DB rows
  const secrets = secretStrings(UIDS);
  const hit = allTexts.filter((t) => secrets.some((s) => t.includes(s))).length;
  check("AC7 no SUN key / master key / derived file key in any API response", hit === 0, `responses scanned=${allTexts.length}`);
  const rowsText = JSON.stringify([
    await selectRows("sun_counters", { uid: `in.(${UIDS.join(",")})` }),
    await selectRows("tags", { session_id: `in.(${sessions.join(",")})` }),
    await selectRows("tag_events", { session_id: `in.(${sessions.join(",")})` }),
  ]);
  check("AC7 no key material in sun_counters/tags/tag_events rows", !secrets.some((s) => rowsText.includes(s)), `bytes scanned=${rowsText.length}`);
  const counterCols = Object.keys((await selectRows("sun_counters", { uid: `eq.${U1}`, limit: "1" }))[0] ?? {});
  check("AC7 sun_counters columns", JSON.stringify(counterCols) === JSON.stringify(["uid", "ctr", "used_at", "participant_id"]), counterCols.join(","));
  const anon = new Client();
  r = await anon.req("/api/tag", { method: "POST", body: sun(U1, 99) });
  check("no participant cookie -> 401, nothing consumed", r.status === 401 && (await countRows("sun_counters", { uid: `eq.${U1}`, ctr: "eq.99" })) === 0, brief(r));
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
