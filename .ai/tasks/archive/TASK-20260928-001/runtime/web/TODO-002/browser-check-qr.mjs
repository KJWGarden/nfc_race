// TODO-002 browser validation (TASK-20260928-001): admin static-URL switch + URL/copy/QR, participant static /t/{token}
// flows (direct, pending without cookie, pending without team), switch-off and admin read-only views, SUN unaffected,
// no tokens in participant UI/data. LOCAL stack only; "[TEST]" sessions created via the admin API and deleted in finally.
// Run from the scratchpad (playwright-core lives here): node browser-check-qr.mjs [outDir]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import jsQR from "jsqr";
import {
  TARGET,
  Client,
  env,
  adminClient,
  cleanupSession,
  countRows,
  createTestSession,
  deleteSunCounters,
  participant,
  selectRows,
  sun,
} from "/Users/kimgarden/dev/nfc-walk-race/.ai/tasks/archive/TASK-20260927-001/evidence/TODO-003/sun-lib.mjs";

if (TARGET !== "local") throw new Error("TODO-002 browser check runs on the local stack only");
const BASE = "http://127.0.0.1:3000";
const OUT =
  process.argv[2] ?? "/Users/kimgarden/dev/nfc-walk-race/.ai/tasks/active/TASK-20260928-001/runtime/web/TODO-002";
mkdirSync(OUT, { recursive: true });
const U1 = "04C0FFEE000031";
const NO_SUN = "SUN 정보가 없는 태그입니다. 관리자에게 문의해 주세요.";

