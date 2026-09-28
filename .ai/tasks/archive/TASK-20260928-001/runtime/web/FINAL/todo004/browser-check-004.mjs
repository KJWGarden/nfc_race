// TODO-004 browser validation: SUN admin registration (NFC tab), admin mode on /t, participant SUN flows,
// plus TODO-002 regressions (participant polling, admin realtime) on the changed screens.
// Uses its own "[TEST]" sessions created via the admin API; deleted in finally.
// Run from the scratchpad (playwright-core lives here): node --env-file=<env> browser-check-004.mjs [outDir]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import {
  TARGET,
  env,
  adminClient,
  cleanupSession,
  countRows,
  createTestSession,
  deleteSunCounters,
  selectRows,
  sun,
} from "/Users/kimgarden/dev/nfc-walk-race/.ai/tasks/archive/TASK-20260927-001/evidence/TODO-003/sun-lib.mjs";
import { diversifyFileKey, parseKeyHex } from "/Users/kimgarden/dev/nfc-walk-race/src/lib/sun.ts";

const BASE = "http://127.0.0.1:3000";
const OUT = process.argv[2] ?? "/Users/kimgarden/dev/nfc-walk-race/.ai/tasks/active/TASK-20260927-001/runtime/web/TODO-004";
mkdirSync(OUT, { recursive: true });
const POLL_BUDGET = 12_500;
const RT_BUDGET = 5_000;

const U1 = "04C0FFEE000021";
const U2 = "04C0FFEE000022";
const U3 = "04C0FFEE000023";
const U4 = "04C0FFEE000024";
const U5 = "04C0FFEE000025";
const UIDS = [U1, U2, U3, U4, U5];
const tUrl = (p) => `${BASE}/t/s?e=${p.e}&c=${p.c}`;

