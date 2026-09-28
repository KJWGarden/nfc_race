// TODO-006 browser validation: participant re-join ("다시 들어가기") on / and /join/[code], mismatched-name error,
// duplicate-name team join refusal, pending SUN URL submitted once after re-join, plus join/team regressions.
// Uses its own "[TEST]" session (created via the admin API, deleted in finally) and test UIDs 04C0FFEE00004x.
// Run from the scratchpad (playwright-core lives here), app env in the process:
//   node browser-check-006.mjs <outDir>   (CHECK_TARGET=hosted to read Supabase values from .env.local)
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import {
  TARGET,
  adminClient,
  cleanupSession,
  countRows,
  createTestSession,
  deleteSunCounters,
  sun,
} from "/Users/kimgarden/dev/nfc-walk-race/.ai/tasks/active/TASK-20260927-001/evidence/TODO-003/sun-lib.mjs";

const BASE = "http://127.0.0.1:3000";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const U1 = "04C0FFEE000041";
const U2 = "04C0FFEE000042";
const U3 = "04C0FFEE000043";
const tUrl = (p) => `${BASE}/t/s?e=${p.e}&c=${p.c}`;
const DUP = "같은 이름의 팀원이 이미 있습니다. 쿠키를 잃었다면 '다시 들어가기'를 이용해 주세요.";