let failures = 0;
function step(ok, text) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${text}`);
}
async function visible(locator, timeout = 10000) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}
async function expectVisible(page, locator, label, shot, timeout) {
  const ok = await visible(locator, timeout);
  step(ok, label);
  if (!ok || shot) await page.screenshot({ path: `${OUT}/${shot ?? `fail-${Date.now()}`}.png`, fullPage: true });
  return ok;
}
// counts POST /api/tag requests made by a page
function tagPostCounter(page) {
  const counter = { n: 0 };
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/tag") counter.n++;
  });
  return counter;
}
const pending = (page) => page.evaluate(() => sessionStorage.getItem("pendingTag"));
async function withCookies(ctx, client) {
  await ctx.addCookies([...client.cookies].map(([name, value]) => ({ name, value, url: BASE })));
}
async function teamIdOf(client) {
  return (await client.req("/api/me")).json.data.team?.id;
}
const validFor = (teamId, tagId) =>
  countRows("tag_events", { team_id: `eq.${teamId}`, tag_id: `eq.${tagId}`, valid: "is.true" });
// decode the rendered QR <img> (pixels read in the page via canvas, decoded with jsQR)
async function decodeQr(img) {
  const px = await img.evaluate(async (el) => {
    await el.decode();
    const canvas = document.createElement("canvas");
    canvas.width = el.naturalWidth;
    canvas.height = el.naturalHeight;
    const g = canvas.getContext("2d");
    g.drawImage(el, 0, 0);
    const d = g.getImageData(0, 0, canvas.width, canvas.height);
    return { w: d.width, h: d.height, data: Array.from(d.data) };
  });
  return jsQR(Uint8ClampedArray.from(px.data), px.w, px.h)?.data ?? null;
}

console.log(`target=${TARGET} at ${new Date().toISOString()}`);
await deleteSunCounters(U1);
const setup = await adminClient();
const on = await createTestSession(setup, "QR on", ["P1 출발", "P2 중간", "P3 도착"]);
const off = await createTestSession(setup, "QR off", ["Q1 오프"]);
const S = on.session.id;
const [p1, p2, p3] = on.tags;
const q1 = off.tags[0];
const allTokens = [...on.tags, ...off.tags].map((t) => t.token);

const browser = await chromium.launch();
const mobile = { viewport: { width: 390, height: 844 } };
try {
  // ---------- AC1 / AC2 admin switch, warning, URL / copy / QR ----------
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await adminCtx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const admin = await adminCtx.newPage();
  await admin.goto(`${BASE}/admin/login`);
  await admin.getByLabel("관리자 비밀번호").fill(env("ADMIN_PASSWORD"));
  await admin.getByRole("button", { name: "입장" }).click();
  await admin.waitForURL(`${BASE}/admin`);
  const openNfc = async (id) => {
    await admin.goto(`${BASE}/admin/sessions/${id}`);
    await admin.getByRole("button", { name: "NFC", exact: true }).click();
    await admin.getByText("NFC 지점", { exact: true }).waitFor();
  };
  const staticSwitch = admin.getByLabel("고정 QR/URL 허용 (이 세션)");
  const staticUrls = admin.locator('[data-testid^="static-url-"]');

  await openNfc(S);
  step(!(await staticSwitch.isChecked()), "AC1 new session: switch unchecked (default off)");
  await expectVisible(admin, admin.getByTestId("static-warning").getByText("복사·공유 방지가 없어집니다"), "AC1 warning visible next to the switch while off");
  step((await staticUrls.count()) === 0 && (await admin.locator('img[alt="1. P1 출발"]').count()) === 0, "AC2 off: 0 static URLs / QR rendered");
  await admin.screenshot({ path: `${OUT}/01-admin-switch-off.png`, fullPage: true });

  // the checkbox reflects saved server state, so it flips after the PATCH + refresh (click, then assert the result)
  await staticSwitch.click();
  await expectVisible(admin, admin.getByTestId("static-url-3"), "AC1 switch on -> static URL rows appear");
  step(await staticSwitch.isChecked(), "AC1 switch shows checked after saving");
  await admin.reload();
  await admin.getByRole("button", { name: "NFC", exact: true }).click();
  await admin.getByTestId("static-url-1").waitFor();
  step(await staticSwitch.isChecked(), "AC1 switch state persists across reload (checked)");
  step((await selectRows("sessions", { id: `eq.${S}` }, "allow_static_url"))[0].allow_static_url === true, "AC1 DB sessions.allow_static_url = true");
  await expectVisible(admin, admin.getByTestId("static-warning"), "AC1 warning visible while on");
  for (const t of on.tags) {
    const url = `${BASE}/t/${t.token}`;
    const text = (await admin.getByTestId(`static-url-${t.order}`).textContent())?.trim();
    const row = admin.getByTestId(`tag-row-${t.order}`);
    const img = row.locator(`img[alt="${t.order}. ${t.name}"]`);
    await img.waitFor();
    const decoded = await decodeQr(img);
    step(text === url, `AC2 row ${t.order} shows ${url}`);
    step(decoded === url, `AC2 row ${t.order} QR decodes to exactly that URL (decoded=${decoded})`);
  }
  await admin.getByTestId("tag-row-1").getByRole("button", { name: "URL 복사" }).click();
  await admin.getByTestId("tag-row-1").getByRole("button", { name: "복사됨" }).waitFor();
  const clip = await admin.evaluate(() => navigator.clipboard.readText());
  step(clip === `${BASE}/t/${p1.token}`, "AC2 copy control puts the row URL on the clipboard");
  await admin.getByTestId("tag-row-1").scrollIntoViewIfNeeded();
  await admin.screenshot({ path: `${OUT}/02-admin-switch-on-url-qr.png`, fullPage: true });

  await staticSwitch.click();
  await staticUrls.first().waitFor({ state: "detached" });
  step((await staticUrls.count()) === 0 && (await selectRows("sessions", { id: `eq.${S}` }, "allow_static_url"))[0].allow_static_url === false, "AC1/AC2 switch off again -> 0 URLs, DB false");
  await staticSwitch.click();
  await admin.getByTestId("static-url-1").waitFor();
  await openNfc(off.session.id);
  step(!(await staticSwitch.isChecked()) && (await staticUrls.count()) === 0, "AC2 other (off) session NFC tab: unchecked, 0 static URLs");

  for (const id of [S, off.session.id]) {
    const r = await setup.req(`/api/admin/sessions/${id}`, { method: "PATCH", body: { status: "live" } });
    step(r.status === 200 && r.json.data.status === "live", `setup: session ${id} live`);
  }

  // ---------- AC3 switch-on participant with a team ----------
  const a = await participant(on.session.code, "참가A", { create: "A팀" });
  const aTeam = await teamIdOf(a);
  const aCtx = await browser.newContext(mobile);
  await withCookies(aCtx, a);
  const ap = await aCtx.newPage();
  const aPosts = tagPostCounter(ap);
  await ap.goto(`${BASE}/t/${p1.token}`);
  await ap.waitForURL(`${BASE}/race`);
  await expectVisible(ap, ap.getByText(`${p1.name} 태깅 완료`), "AC3 /t/{P1} -> /race success overlay", "03-participant-static-overlay");
  step(aPosts.n === 1 && (await validFor(aTeam, p1.id)) === 1, `AC3 exactly 1 POST /api/tag, P1 credited (posts=${aPosts.n})`);
  await ap.goto(`${BASE}/t/${p3.token}`);
  await expectVisible(ap, ap.getByText(`순서가 아닙니다. 다음 지점은 "${p2.name}" 입니다.`), "AC3 wrong-order token -> server message on landing", "04-participant-wrong-order");
  await ap.goto(`${BASE}/t/${p1.token}`);
  await expectVisible(ap, ap.getByText("이미 태깅한 지점입니다."), "AC3 duplicate token -> server message");
  step(aPosts.n === 3 && (await validFor(aTeam, p3.id)) === 0, `AC3 wrong-order/duplicate credited nothing (posts=${aPosts.n})`);

  // ---------- AC4 pending: no cookie -> "/" -> join -> team -> exactly one submission ----------
  const bCtx = await browser.newContext(mobile);
  const bp = await bCtx.newPage();
  const bPosts = tagPostCounter(bp);
  await bp.goto(`${BASE}/t/${p1.token}`);
  await bp.waitForURL(`${BASE}/`);
  step((await pending(bp)) === JSON.stringify({ token: p1.token }) && bPosts.n === 0, `AC4 no cookie -> "/" with pendingTag {"token":…}, 0 POSTs (pending=${await pending(bp)})`);
  await bp.getByLabel("세션 코드").fill(on.session.code);
  await bp.getByLabel("내 이름").fill("참가B");
  await bp.getByRole("button", { name: "레이스 참가" }).click();
  await bp.getByPlaceholder("팀 이름").fill("B팀");
  step(bPosts.n === 0, "AC4 no submission before a team exists");
  await bp.getByRole("button", { name: "팀장으로 시작" }).click();
  await expectVisible(bp, bp.getByText(`${p1.name} 태깅 완료`), "AC4 after creating a team, /race submits the pending token (overlay)", "05-pending-no-cookie-submitted");
  await bp.reload();
  await bp.getByText("팀을 선택하세요").or(bp.getByText("B팀")).first().waitFor();
  const bClient = new Client();
  for (const c of await bCtx.cookies()) bClient.cookies.set(c.name, c.value);
  const bTeam = await teamIdOf(bClient);
  step(bPosts.n === 1 && (await pending(bp)) === null && (await validFor(bTeam, p1.id)) === 1, `AC4 exactly 1 POST, pendingTag cleared, P1 credited (posts=${bPosts.n})`);

  // ---------- AC4 pending: cookie without a team -> /race -> join team -> one submission ----------
  const c = await participant(on.session.code, "참가C");
  const cCtx = await browser.newContext(mobile);
  await withCookies(cCtx, c);
  const cp = await cCtx.newPage();
  const cPosts = tagPostCounter(cp);
  await cp.goto(`${BASE}/t/${p1.token}`);
  await cp.waitForURL(`${BASE}/race`);
  await cp.getByText("팀을 선택하세요").waitFor();
  step((await pending(cp)) === JSON.stringify({ token: p1.token }) && cPosts.n === 0, "AC4 cookie without team -> /race team gate, pendingTag set, 0 POSTs");
  await cp.getByRole("button", { name: "코드로 참가" }).click();
  await cp.getByPlaceholder("팀 코드 4자리").fill(a.joinCode);
  await cp.getByRole("button", { name: "팀에 들어가기" }).click();
  // C joined team A which already has P1 -> the one submission is recorded as a duplicate by C.
  // (/race clears the error text on its immediate reload, existing behavior, so the result is asserted in the DB)
  await cp.getByText("A팀").first().waitFor();
  const cId = (await c.req("/api/me")).json.data.participant.id;
  let cEvents = [];
  for (let i = 0; i < 25 && cEvents.length === 0; i++) {
    cEvents = await selectRows("tag_events", { participant_id: `eq.${cId}` }, "tag_id,valid,reason");
    if (cEvents.length === 0) await cp.waitForResponse((r) => r.url().endsWith("/api/tag"), { timeout: 400 }).catch(() => {});
  }
  step(cEvents.length === 1 && cEvents[0].tag_id === p1.id && cEvents[0].reason === "이미 태깅한 지점입니다.", `AC4 after joining team A, the pending token was submitted once (event: ${JSON.stringify(cEvents)})`);
  await cp.reload();
  await cp.getByText("A팀").first().waitFor();
  step(cPosts.n === 1 && (await pending(cp)) === null, `AC4 exactly 1 POST after joining, pendingTag cleared (posts=${cPosts.n})`);

  // ---------- AC5 switch-off session / unknown token ----------
  const d = await participant(off.session.code, "참가D", { create: "D팀" });
  const dCtx = await browser.newContext(mobile);
  await withCookies(dCtx, d);
  const dp = await dCtx.newPage();
  const dPosts = tagPostCounter(dp);
  await dp.goto(`${BASE}/t/${q1.token}`);
  await expectVisible(dp, dp.getByText(NO_SUN), "AC5 switch-off token (participant with team) -> today's SUN text", "06-switch-off-participant");
  await dp.goto(`${BASE}/t/zzzzzzzzzz`);
  await expectVisible(dp, dp.getByText(NO_SUN), "AC5 unknown token -> today's SUN text");
  step(dPosts.n === 0 && (await pending(dp)) === null && (await countRows("tag_events", { session_id: `eq.${off.session.id}` })) === 0, "AC5 0 POSTs, no pendingTag, 0 events");
  const eCtx = await browser.newContext(mobile);
  const ep = await eCtx.newPage();
  const ePosts = tagPostCounter(ep);
  await ep.goto(`${BASE}/t/${q1.token}`);
  await expectVisible(ep, ep.getByText(NO_SUN), "AC5 switch-off token without cookie -> SUN text, stays on /t");
  step(ePosts.n === 0 && (await pending(ep)) === null && new URL(ep.url()).pathname === `/t/${q1.token}`, "AC5 no cookie: 0 POSTs, no pendingTag, no redirect");
  // participant of the switch-on session opening a switch-off token: the token's session decides
  await ap.goto(`${BASE}/t/${q1.token}`);
  await expectVisible(ap, ap.getByText(NO_SUN), "AC5 switch-on participant with a switch-off token -> SUN text, nothing sent");
  step(aPosts.n === 3, `AC5 participant A still 3 POSTs total (posts=${aPosts.n})`);

  // ---------- AC6 admin device (cp_admin, then cp_admin + cp_pid) ----------
  const adminPosts = tagPostCounter(admin);
  await admin.goto(`${BASE}/t/${p1.token}`);
  const info = admin.getByTestId("admin-static-info");
  await expectVisible(admin, info.getByText(`지점 1 ${p1.name}`), "AC6 admin /t/{P1} -> read-only view with checkpoint", "07-admin-static-view");
  step((await info.getByText(on.session.name).count()) === 1 && (await info.getByText("켜짐").count()) === 1, "AC6 view shows session name and switch 켜짐");
  step((await admin.getByText("관리자 모드 — 참가자 태깅은 기록되지 않습니다.").count()) === 1 && (await admin.getByRole("button", { name: "관리자 로그아웃" }).count()) === 1 && (await info.getByRole("link", { name: "세션 관리로 이동" }).getAttribute("href")) === `/admin/sessions/${S}`, "AC6 admin banner, logout button, link to the session");
  await admin.goto(`${BASE}/t/${q1.token}`);
  await expectVisible(admin, admin.getByTestId("admin-static-info").getByText("꺼짐"), "AC6 admin /t/{Q1} shows switch 꺼짐");
  await admin.goto(`${BASE}/t/zzzzzzzzzz`);
  await expectVisible(admin, admin.getByText("등록되지 않은 태그입니다."), "AC6 admin unknown token -> 등록되지 않은 태그");
  await adminCtx.addCookies([{ name: "cp_pid", value: a.cookies.get("cp_pid"), url: BASE }]);
  await admin.goto(`${BASE}/t/${p2.token}`);
  await expectVisible(admin, admin.getByTestId("admin-static-info").getByText(`지점 2 ${p2.name}`), "AC6 admin + cp_pid /t/{P2} -> read-only view", "08-admin-static-with-cp_pid");
  step(adminPosts.n === 0 && (await pending(admin)) === null && (await validFor(aTeam, p2.id)) === 0, `AC6 admin: 0 POST /api/tag, no pendingTag, P2 not credited (posts=${adminPosts.n})`);
  await adminCtx.clearCookies({ name: "cp_pid" });

  // ---------- AC7 SUN unaffected in a switch-on session ----------
  const reg = await setup.req(`/api/admin/sessions/${S}/tags/${p2.id}/sun`, { method: "POST", body: sun(U1, 10) });
  step(reg.status === 200, "setup: P2 registered with SUN U1 baseline 10");
  const s11 = sun(U1, 11);
  await ap.goto(`${BASE}/t/s?e=${s11.e}&c=${s11.c}`);
  await ap.waitForURL(`${BASE}/race`);
  await expectVisible(ap, ap.getByText(`${p2.name} 태깅 완료`), "AC7 SUN URL in switch-on session credits P2 via the SUN landing", "09-sun-in-switch-on-session");
  step((await validFor(aTeam, p2.id)) === 1 && aPosts.n === 4, `AC7 P2 credited by SUN (posts=${aPosts.n})`);
  const s20 = sun(U1, 20);
  await admin.goto(`${BASE}/t/s?e=${s20.e}&c=${s20.c}`);
  await expectVisible(admin, admin.getByRole("heading", { name: "태그 등록 · 기준 갱신" }), "AC7 admin SUN URL -> existing AdminSunPanel");
  await expectVisible(admin, admin.getByText(`지점 2 ${p2.name}`), "AC7 AdminSunPanel inspect lists the P2 binding", "10-admin-sun-panel");
  await admin.goto(`${BASE}/t/s`);
  await expectVisible(admin, admin.getByText("SUN 정보가 없는 태그입니다.", { exact: true }), "AC7 admin /t/s without params -> today's AdminSunPanel text");
  await ap.goto(`${BASE}/t/s`);
  await expectVisible(ap, ap.getByText(NO_SUN), "AC7 participant /t/s without params -> today's text");
  step(adminPosts.n === 0 && aPosts.n === 4, `AC7 no extra POSTs (admin=${adminPosts.n}, A=${aPosts.n})`);

  // ---------- AC8 no tokens in participant UI / data ----------
  await ap.goto(`${BASE}/race`);
  await ap.getByText("A팀").first().waitFor();
  await ap.screenshot({ path: `${OUT}/11-race-no-tokens.png`, fullPage: true });
  const raceHtml = await ap.content();
  const meText = await ap.evaluate(() => fetch("/api/me").then((r) => r.text()));
  const hits = allTokens.filter((t) => raceHtml.includes(t) || meText.includes(t) || meText.includes(t.toUpperCase()));
  step(hits.length === 0, `AC8 /race HTML and /api/me contain none of ${allTokens.length} tag tokens`);
  const landingHtml = await (await fetch(`${BASE}/t/${p3.token}`, { headers: { cookie: "" } })).text();
  step(![p3.name, p1.name, on.session.name, S].some((s) => landingHtml.includes(s)), "AC8 participant /t/{token} HTML has no checkpoint/session name or session id");
} finally {
  await browser.close();
  for (const id of [S, off.session.id]) {
    const r = await cleanupSession(setup, id);
    step(r.ok, r.line);
  }
  const cnt = await deleteSunCounters(U1);
  step(cnt.after === 0, `cleanup sun_counters ${U1} before=${cnt.before} after=${cnt.after}`);
}
console.log(failures === 0 ? "BROWSER_STATUS=PASSED" : `BROWSER_STATUS=FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
