// TODO-002 browser validation against hosted Supabase: participant polling + admin-only Realtime (plus TODO-001 regression).
// Uses its own "[TEST]" session created through the admin API; the session is deleted in finally.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { env, adminClient, createTestSession, cleanupSession } from "./hosted-lib.mjs";

const BASE = "http://127.0.0.1:3000";
const OUT = "/Users/kimgarden/dev/nfc-walk-race/.ai/tasks/active/TASK-20260927-001/runtime/web/TODO-002";
mkdirSync(OUT, { recursive: true });
const ADMIN_PASSWORD = env("ADMIN_PASSWORD");
const POLL_MS = 10_000;
const ADMIN_RT_BUDGET = 5_000; // "within a few seconds"
const POLL_BUDGET = POLL_MS + 2_500; // one polling interval + request/render slack
const setupAdmin = await adminClient();
const { session: testSession, tags: testTags } = await createTestSession(setupAdmin, "TODO-002 browser", [
  "T1 출발",
  "T2 두번째",
  "T3 세번째",
  "T4 완주",
]);
const SID = testSession.id;
const CODE = testSession.code;
const TOKENS = testTags.map((t) => t.token);
const TOPIC = `realtime:cp-admin:${SID}`;
const RT_HOST = `${new URL(env("NEXT_PUBLIC_SUPABASE_URL")).host}/realtime/v1/websocket`;

let failures = 0;
const lines = [];
function step(ok, text) {
  if (!ok) failures++;
  const line = `${ok ? "PASS" : "FAIL"} ${text}`;
  lines.push(line);
  console.log(line);
}
function note(text) {
  lines.push(`NOTE ${text}`);
  console.log(`NOTE ${text}`);
}

// wait until a locator is visible; returns elapsed ms or null
async function timed(locator, timeout) {
  const t0 = Date.now();
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return Date.now() - t0;
  } catch {
    return null;
  }
}
async function expectWithin(page, locator, timeout, label, shot) {
  const ms = await timed(locator, timeout);
  step(ms !== null, `${label} (${ms === null ? `not within ${timeout} ms` : `${ms} ms`})`);
  if (ms === null || shot) await page.screenshot({ path: `${OUT}/${shot ?? `fail-${lines.length}`}.png`, fullPage: true });
  return ms;
}

const browser = await chromium.launch();
const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const mobile = { viewport: { width: 390, height: 844 } };
const aCtx = await browser.newContext(mobile);
const bCtx = await browser.newContext(mobile);
const admin = await adminCtx.newPage();
const ceremony = await adminCtx.newPage();
const a = await aCtx.newPage();
const b = await bCtx.newPage();