let failures = 0;
function step(ok, text) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${text}`);
}
async function visible(locator, timeout = 8000) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}
async function onPath(page, path, timeout = 10000) {
  await page.waitForURL((u) => new URL(u).pathname === path, { timeout }).catch(() => {});
  return new URL(page.url()).pathname === path;
}
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

console.log(`browser-check-006 target=${TARGET} at ${new Date().toISOString()}`);
for (const u of [U1, U2, U3]) await deleteSunCounters(u);
const admin = await adminClient();
const { session, tags } = await createTestSession(admin, "rejoin browser", ["R1 출발", "R2 중간", "R3 도착"]);
const S = session.id;
const CODE = session.code;
const browser = await chromium.launch();
try {
  for (const [t, u] of [[tags[0], U1], [tags[1], U2], [tags[2], U3]]) {
    await admin.req(`/api/admin/sessions/${S}/tags/${t.id}/sun`, { method: "POST", body: sun(u, 10) });
  }
  await admin.req(`/api/admin/sessions/${S}`, { method: "PATCH", body: { status: "live" } });
  const mobile = { viewport: { width: 390, height: 844 } };

  // 1. regression: normal join on / and team create
  const ctx = await browser.newContext(mobile);
  const page = await ctx.newPage();
  const tagPosts = [];
  page.on("request", (r) => r.url().endsWith("/api/tag") && r.method() === "POST" && tagPosts.push(r.url()));
  await page.goto(`${BASE}/`);
  step(await visible(page.getByRole("tab", { name: "새로 참가" })), "1. / shows the '새로 참가' / '다시 들어가기' switch (new-join selected)");
  await page.getByLabel("세션 코드").fill(CODE);
  await page.getByLabel("내 이름").fill("Kim Lee");
  await page.getByRole("button", { name: "레이스 참가" }).click();
  step((await onPath(page, "/race")) && (await visible(page.getByRole("heading", { name: "팀을 선택하세요" }))), "1.1 new join -> /race team gate");
  await page.getByPlaceholder("팀 이름").fill("[TEST] 재입장 브라우저팀");
  await page.getByRole("button", { name: "팀장으로 시작" }).click();
  step(await visible(page.getByRole("heading", { name: "[TEST] 재입장 브라우저팀" })), "1.2 team created -> race view with team name");
  const me0 = await page.evaluate(() => fetch("/api/me").then((r) => r.json()));
  const TEAM = me0.data.team.joinCode;
  const pid = me0.data.participant.id;

  // 2. tag R1 so there is progress to restore
  await page.goto(tUrl(sun(U1, 11)));
  step((await onPath(page, "/race")) && (await visible(page.getByRole("heading", { name: "R1 출발 태깅 완료" }))), "2. /t records R1 -> overlay 'R1 출발 태깅 완료'");
  await page.getByRole("button", { name: "이동하기" }).click();
  step(await visible(page.getByText("1/3")), "2.1 progress 1/3");

  // 3. regression: second member joins by code through the UI
  const ctxB = await browser.newContext(mobile);
  const b = await ctxB.newPage();
  await b.goto(`${BASE}/join/${CODE}`);
  await b.getByLabel("내 이름").fill("박 민수");
  await b.getByRole("button", { name: "레이스 참가" }).click();
  await onPath(b, "/race");
  await b.getByRole("button", { name: "코드로 참가" }).click();
  await b.getByPlaceholder("팀 코드 4자리").fill(TEAM);
  await b.getByRole("button", { name: "팀에 들어가기" }).click();
  step(await visible(b.getByRole("heading", { name: "[TEST] 재입장 브라우저팀" })), "3. member B joins the team by code (UI) -> race view");

  // 4. cookies lost -> /race sends to / -> re-join with a differently spaced/cased name
  const rowsBefore = await countRows("participants", { session_id: `eq.${S}` });
  await ctx.clearCookies();
  await page.goto(`${BASE}/race`);
  step(await onPath(page, "/"), "4. cookies cleared -> /race redirects to /");
  await page.getByRole("tab", { name: "다시 들어가기" }).click();
  step(await visible(page.getByText("팀에 들어갔던 참가자만 다시 들어갈 수 있습니다.")), "4.1 re-join mode shows the team-less note");
  await page.getByLabel("세션 코드").fill(CODE);
  await page.getByLabel("팀 코드").fill(TEAM);
  await page.getByLabel("내 이름").fill("  kim   LEE ");
  await shot(page, "01-rejoin-form-home");
  await page.getByRole("button", { name: "기존 참가자로 입장" }).click();
  step(await onPath(page, "/race"), "4.2 re-join -> /race");
  step(
    (await visible(page.getByRole("heading", { name: "[TEST] 재입장 브라우저팀" }))) && (await visible(page.getByText("1/3"))),
    "4.3 same team and progress 1/3",
  );
  const me1 = await page.evaluate(() => fetch("/api/me").then((r) => r.json()));
  step(me1.data.participant.id === pid && me1.data.participant.isLeader === true, "4.4 same participant id, still 팀장 (leader)");
  step(await visible(page.locator("li", { hasText: "Kim Lee" }).getByText("팀장")), "4.5 member list shows Kim Lee as 팀장");
  const rowsAfter = await countRows("participants", { session_id: `eq.${S}` });
  step(rowsBefore === rowsAfter && rowsAfter === 2, `4.6 participant rows unchanged (${rowsBefore} -> ${rowsAfter})`);
  await shot(page, "02-race-after-rejoin");

  // 5. /join/[code]: prefilled session code, mismatched name -> generic error, no cookie; then correct re-join
  const ctxC = await browser.newContext(mobile);
  const c = await ctxC.newPage();
  await c.goto(`${BASE}/join/${CODE}`);
  await c.getByRole("tab", { name: "다시 들어가기" }).click();
  step((await c.getByLabel("세션 코드").inputValue()) === CODE, "5. /join/[code] re-join mode has the session code prefilled");
  await c.getByLabel("팀 코드").fill(TEAM);
  await c.getByLabel("내 이름").fill("없는 사람");
  await c.getByRole("button", { name: "기존 참가자로 입장" }).click();
  step(await visible(c.getByText("일치하는 팀원을 찾을 수 없습니다.")), "5.1 mismatched name -> '일치하는 팀원을 찾을 수 없습니다.'");
  step(new URL(c.url()).pathname === `/join/${CODE}` && !(await ctxC.cookies()).some((k) => k.name === "cp_pid"), "5.2 stays on /join/[code], no cp_pid cookie");
  await shot(c, "03-rejoin-mismatch");
  await c.getByLabel("내 이름").fill("박 민수");
  await c.getByRole("button", { name: "기존 참가자로 입장" }).click();
  step((await onPath(c, "/race")) && (await visible(c.getByRole("heading", { name: "[TEST] 재입장 브라우저팀" }))), "5.3 correct name via /join/[code] -> /race same team (B)");

  // 6. duplicate normalized name joining the team -> refused with the '다시 들어가기' hint
  const ctxD = await browser.newContext(mobile);
  const d = await ctxD.newPage();
  await d.goto(`${BASE}/join/${CODE}`);
  await d.getByLabel("내 이름").fill("KIM LEE");
  await d.getByRole("button", { name: "레이스 참가" }).click();
  await onPath(d, "/race");
  await d.getByRole("button", { name: "코드로 참가" }).click();
  await d.getByPlaceholder("팀 코드 4자리").fill(TEAM);
  await d.getByRole("button", { name: "팀에 들어가기" }).click();
  step(await visible(d.getByText(DUP)), "6. same normalized name joining the team -> duplicate message pointing to '다시 들어가기'");
  step(await visible(d.getByRole("heading", { name: "팀을 선택하세요" })), "6.1 still on the team gate (not joined)");
  await shot(d, "04-duplicate-name-refused");

  // 7. pending SUN: no cookie -> /t stores it and goes to / -> re-join -> /race submits once and advances
  await ctx.clearCookies();
  tagPosts.length = 0;
  await page.goto(tUrl(sun(U2, 11)));
  step(await onPath(page, "/"), "7. SUN URL opened without cookie -> redirected to /");
  const stored = await page.evaluate(() => sessionStorage.getItem("pendingTag"));
  step(!!stored && stored.startsWith("{"), "7.1 pending SUN payload stored (JSON)");
  await page.getByRole("tab", { name: "다시 들어가기" }).click();
  await page.getByLabel("세션 코드").fill(CODE);
  await page.getByLabel("팀 코드").fill(TEAM);
  await page.getByLabel("내 이름").fill("Kim Lee");
  await page.getByRole("button", { name: "기존 참가자로 입장" }).click();
  step((await onPath(page, "/race")) && (await visible(page.getByRole("heading", { name: "R2 중간 태깅 완료" }))), "7.2 after re-join -> overlay 'R2 중간 태깅 완료'");
  await shot(page, "05-pending-sun-after-rejoin");
  await page.getByRole("button", { name: "이동하기" }).click();
  step(await visible(page.getByText("2/3")), "7.3 team progress 2/3");
  step(tagPosts.length === 1, `7.4 exactly one POST /api/tag (${tagPosts.length})`);
  step((await page.evaluate(() => sessionStorage.getItem("pendingTag"))) === null, "7.5 pendingTag cleared");
  const valid = await countRows("tag_events", { session_id: `eq.${S}`, valid: "is.true" });
  step(valid === 2, `7.6 DB: 2 valid tag events for the session (${valid})`);
  await page.reload();
  await visible(page.getByText("2/3"));
  step(tagPosts.length === 1, `7.7 reload does not resubmit (${tagPosts.length} POST)`);
  const rowsEnd = await countRows("participants", { session_id: `eq.${S}` });
  step(rowsEnd === 3, `7.8 participant rows = 3 (A, B, refused D); re-joins created none (${rowsEnd})`);
} finally {
  await browser.close();
  const cl = await cleanupSession(admin, S);
  step(cl.ok, cl.line);
  for (const u of [U1, U2, U3]) {
    const r = await deleteSunCounters(u);
    step(r.after === 0, `cleanup sun_counters ${u} before=${r.before} after=${r.after}`);
  }
}
console.log(`\nRESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
