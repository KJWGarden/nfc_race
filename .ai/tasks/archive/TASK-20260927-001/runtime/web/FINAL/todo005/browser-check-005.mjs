// TODO-005 browser validation: admin login lockout message on /admin/login, then login after the window reset,
// plus the participant join -> /race regression (auth helpers changed).
// The admin context sends X-Forwarded-For 203.0.113.20 (TEST-NET-3) so the lock never hits a real client IP;
// the row is deleted at the end. Password comes from the process env (never printed; dev falls back to the default).
// Run from the scratchpad (playwright-core lives here): node browser-check-005.mjs <envFile> <outDir>
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const [envFile, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const fileEnv = Object.fromEntries(
  readFileSync(envFile, "utf8").split("\n").map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]),
);
const BASE = "http://127.0.0.1:3000";
const TEST_IP = "203.0.113.20";
const PASSWORD = process.env.LOGIN_PASSWORD;
const service = fileEnv.SUPABASE_SERVICE_ROLE_KEY;
async function rest(method, path, body) {
  const res = await fetch(`${fileEnv.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const attemptRow = async () => (await rest("GET", `admin_login_attempts?ip=eq.${TEST_IP}&select=*`)).json?.[0] ?? null;

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

console.log(`browser-check-005 at ${new Date().toISOString()}`);
await rest("DELETE", `admin_login_attempts?ip=eq.${TEST_IP}`);
const browser = await chromium.launch();
try {
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "X-Forwarded-For": TEST_IP } });
  const page = await adminCtx.newPage();
  await page.goto(`${BASE}/admin/login`);
  step(await visible(page.getByRole("heading", { name: "운영 데스크" })), "1. /admin/login renders");
  const input = page.getByLabel("관리자 비밀번호");
  const submit = page.getByRole("button", { name: "입장" });

  // 2. five wrong passwords, each waits for its own 401 response
  for (let i = 1; i <= 5; i++) {
    await input.fill(`wrong-password-${i}`);
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/admin/login") && r.request().method() === "POST"),
      submit.click(),
    ]);
    const shown = await visible(page.getByText("비밀번호가 올바르지 않습니다."));
    step(res.status() === 401 && shown, `2.${i} wrong password -> 401 and "비밀번호가 올바르지 않습니다." shown (${res.status()})`);
  }
  step((await attemptRow())?.attempts === 5, "2.6 DB row for the test IP has attempts=5");

  // 3. sixth attempt with the correct password -> 429 lockout message, still on the login page
  await input.fill(PASSWORD);
  const [locked] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/admin/login") && r.request().method() === "POST"),
    submit.click(),
  ]);
  const lockMsg = page.getByText("로그인 시도가 너무 많습니다. 약 15분 후 다시 시도해 주세요.");
  step(locked.status() === 429 && (await visible(lockMsg)), `3. 6th attempt (correct password) -> 429 and lockout message visible (${locked.status()})`);
  step(new URL(page.url()).pathname === "/admin/login", `3.1 still on /admin/login (${new URL(page.url()).pathname})`);
  const cookies = await adminCtx.cookies();
  step(!cookies.some((c) => c.name === "cp_admin"), "3.2 no cp_admin cookie set");
  await page.screenshot({ path: `${OUT}/01-lockout-message.png`, fullPage: true });

  // 4. window reset: move the stored lock into the past (service key)
  const patched = await rest("PATCH", `admin_login_attempts?ip=eq.${TEST_IP}`, {
    locked_until: new Date(Date.now() - 1000).toISOString(),
    window_start: new Date(Date.now() - 16 * 60e3).toISOString(),
  });
  step(patched.status === 200, `4. window reset simulated: locked_until=now-1s, window_start=now-16min (HTTP ${patched.status})`);

  // 5. correct password -> /admin loads
  await input.fill(PASSWORD);
  const [ok] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/admin/login") && r.request().method() === "POST"),
    submit.click(),
  ]);
  await page.waitForURL(`${BASE}/admin`, { timeout: 10000 }).catch(() => {});
  step(ok.status() === 200 && new URL(page.url()).pathname === "/admin", `5. correct password -> 200 and URL /admin (${ok.status()}, ${new URL(page.url()).pathname})`);
  step(await visible(page.getByRole("heading", { name: "참가 세션" })), "5.1 /admin shows '참가 세션'");
  step(await visible(page.getByText("한강 워킹 챌린지")), "5.2 session list loads (DEMO01 '한강 워킹 챌린지')");
  step((await attemptRow()) === null, "5.3 successful login cleared the attempts row");
  await page.screenshot({ path: `${OUT}/02-admin-after-reset.png`, fullPage: true });

  // 6. regression: participant join -> /race (no X-Forwarded-For override)
  const pCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await pCtx.newPage();
  await p.goto(`${BASE}/join/DEMO01`);
  await p.getByLabel("내 이름").fill("[TEST] 브라우저 참가자");
  await p.getByRole("button", { name: "레이스 참가" }).click();
  await p.waitForURL(`${BASE}/race`, { timeout: 10000 }).catch(() => {});
  step(new URL(p.url()).pathname === "/race", `6. participant join -> /race (${new URL(p.url()).pathname})`);
  step(await visible(p.getByRole("heading", { name: "팀을 선택하세요" })), "6.1 /race loads and shows '팀을 선택하세요'");
  step((await pCtx.cookies()).some((c) => c.name === "cp_pid"), "6.2 cp_pid cookie set");
  await p.screenshot({ path: `${OUT}/03-participant-race.png`, fullPage: true });
} finally {
  await browser.close();
  const d1 = await rest("DELETE", `admin_login_attempts?ip=eq.${TEST_IP}`);
  const d2 = await rest("DELETE", "participants?name=like.%5BTEST%5D*");
  const left = (await rest("GET", "admin_login_attempts?select=ip")).json;
  const leftP = (await rest("GET", "participants?name=like.%5BTEST%5D*&select=id")).json;
  step(Array.isArray(left) && left.length === 0 && leftP.length === 0, `cleanup: attempts rows left=${left?.length}, [TEST] participants left=${leftP?.length} (deleted ${d1.json?.length ?? 0} attempt rows, ${d2.json?.length ?? 0} participants)`);
}
console.log(`\nRESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