let failures = 0;
function step(ok, text) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${text}`);
}
function note(text) {
  console.log(`NOTE ${text}`);
}
async function visible(locator, timeout = 8000) {
  const t0 = Date.now();
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return Date.now() - t0;
  } catch {
    return null;
  }
}
async function expectVisible(page, locator, label, timeout = 8000, shot) {
  const ms = await visible(locator, timeout);
  step(ms !== null, `${label}${ms === null ? ` (not within ${timeout} ms)` : ` (${ms} ms)`}`);
  if (ms === null || shot) await page.screenshot({ path: `${OUT}/${shot ?? `fail-${Date.now()}`}.png`, fullPage: true });
  return ms;
}
const tagRow = async (sessionTagId) => (await selectRows("tags", { id: `eq.${sessionTagId}` }, "uid,baseline_ctr"))[0];

console.log(`target=${TARGET} at ${new Date().toISOString()}`);
for (const u of UIDS) await deleteSunCounters(u);
const setup = await adminClient();
const s1 = await createTestSession(setup, "TODO-004 browser", ["T1 출발", "T2 중간", "T3 도착"]);
const s2 = await createTestSession(setup, "TODO-004 browser picker", ["Y1 예비"]);
const S = s1.session.id;
const CODE = s1.session.code;
const [t1, t2, t3] = s1.tags;
const y1 = s2.tags[0];

const browser = await chromium.launch();
const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const mobile = { viewport: { width: 390, height: 844 } };
// key hygiene: for the whole run, the file read key element is painted transparent on a black box in every
// admin page (screenshots, including failure screenshots, can never show it). The script never prints the key.
await adminCtx.addInitScript(() => {
  const css = '[data-testid="file-read-key"]{color:transparent!important;background:#000!important;text-shadow:none!important}';
  const add = () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  };
  if (document.head) add();
  else document.addEventListener("DOMContentLoaded", add);
});
const admin = await adminCtx.newPage();
const tagPosts = new Map(); // page -> count of POST /api/tag
const registerPosts = [];
const inspectPosts = [];
function instrument(page, name) {
  tagPosts.set(name, 0);
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/tag")) tagPosts.set(name, tagPosts.get(name) + 1);
    if (r.method() === "POST" && /\/tags\/[^/]+\/sun$/.test(r.url())) registerPosts.push(r.url());
    if (r.method() === "POST" && r.url().endsWith("/api/admin/sun/inspect")) inspectPosts.push(name);
  });
}
instrument(admin, "admin");
const counts = async () =>
  [
    await countRows("tag_events", { session_id: `in.(${S},${s2.session.id})` }),
    await countRows("sun_counters", { uid: `in.(${UIDS.join(",")})` }),
  ].join(",");

try {
  // ---------- admin: login + NFC tab
  await admin.goto(`${BASE}/admin/login`);
  await admin.getByLabel("관리자 비밀번호").fill(env("ADMIN_PASSWORD"));
  await admin.getByRole("button", { name: "입장" }).click();
  await admin.waitForURL(`${BASE}/admin`);
  await admin.goto(`${BASE}/admin/sessions/${S}`);
  await admin.getByRole("button", { name: "NFC", exact: true }).click();
  await expectVisible(admin, admin.getByText("태그 SDM 설정값 (NXP 도구에 입력)"), "AC6 NFC tab shows SDM configuration section");
  step(await admin.getByText(`${BASE}/t/s?e=${"0".repeat(32)}&c=${"0".repeat(16)}`).isVisible(), "AC6 SUN URL template shown");
  step((await admin.getByAltText("태그 QR").count()) === 0, "AC7 no tag QR");
  step((await admin.getByRole("button", { name: "NFC에 쓰기" }).count()) === 0, "AC7 no 'NFC에 쓰기'");
  step((await admin.getByRole("button", { name: "토큰 복사" }).count()) === 0, "AC7 no '토큰 복사'");
  step((await admin.getByLabel("물리 UID (선택)").count()) === 0 && (await admin.getByRole("button", { name: "UID 등록" }).count()) === 0, "AC7 no free-text UID entry");
  step((await admin.getByText(t1.token).count()) === 0, "AC7 token not shown");
  // key lookup (admin-only API)
  await admin.getByLabel("키 조회 UID").fill(U1);
  await admin.getByRole("button", { name: "키 보기" }).click();
  const expectedKey = diversifyFileKey(parseKeyHex(env("SUN_MASTER_KEY")), U1).toString("hex").toUpperCase();
  await expectVisible(admin, admin.getByTestId("file-read-key"), "AC6 '키 보기' shows the file read key");
  step((await admin.getByTestId("file-read-key").textContent()).includes(expectedKey), "AC6 shown key equals derived K_file(UID)");
  const keyColor = await admin.getByTestId("file-read-key").evaluate((el) => getComputedStyle(el).color);
  step(keyColor === "rgba(0, 0, 0, 0)", `evidence hygiene: key element is transparent in screenshots (${keyColor})`);
  await admin.screenshot({ path: `${OUT}/00-key-hidden-check.png`, clip: await admin.getByTestId("file-read-key").boundingBox() });
  step((await tagRow(t1.id)).uid === "", "key lookup did not bind the UID");

  // register T1..T3 from pasted SUN URLs
  for (const [t, u] of [[t1, U1], [t2, U2], [t3, U3]]) {
    await admin.getByLabel(`${t.name} 태그 URL`).fill(tUrl(sun(u, 10)));
    await admin.getByTestId(`tag-row-${t.order}`).getByRole("button", { name: "등록" }).click();
    await expectVisible(admin, admin.getByText(`${t.name}: 기준값 10 로 저장했습니다.`), `AC4 register ${t.name} -> notice`);
  }
  await expectVisible(admin, admin.getByTestId("tag-row-1").getByText(`UID ${U1}`), "AC4 row shows UID");
  step(await admin.getByTestId("tag-row-1").getByText("기준값 10").isVisible(), "AC4 row shows baseline counter");
  step(await admin.getByTestId("tag-row-1").getByText("등록됨").isVisible(), "AC4 row shows 등록됨");
  step(await admin.getByTestId("tag-row-1").getByRole("button", { name: "기준 갱신" }).isVisible(), "registered row button is '기준 갱신'");
  // the derived file key is also masked here (belt and braces with the injected CSS)
  await admin.screenshot({ path: `${OUT}/01-admin-nfc-registered.png`, fullPage: true, mask: [admin.getByTestId("file-read-key")] });
  // bad MAC registration
  const bad = sun(U2, 50);
  const badC = (parseInt(bad.c.slice(0, 2), 16) ^ 1).toString(16).padStart(2, "0").toUpperCase() + bad.c.slice(2);
  await admin.getByLabel(`${t2.name} 태그 URL`).fill(`${BASE}/t/s?e=${bad.e}&c=${badC}`);
  await admin.getByTestId("tag-row-2").getByRole("button", { name: "기준 갱신" }).click();
  await expectVisible(admin, admin.getByTestId("tag-row-2").getByText("유효하지 않은 태그 URL입니다."), "AC5 bad-MAC registration shows error");
  const r2 = await tagRow(t2.id);
  step(r2.uid === U2 && r2.baseline_ctr === 10, `AC5 bad-MAC registration changed nothing (${JSON.stringify(r2)})`);
  // invite QR still renders
  await admin.getByRole("button", { name: "초대", exact: true }).click();
  await expectVisible(admin, admin.getByAltText(`${S.slice(0, 6)} 초대 QR`), "AC7 join invite QR still renders", 8000, "02-admin-invite-qr");

  // ---------- admin mode on /t
  const tPage = await adminCtx.newPage();
  instrument(tPage, "adminT");
  let before = await counts();
  await tPage.goto(tUrl(sun(U1, 25)));
  await expectVisible(tPage, tPage.getByText("관리자 모드 — 참가자 태깅은 기록되지 않습니다."), "AC8 admin mode banner");
  await expectVisible(tPage, tPage.getByText("지점 1 T1 출발"), "AC8 registered UID shows its checkpoint");
  step(await tPage.getByText("현재 기준값 10").isVisible(), "AC8 shows current baseline");
  await tPage.getByRole("button", { name: "기준 갱신" }).click();
  await expectVisible(tPage, tPage.getByText("T1 출발: 기준값 25 로 저장했습니다."), "AC8 '기준 갱신' saves this URL's counter", 8000, "03-admin-mode-refresh");
  step((await tagRow(t1.id)).baseline_ctr === 25, "AC8 DB baseline = 25");
  await tPage.goto(tUrl(sun(U1, 22)));
  await tPage.getByRole("button", { name: "기준 갱신" }).click();
  await expectVisible(tPage, tPage.getByText("더 최근에 읽은 태그 URL로 갱신해 주세요."), "AC8 older URL cannot lower the baseline");
  step((await tagRow(t1.id)).baseline_ctr === 25, "baseline still 25");
  // unregistered UID: pick session + checkpoint
  await tPage.goto(tUrl(sun(U4, 5)));
  await expectVisible(tPage, tPage.getByText("아직 어느 지점에도 등록되지 않은 태그입니다."), "AC8 unregistered UID shows register flow");
  await tPage.getByLabel("세션 선택").selectOption(s2.session.id);
  await tPage.getByLabel("지점 선택").selectOption(y1.id);
  await tPage.getByRole("button", { name: "등록", exact: true }).click();
  await expectVisible(tPage, tPage.getByText("Y1 예비: 기준값 5 로 저장했습니다."), "AC8 register via session + checkpoint picker", 8000, "04-admin-mode-register");
  const y = await tagRow(y1.id);
  step(y.uid === U4 && y.baseline_ctr === 5, `DB Y1 bound to U4 baseline 5 (${JSON.stringify(y)})`);
  // replacement confirmation
  await tPage.goto(tUrl(sun(U5, 7)));
  await tPage.getByLabel("세션 선택").selectOption(s2.session.id);
  await tPage.getByLabel("지점 선택").selectOption(y1.id);
  await tPage.getByRole("button", { name: "등록", exact: true }).click();
  await expectVisible(tPage, tPage.getByText("기존 태그를 이 태그로 교체할까요?"), "replacement asks for confirmation");
  step((await tagRow(y1.id)).uid === U4, "unconfirmed replacement changed nothing");
  await tPage.getByRole("button", { name: "교체" }).click();
  await expectVisible(tPage, tPage.getByText("Y1 예비: 기준값 7 로 저장했습니다."), "confirmed replacement rebinds");
  step((await tagRow(y1.id)).uid === U5, "DB Y1 now U5");
  // same-session conflict: U5 onto T1 of s2? (s2 has one tag) -> use s1: U1 onto T2
  await tPage.goto(tUrl(sun(U1, 26)));
  await tPage.getByLabel("세션 선택").selectOption(S);
  await tPage.getByLabel("지점 선택").selectOption(t2.id);
  await tPage.getByRole("button", { name: "등록", exact: true }).click();
  await expectVisible(tPage, tPage.getByText("이 세션의 다른 지점에 이미 등록된 태그입니다."), "same-session UID conflict error");
  // invalid MAC in admin mode
  await tPage.goto(`${BASE}/t/s?e=${bad.e}&c=${badC}`);
  await expectVisible(tPage, tPage.getByText("유효하지 않은 태그 URL입니다."), "AC8 invalid MAC in admin mode shows error");
  // admin device that also holds cp_pid
  const jr = await tPage.request.post(`${BASE}/api/join`, { data: { code: CODE, name: "관리자폰" } });
  step(jr.status() === 200, "admin context also joined as participant (cp_pid)");
  await tPage.goto(tUrl(sun(U2, 27)));
  await expectVisible(tPage, tPage.getByText("관리자 모드 — 참가자 태깅은 기록되지 않습니다."), "AC8 admin mode wins over cp_pid");
  await tPage.getByText("지점 2 T2 중간").waitFor();
  step((await tPage.evaluate(() => sessionStorage.getItem("pendingTag"))) === null, "AC8 no pendingTag stored in admin mode");
  step(tagPosts.get("adminT") === 0, `AC8 admin-mode pages sent 0 POST /api/tag (${tagPosts.get("adminT")})`);
  const regClicks = registerPosts.length;
  let after = await counts();
  step(before.split(",")[0] === after.split(",")[0] && before.split(",")[1] === after.split(",")[1], `AC8 tag_events,sun_counters unchanged by admin mode (${before} -> ${after})`);
  // clicks so far: 4 in the admin tab (3 registers + 1 bad MAC) + 6 on /t (refresh, older, register, needsConfirm, replace, conflict)
  step(regClicks === 10, `one register POST per click, no automatic writes (${regClicks} POSTs for 10 clicks)`);
  note(`read-only inspect POSTs from 7 /t admin-mode loads: ${inspectPosts.length} (Strict Mode may double them)`);
  await tPage.screenshot({ path: `${OUT}/05-admin-mode-with-cp_pid.png`, fullPage: true });

  // ---------- start race (admin UI)
  await admin.getByRole("button", { name: "라이브", exact: true }).click();
  await admin.getByRole("button", { name: "레이스 시작" }).click();
  await admin.getByRole("button", { name: "레이스 종료" }).waitFor();

  // ---------- participant A: SUN URL before joining (AC2)
  const aCtx = await browser.newContext(mobile);
  const a = await aCtx.newPage();
  instrument(a, "A");
  const aFirst = sun(U1, 30);
  await a.goto(tUrl(aFirst));
  await a.waitForURL(`${BASE}/`);
  const pending = await a.evaluate(() => sessionStorage.getItem("pendingTag"));
  step(pending === JSON.stringify({ e: aFirst.e, c: aFirst.c }), "AC2 no participant -> pending SUN stored, redirected to /");
  await a.getByPlaceholder("DEMO01").fill(CODE);
  await a.getByLabel("내 이름").fill("브라우저A");
  await a.getByRole("button", { name: "레이스 참가" }).click();
  await a.waitForURL(`${BASE}/race`);
  await a.getByPlaceholder("팀 이름").fill("[TEST] 팀A");
  await a.getByRole("button", { name: "팀장으로 시작" }).click();
  await expectVisible(a, a.getByText("T1 출발 태깅 완료"), "AC2 pending SUN submitted after team create -> overlay", 8000, "06-a-pending-submitted");
  await a.getByRole("button", { name: "이동하기" }).click();
  step(await a.getByText("1/3").isVisible(), "AC2 progress 1/3");
  step(tagPosts.get("A") === 1, `AC2 pending submitted exactly once (POST /api/tag x${tagPosts.get("A")})`);
  step((await a.evaluate(() => sessionStorage.getItem("pendingTag"))) === null, "AC2 pendingTag cleared");
  step((await a.getByPlaceholder("태그 코드 / URL").count()) === 0, "AC3 /race has no manual tag input");
  const joinCode = (await a.getByText(/참가 코드/).textContent()).match(/참가 코드 (\w+)/)[1];

  // teammate A2 keeps /race open (polling regression)
  const a2Ctx = await browser.newContext(mobile);
  const a2 = await a2Ctx.newPage();
  await a2.goto(`${BASE}/join/${CODE}`);
  await a2.getByLabel("내 이름").fill("브라우저A2");
  await a2.getByRole("button", { name: "레이스 참가" }).click();
  await a2.waitForURL(`${BASE}/race`);
  await a2.getByRole("button", { name: "코드로 참가" }).click();
  await a2.getByPlaceholder("팀 코드 4자리").fill(joinCode);
  await a2.getByRole("button", { name: "팀에 들어가기" }).click();
  await expectVisible(a2, a2.getByText("1/3"), "A2 joined team A, sees 1/3");

  // AC1: in-order tag through /t -> /race with overlay; A2 sees it via polling
  const aSecond = sun(U2, 31);
  const tagAt = Date.now();
  await a.goto(tUrl(aSecond));
  await a.waitForURL(`${BASE}/race`);
  await expectVisible(a, a.getByText("T2 중간 태깅 완료"), "AC1 /t records next checkpoint -> /race success overlay", 8000, "07-a-overlay-after-t");
  await a.getByRole("button", { name: "이동하기" }).click();
  step(await a.getByText("2/3").isVisible(), "AC1 progress 2/3");
  const polled = await visible(a2.getByText("2/3"), POLL_BUDGET);
  step(polled !== null, `regression: A2 (/race, no reload) shows 2/3 via polling ${Date.now() - tagAt} ms after tag`);
  // admin live panel updates via realtime (TODO-002 regression)
  await expectVisible(admin, admin.getByText("[TEST] 팀A"), "regression: admin live panel shows team A without reload", RT_BUDGET);
  await expectVisible(admin, admin.getByText("2/3"), "regression: admin live panel shows 2/3 without reload", RT_BUDGET);
  // AC1: reopening the same URL -> already used, no advance
  const postsBefore = tagPosts.get("A");
  await a.goto(tUrl(aSecond));
  await expectVisible(a, a.getByText("이미 사용된 태그 URL입니다. 태그를 다시 찍어 주세요."), "AC1 reopening same URL -> already used", 8000, "08-a-reused-url");
  step(tagPosts.get("A") - postsBefore === 1, `Strict Mode: /t submitted once (${tagPosts.get("A") - postsBefore})`);
  // pre-baseline URL
  await a.goto(tUrl(sun(U3, 5)));
  await expectVisible(a, a.getByText("기준 갱신 이전에 읽힌 태그 URL입니다. 태그를 다시 찍어 주세요."), "pre-baseline URL -> error");
  // AC3 static token URL
  const p3 = tagPosts.get("A");
  await a.goto(`${BASE}/t/${t3.token}`);
  await expectVisible(a, a.getByText("SUN 정보가 없는 태그입니다. 관리자에게 문의해 주세요."), "AC3 static /t/{token} -> no SUN info, not recorded", 8000, "09-a-static-token");
  step(tagPosts.get("A") === p3, "AC3 static token URL sent no POST /api/tag");
  await a.goto(`${BASE}/race`);
  await expectVisible(a, a.getByText("2/3"), "still 2/3 after reused / pre-baseline / static URLs");

  // second team with fresh counters advances independently
  const bCtx = await browser.newContext(mobile);
  const b = await bCtx.newPage();
  await b.goto(`${BASE}/join/${CODE}`);
  await b.getByLabel("내 이름").fill("브라우저B");
  await b.getByRole("button", { name: "레이스 참가" }).click();
  await b.waitForURL(`${BASE}/race`);
  await b.getByPlaceholder("팀 이름").fill("[TEST] 팀B");
  await b.getByRole("button", { name: "팀장으로 시작" }).click();
  await b.getByText("0/3").waitFor();
  await b.goto(tUrl(sun(U1, 40)));
  await expectVisible(b, b.getByText("T1 출발 태깅 완료"), "second team fresh URL -> T1 recorded");
  await b.getByRole("button", { name: "이동하기" }).click();
  step(await b.getByText("1/3").isVisible(), "team B 1/3 (independent of team A)");

  // A finishes
  await a.goto(tUrl(sun(U3, 41)));
  await expectVisible(a, a.getByText("완주!"), "A final checkpoint -> 완주 overlay", 8000, "10-a-finished");
  await a.getByRole("button", { name: "이동하기" }).click();
  step(await a.getByText("기록 확정").isVisible(), "A shows 기록 확정");
  await expectVisible(a2, a2.getByText("기록 확정"), "regression: A2 sees 기록 확정 via polling", POLL_BUDGET);
  await admin.getByRole("button", { name: "라이브", exact: true }).click();
  await expectVisible(admin, admin.getByText("1위 · 2명"), "regression: admin live shows team A rank 1 without reload", RT_BUDGET, "11-admin-live-after-finish");
  // admin NFC tab after the race still shows registration state
  await admin.getByRole("button", { name: "NFC", exact: true }).click();
  await expectVisible(admin, admin.getByTestId("tag-row-1").getByText("기준값 25"), "admin NFC tab reflects baseline refreshed from /t (25)");
  const dbEvents = await countRows("tag_events", { session_id: `eq.${S}`, valid: "is.true" });
  step(dbEvents === 4, `DB valid events in session = 4 (A x3, B x1): ${dbEvents}`);
} catch (err) {
  step(false, `unexpected error: ${String(err.stack ?? err).replace(/[0-9A-Fa-f]{32}/g, "<32hex redacted>")}`);
  await admin.screenshot({ path: `${OUT}/fail-admin.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  for (const id of [S, s2.session.id]) {
    const c = await cleanupSession(setup, id);
    step(c.ok, c.line);
  }
  for (const u of UIDS) {
    const c = await deleteSunCounters(u);
    step(c.after === 0, `cleanup sun_counters ${u}: before=${c.before} after=${c.after}`);
  }
}
console.log(`RESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
