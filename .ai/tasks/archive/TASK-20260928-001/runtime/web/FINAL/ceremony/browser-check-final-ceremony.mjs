// FINAL regression: admin ceremony page over Supabase Realtime (TODO-002) with SUN-only tagging (TODO-004)
// and the TODO-005 guard on the realtime-token route. Own "[TEST]" session, deleted in finally.
// Run from the scratchpad with the app env in the process: node browser-check-final-ceremony.mjs <outDir>
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import {
  TARGET,
  env,
  adminClient,
  cleanupSession,
  createTestSession,
  deleteSunCounters,
  participant,
  sun,
} from "/Users/kimgarden/dev/nfc-walk-race/.ai/tasks/archive/TASK-20260927-001/evidence/TODO-003/sun-lib.mjs";

const BASE = "http://127.0.0.1:3000";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const UIDS = ["04C0FFEE000051", "04C0FFEE000052"];
const RT_BUDGET = 5_000;
let failures = 0;
function step(ok, text) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${text}`);
}
async function visibleMs(locator, timeout) {
  const t0 = Date.now();
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return Date.now() - t0;
  } catch {
    return null;
  }
}

console.log(`browser-check-final-ceremony target=${TARGET} at ${new Date().toISOString()}`);
for (const u of UIDS) await deleteSunCounters(u);
const admin = await adminClient();
const { session, tags } = await createTestSession(admin, "final ceremony", ["C1 출발", "C2 도착"]);
const S = session.id;
const browser = await chromium.launch();
try {
  for (let i = 0; i < tags.length; i++) {
    await admin.req(`/api/admin/sessions/${S}/tags/${tags[i].id}/sun`, { method: "POST", body: sun(UIDS[i], 10) });
  }
  await admin.req(`/api/admin/sessions/${S}`, { method: "PATCH", body: { status: "live" } });
  const team = await participant(session.code, "[TEST] 시상 팀장", { create: "[TEST] 시상팀" });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const tokenStatuses = [];
  page.on("response", (r) => r.url().endsWith("/api/admin/realtime-token") && tokenStatuses.push(r.status()));
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel("관리자 비밀번호").fill(env("ADMIN_PASSWORD"));
  await page.getByRole("button", { name: "입장" }).click();
  await page.waitForURL(`${BASE}/admin`);
  step(true, "1. admin login through /admin/login -> /admin");
  await page.goto(`${BASE}/admin/sessions/${S}/ceremony`);
  step((await visibleMs(page.getByText("아직 완주 팀이 없습니다."), 10_000)) !== null, "2. ceremony page loads: '아직 완주 팀이 없습니다.'");
  await page.waitForResponse((r) => r.url().endsWith("/api/admin/realtime-token")).catch(() => null);
  step(tokenStatuses.length >= 1 && tokenStatuses.every((s) => s === 200), `2.1 realtime-token responses ${JSON.stringify(tokenStatuses)}`);

  // team finishes via SUN tags (API, as a phone would after /t)
  let r = await team.req("/api/tag", { method: "POST", body: sun(UIDS[0], 11) });
  step(r.status === 200, `3. team tags C1 (SUN) -> ${r.status}`);
  r = await team.req("/api/tag", { method: "POST", body: sun(UIDS[1], 11) });
  const finishAt = Date.now();
  step(r.status === 200 && r.json?.data?.view?.finished === true, `3.1 team tags C2 -> finished (${r.status})`);
  const ms = await visibleMs(page.getByRole("button", { name: "1등 공개" }), RT_BUDGET);
  step(ms !== null, `4. ceremony shows '1등 공개' without reload via realtime (${ms === null ? "not" : Date.now() - finishAt + " ms"} within ${RT_BUDGET} ms)`);
  await page.getByRole("button", { name: "1등 공개" }).click();
  step((await visibleMs(page.getByText("[TEST] 시상팀"), 5000)) !== null, "4.1 '1등 공개' reveals the team name");
  await page.screenshot({ path: `${OUT}/ceremony-revealed.png`, fullPage: true });
} finally {
  await browser.close();
  const c = await cleanupSession(admin, S);
  step(c.ok, c.line);
  for (const u of UIDS) {
    const d = await deleteSunCounters(u);
    step(d.after === 0, `cleanup sun_counters ${u} before=${d.before} after=${d.after}`);
  }
}
console.log(`\nRESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