// instrumentation: /api/me polls, admin refetches, admin navigations, realtime frames
const meRequests = { a: [], b: [] };
a.on("request", (r) => r.url().endsWith("/api/me") && meRequests.a.push(Date.now()));
b.on("request", (r) => r.url().endsWith("/api/me") && meRequests.b.push(Date.now()));
const adminGets = [];
admin.on("request", (r) => r.method() === "GET" && r.url().endsWith(`/api/admin/sessions/${SID}`) && adminGets.push(Date.now()));
const tokenResponses = [];
for (const p of [admin, ceremony]) p.on("response", (r) => r.url().endsWith("/api/admin/realtime-token") && tokenResponses.push(r.status()));
let adminNavigations = 0;
admin.on("framenavigated", (f) => f === admin.mainFrame() && adminNavigations++);
function trackFrames(page) {
  // per realtime socket: phx_join / phx_leave sent, join replies received, close
  const t = { sockets: [], perSocket: [], joins: 0, leaves: 0, joinOk: 0, broadcasts: 0 };
  page.on("websocket", (ws) => {
    const url = ws.url().replace(/apikey=[^&]+/, "apikey=<redacted>");
    t.sockets.push(url);
    if (!url.includes("/realtime/v1/websocket")) return;
    const sock = { index: t.perSocket.length, joins: 0, leaves: 0, replies: [], closed: false };
    t.perSocket.push(sock);
    ws.on("close", () => (sock.closed = true));
    ws.on("framesent", (f) => {
      const s = String(f.payload);
      if (!s.includes(TOPIC)) return;
      if (s.includes("phx_join")) {
        t.joins++;
        sock.joins++;
      }
      if (s.includes("phx_leave")) {
        t.leaves++;
        sock.leaves++;
      }
    });
    ws.on("framereceived", (f) => {
      const s = String(f.payload);
      if (!s.includes(TOPIC)) return;
      if (s.includes("phx_reply")) {
        const status = /"status":"(\w+)"/.exec(s)?.[1];
        sock.replies.push(status);
        if (status === "ok") t.joinOk++;
      }
      if (s.includes('"broadcast"')) t.broadcasts++;
    });
  });
  return t;
}
// active subscriptions for the topic on sockets that are still open
const activeSubs = (t) => t.perSocket.filter((x) => !x.closed).reduce((n, x) => n + x.joins - x.leaves, 0);
const adminFrames = trackFrames(admin);
const ceremonyFrames = trackFrames(ceremony);
admin.on("dialog", (d) => d.accept());
const stat = (label) => admin.locator(`dt:text-is("${label}") + dd`);
const card = (page, text) => page.getByText(text, { exact: true });
const manual = async (page, value) => {
  await page.getByPlaceholder("태그 코드 / URL").fill(value);
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/tag"));
  await page.getByRole("button", { name: "확인" }).click();
  return (await resp).status();
};
const closeOverlay = async (page) => {
  await page.getByRole("button", { name: "이동하기" }).click();
};

try {
  // ---------- admin setup
  await admin.goto(`${BASE}/admin/login`);
  await admin.getByLabel("관리자 비밀번호").fill(ADMIN_PASSWORD);
  await admin.getByRole("button", { name: "입장" }).click();
  await admin.waitForURL(`${BASE}/admin`);
  note(`test session ${SID} code ${CODE} (${testSession.name})`);
  await admin.getByText(testSession.name).click();
  await admin.waitForURL(`${BASE}/admin/sessions/${SID}`);
  await expectWithin(admin, admin.getByText("실시간 현황"), 10_000, "admin session page loaded");
  const joinDeadline = Date.now() + 10_000;
  while (adminFrames.joinOk < 1 && Date.now() < joinDeadline) await admin.waitForTimeout(100);
  step(adminFrames.joinOk >= 1, `admin page joined private channel ${TOPIC} (phx_reply ok)`);
  const rtSocket = adminFrames.sockets.find((u) => u.includes(RT_HOST));
  step(Boolean(rtSocket), `admin Realtime websocket -> ${rtSocket}`);
  step(activeSubs(adminFrames) === 1, `admin page has exactly one active subscription under React Strict Mode (per socket: ${JSON.stringify(adminFrames.perSocket)})`);

  await ceremony.goto(`${BASE}/admin/sessions/${SID}/ceremony`);
  await expectWithin(ceremony, ceremony.getByText("아직 완주 팀이 없습니다."), 10_000, "ceremony page loaded (no finishers yet)");
  const cDeadline = Date.now() + 10_000;
  while (ceremonyFrames.joinOk < 1 && Date.now() < cDeadline) await ceremony.waitForTimeout(100);
  step(ceremonyFrames.joinOk >= 1, "ceremony page joined private channel");
  step(tokenResponses.length >= 2 && tokenResponses.every((s) => s === 200), `realtime token route responses: ${JSON.stringify(tokenResponses)}`);
  await admin.bringToFront();

  // first announcement (the participant toast only fires when the pinned announcement changes)
  await admin.getByRole("button", { name: "공지", exact: true }).click();
  await admin.getByPlaceholder("예: 3번 지점 우회, 시상식은 5시 정각").fill("첫 공지");
  await admin.getByRole("button", { name: "공지 보내기" }).click();
  await admin.getByText("첫 공지").first().waitFor();
  await admin.getByRole("button", { name: "라이브", exact: true }).click();
  await admin.getByRole("button", { name: "레이스 시작" }).click();
  await admin.getByRole("button", { name: "레이스 종료" }).waitFor();
  const navBaseline = adminNavigations;

  // ---------- AC4: participant join -> admin updates without reload
  await a.goto(BASE);
  await a.getByPlaceholder("DEMO01").fill(CODE);
  await a.getByLabel("내 이름").fill("실시간A");
  const joinClick = Date.now();
  await a.getByRole("button", { name: "레이스 참가" }).click();
  const joinMs = await timed(stat("참가자").filter({ hasText: /^1명$/ }), ADMIN_RT_BUDGET);
  step(joinMs !== null, `AC4 admin 참가자 stat -> 1명 after participant join without reload (${joinMs ?? "timeout"} ms after click; t=${Date.now() - joinClick})`);

  await a.waitForURL(`${BASE}/race`);
  await a.getByPlaceholder("팀 이름").fill("실시간팀");
  await a.getByRole("button", { name: "팀장으로 시작" }).click();
  await expectWithin(admin, card(admin, "실시간팀"), ADMIN_RT_BUDGET, "AC4 admin live panel shows new team 실시간팀 without reload");
  await expectWithin(admin, stat("팀").filter({ hasText: /^1팀$/ }), ADMIN_RT_BUDGET, "AC4 admin 팀 stat -> 1팀");
  const codeText = await a.getByText(/팀원 · 참가 코드/).first().textContent();
  const joinCode = /([0-9A-Z]{4})\s*$/.exec(codeText)[1];

  await b.goto(`${BASE}/join/${CODE}`);
  await b.getByLabel("내 이름").fill("실시간B");
  await b.getByRole("button", { name: "레이스 참가" }).click();
  await expectWithin(admin, stat("참가자").filter({ hasText: /^2명$/ }), ADMIN_RT_BUDGET, "AC4 admin 참가자 stat -> 2명 after second join");
  await b.waitForURL(`${BASE}/race`);
  await b.getByRole("button", { name: "코드로 참가" }).click();
  await b.getByPlaceholder("팀 코드 4자리").fill(joinCode);
  await b.getByRole("button", { name: "팀에 들어가기" }).click();
  await expectWithin(admin, admin.getByText("1위 · 2명"), ADMIN_RT_BUDGET, "AC4 admin live panel shows team with 2 members after team join");
  await b.getByText("0/4").first().waitFor();

  // ---------- AC2 polling: teammate's tag appears on B without reload
  step((await manual(a, TOKENS[0])) === 200, "A tags T1 -> 200");
  const tagAt = Date.now();
  await expectWithin(admin, admin.locator("article", { hasText: "실시간팀" }).getByText("1/4"), ADMIN_RT_BUDGET, "AC4 admin live panel progress 1/4 after tag");
  await expectWithin(admin, stat("진행중").filter({ hasText: /^1팀$/ }), ADMIN_RT_BUDGET, "AC4 admin 진행중 stat -> 1팀");
  const bMs = await timed(b.getByText("1/4", { exact: true }), POLL_BUDGET + 2_000);
  step(bMs !== null && Date.now() - tagAt <= POLL_BUDGET, `AC2 B (/race, no reload) shows 1/4 via polling ${Date.now() - tagAt} ms after A's tag (budget ${POLL_BUDGET} ms)`);
  await b.screenshot({ path: `${OUT}/01-b-polled-teammate-tag.png`, fullPage: true });
  await admin.screenshot({ path: `${OUT}/02-admin-live-realtime.png`, fullPage: true });
  await closeOverlay(a);

  // polling cadence while visible
  const bVisible = meRequests.b.filter((t) => t >= tagAt - POLL_MS);
  const gaps = bVisible.slice(1).map((t, i) => t - bVisible[i]);
  note(`B /api/me request gaps while visible (ms): ${JSON.stringify(gaps)}`);

  // ---------- AC2 announcement toast
  await admin.getByRole("button", { name: "공지", exact: true }).click();
  await admin.getByPlaceholder("예: 3번 지점 우회, 시상식은 5시 정각").fill("실시간 공지 테스트");
  const annAt = Date.now();
  await admin.getByRole("button", { name: "공지 보내기" }).click();
  const toastA = await timed(a.getByText("새 공지"), POLL_BUDGET);
  const toastB = await timed(b.getByText("새 공지"), POLL_BUDGET);
  step(toastA !== null && toastA <= POLL_BUDGET + 500, `AC2 A shows 새 공지 toast (${toastA} ms after post)`);
  const toastTotal = Date.now() - annAt;
  step(toastB !== null && toastTotal <= POLL_BUDGET + 500, `AC2 B shows 새 공지 toast (${toastTotal} ms after post; budget ${POLL_BUDGET + 500} ms)`);
  step((await a.locator("div.bg-terra", { hasText: "실시간 공지 테스트" }).count()) === 1, "toast carries the new announcement message");
  await a.screenshot({ path: `${OUT}/03-a-announcement-toast.png`, fullPage: true });
  await admin.getByRole("button", { name: "라이브", exact: true }).click();

  // ---------- AC3 hidden pause / visible resume (visibility simulated, see report)
  await b.evaluate(() => {
    window.__vis = "hidden";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__vis });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__vis === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenAt = Date.now();
  const beforeHidden = meRequests.b.length;
  await b.waitForTimeout(2 * POLL_MS + 1_000); // measurement window: absence of polls over 2+ intervals
  const duringHidden = meRequests.b.length - beforeHidden;
  step(duringHidden === 0, `AC3 no /api/me requests from B while hidden for ${Date.now() - hiddenAt} ms (count=${duringHidden})`);
  const visibleReq = b.waitForRequest((r) => r.url().endsWith("/api/me"), { timeout: 2_000 });
  const visAt = Date.now();
  await b.evaluate(() => {
    window.__vis = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const got = await visibleReq.then(() => Date.now() - visAt).catch(() => null);
  step(got !== null && got < 1_000, `AC3 immediate /api/me on becoming visible (${got} ms)`);
  const resumeReq = await b.waitForRequest((r) => r.url().endsWith("/api/me"), { timeout: POLL_MS + 2_000 }).then(() => Date.now() - visAt).catch(() => null);
  step(resumeReq !== null && resumeReq >= POLL_MS - 500, `AC3 polling resumed: next /api/me ${resumeReq} ms after visible`);

  // ---------- TODO-001 regression: errors and team-level recording
  step((await manual(b, TOKENS[2])) === 400, "regression: B out-of-order T3 -> 400");
  await expectWithin(b, b.getByText(`순서가 아닙니다. 다음 지점은 "${testTags[1].name}" 입니다.`), 5_000, "regression: out-of-order message shown");
  step((await manual(b, TOKENS[0])) === 400, "regression: B duplicate T1 (tagged by A) -> 400");
  await expectWithin(b, b.getByText("이미 태깅한 지점입니다."), 5_000, "regression: duplicate message shown");

  step((await manual(b, TOKENS[1])) === 200, "B tags T2 -> 200");
  await closeOverlay(b);
  step((await manual(b, TOKENS[2])) === 200, "B tags T3 -> 200");
  await closeOverlay(b);
  step((await manual(b, TOKENS[3])) === 200, "B tags T4 -> 200 (finish)");
  const finishAt = Date.now();
  await expectWithin(b, b.getByText("완주!"), 5_000, "B sees 완주! overlay");
  await closeOverlay(b);
  await expectWithin(admin, stat("완주").filter({ hasText: /^1팀$/ }), ADMIN_RT_BUDGET, "AC4 admin 완주 stat -> 1팀 without reload");
  const cerMs = await timed(ceremony.getByRole("button", { name: "1등 공개" }), ADMIN_RT_BUDGET);
  step(cerMs !== null, `AC4 ceremony shows "1등 공개" after team finishes, without reload (${Date.now() - finishAt} ms after finish)`);
  await ceremony.screenshot({ path: `${OUT}/04-ceremony-after-finish.png`, fullPage: true });
  const aFin = await timed(a.getByText("기록 확정"), POLL_BUDGET);
  step(aFin !== null, `AC2 A (no reload) shows 기록 확정 via polling (${Date.now() - finishAt} ms after finish)`);
  await a.screenshot({ path: `${OUT}/05-a-polled-finish.png`, fullPage: true });
  step(adminNavigations === navBaseline, `admin page never reloaded during participant actions (main-frame navigations since start: ${adminNavigations - navBaseline})`);
  await admin.screenshot({ path: `${OUT}/06-admin-finished.png`, fullPage: true });

  // ---------- AC7 navigate away and back: no duplicate subscription
  await admin.getByRole("link", { name: "← 세션 목록" }).click();
  await admin.waitForURL(`${BASE}/admin`);
  const leaveDeadline = Date.now() + 5_000;
  while (adminFrames.leaves < 1 && Date.now() < leaveDeadline) await admin.waitForTimeout(100);
  step(adminFrames.leaves >= 1, `AC7 channel left after navigating away (phx_leave=${adminFrames.leaves})`);
  await admin.getByText(testSession.name).click();
  await admin.waitForURL(`${BASE}/admin/sessions/${SID}`);
  const rejoinDeadline = Date.now() + 10_000;
  while (adminFrames.joinOk < 2 && Date.now() < rejoinDeadline) await admin.waitForTimeout(100);
  await admin.getByText("실시간팀").first().waitFor();
  step(activeSubs(adminFrames) === 1, `AC7 exactly one active subscription after returning (per socket: ${JSON.stringify(adminFrames.perSocket)})`);
  // one DB change -> exactly one debounced admin refetch
  const settle = adminGets.length;
  await admin.waitForTimeout(1_500); // let the post-join catch-up refetch finish before counting
  const base = adminGets.length;
  await setupAdmin.req(`/api/admin/sessions/${SID}`, { method: "PATCH", body: { description: "automated check; safe to delete" } });
  const refetchDeadline = Date.now() + 5_000;
  while (adminGets.length < base + 1 && Date.now() < refetchDeadline) await admin.waitForTimeout(100);
  await admin.waitForTimeout(1_500); // window for a duplicate refetch to show up
  step(adminGets.length - base === 1, `AC7 one DB change -> exactly one admin refetch (got ${adminGets.length - base}; catch-up refetches after rejoin: ${base - settle})`);
} catch (err) {
  step(false, `unexpected error: ${String(err.message).split("\n")[0]}`);
  for (const [n, p] of [["admin", admin], ["ceremony", ceremony], ["a", a], ["b", b]]) {
    await p.screenshot({ path: `${OUT}/error-${n}.png`, fullPage: true }).catch(() => {});
  }
} finally {
  note(`admin realtime sockets ${JSON.stringify(adminFrames.perSocket)}; ceremony realtime sockets ${JSON.stringify(ceremonyFrames.perSocket)}`);
  await browser.close();
  // always delete the [TEST] session (cascade) and record the evidence
  const cleanup = await cleanupSession(setupAdmin, SID);
  step(cleanup.ok, cleanup.line);
}
lines.push(`\nRESULT failures=${failures}`);
console.log(`\nRESULT failures=${failures}`);
writeFileSync(`${OUT}/browser-check.out.txt`, lines.join("\n") + "\n");
process.exit(failures ? 1 : 0);
