// TODO-001 browser validation: admin + participant flows against local Supabase.
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const OUT = "/Users/kimgarden/dev/nfc-walk-race/.ai/tasks/active/TASK-20260927-001/runtime/web/TODO-001";
mkdirSync(OUT, { recursive: true });
const env = readFileSync("/Users/kimgarden/dev/nfc-walk-race/.env.local", "utf8");
const ADMIN_PASSWORD = /^ADMIN_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() ?? "admin123";
const T = 15000;

const steps = [];
let failures = 0;
function step(ok, text) {
  if (!ok) failures++;
  steps.push(`${ok ? "PASS" : "FAIL"} ${text}`);
  console.log(`${ok ? "PASS" : "FAIL"} ${text}`);
}
async function expectText(page, text, label, opts = {}) {
  try {
    await page.getByText(text, opts).first().waitFor({ state: "visible", timeout: T });
    step(true, label);
    return true;
  } catch (err) {
    step(false, `${label} (${String(err.message).split("\n")[0]})`);
    await page.screenshot({ path: `${OUT}/fail-${steps.length}.png`, fullPage: true });
    return false;
  }
}

const browser = await chromium.launch();
const mobile = { viewport: { width: 390, height: 844 } };
const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const aCtx = await browser.newContext(mobile);
const bCtx = await browser.newContext(mobile);
const admin = await adminCtx.newPage();
const a = await aCtx.newPage();
const b = await bCtx.newPage();
admin.on("dialog", (d) => d.accept());

try {
  // --- admin: login
  await admin.goto(`${BASE}/admin/login`);
  await admin.getByLabel("관리자 비밀번호").fill(ADMIN_PASSWORD);
  await admin.getByRole("button", { name: "입장" }).click();
  await admin.waitForURL(`${BASE}/admin`, { timeout: T });
  step(true, "admin login -> /admin");
  await expectText(admin, "한강 워킹 챌린지", "admin list shows seeded DEMO01 session");

  // --- admin: create throwaway session
  await admin.getByRole("button", { name: "새 세션" }).click();
  await admin.getByLabel("이름").fill("브라우저 임시 세션");
  await admin.getByRole("button", { name: "만들기" }).click();
  await admin.waitForURL(/\/admin\/sessions\/[0-9A-Z]+$/, { timeout: T });
  const tempUrl = admin.url();
  await expectText(admin, "브라우저 임시 세션", "created session page opens", { exact: true });

  // --- admin: add checkpoints
  await admin.getByRole("button", { name: "NFC", exact: true }).click();
  for (const name of ["임시 지점 1", "임시 지점 2"]) {
    await admin.getByLabel("지점 이름").fill(name);
    const resp = admin.waitForResponse((r) => r.url().includes("/tags") && r.request().method() === "POST");
    await admin.getByRole("button", { name: "태그 생성" }).click();
    step((await resp).status() === 200, `POST tag "${name}" -> 200`);
    await expectText(admin, name, `checkpoint "${name}" listed`, { exact: true });
  }
  await expectText(admin, "지점 2", "second checkpoint has order 2");

  // --- admin: set live
  await admin.getByRole("button", { name: "레이스 시작" }).click();
  await expectText(admin, "레이스 종료", "throwaway session is live (레이스 종료 button shown)");
  await admin.screenshot({ path: `${OUT}/01-admin-temp-session-live.png`, fullPage: true });

  // --- admin: delete throwaway session
  await admin.getByRole("button", { name: "설정" }).click();
  await admin.getByRole("button", { name: "세션 삭제" }).click();
  await admin.waitForURL(`${BASE}/admin`, { timeout: T });
  await expectText(admin, "한강 워킹 챌린지", "back on session list after delete");
  step((await admin.getByText("브라우저 임시 세션").count()) === 0, "deleted session no longer listed");
  const tempGone = await admin.request.get(tempUrl.replace("/admin/sessions/", "/api/admin/sessions/"));
  step(tempGone.status() === 404, `GET deleted session API -> ${tempGone.status()}`);

  // --- admin: set DEMO01 live
  await admin.getByText("한강 워킹 챌린지").click();
  await admin.waitForURL(/\/admin\/sessions\/DEMOSESS$/, { timeout: T });
  await admin.getByRole("button", { name: "레이스 시작" }).click();
  await expectText(admin, "레이스 종료", "DEMO01 set live");

  // --- participant A: join + create team
  await a.goto(BASE);
  await a.getByPlaceholder("DEMO01").fill("DEMO01");
  await a.getByLabel("내 이름").fill("브라우저A");
  await a.getByRole("button", { name: "레이스 참가" }).click();
  await a.waitForURL(`${BASE}/race`, { timeout: T });
  await expectText(a, "팀을 선택하세요", "A joined DEMO01 -> team gate");
  await a.getByPlaceholder("팀 이름").fill("브라우저팀");
  await a.getByRole("button", { name: "팀장으로 시작" }).click();
  await expectText(a, /팀원 · 참가 코드 [0-9A-Z]{4}/, "A created team, race view shows join code");
  const codeText = await a.getByText(/팀원 · 참가 코드/).first().textContent();
  const joinCode = /([0-9A-Z]{4})\s*$/.exec(codeText)[1];
  step(true, `team join code read from page: ${joinCode}`);

  // --- participant B: join + join team by code (second browser context)
  await b.goto(`${BASE}/join/DEMO01`);
  await b.getByLabel("내 이름").fill("브라우저B");
  await b.getByRole("button", { name: "레이스 참가" }).click();
  await b.waitForURL(`${BASE}/race`, { timeout: T });
  await b.getByRole("button", { name: "코드로 참가" }).click();
  await b.getByPlaceholder("팀 코드 4자리").fill(joinCode);
  await b.getByRole("button", { name: "팀에 들어가기" }).click();
  await expectText(b, "브라우저A", "B joined team by code; members list shows 브라우저A");
  await expectText(b, "여의도 출발 게이트", "B sees next destination 여의도 출발 게이트");

  const manual = async (page, value) => {
    await page.getByPlaceholder("태그 코드 / URL").fill(value);
    const resp = page.waitForResponse((r) => r.url().endsWith("/api/tag"));
    await page.getByRole("button", { name: "확인" }).click();
    return (await resp).status();
  };

  // out of order
  step((await manual(b, "demo000003")) === 400, "B manual demo000003 -> HTTP 400");
  await expectText(b, '순서가 아닙니다. 다음 지점은 "여의도 출발 게이트" 입니다.', "out-of-order error shown");
  await b.screenshot({ path: `${OUT}/02-participant-out-of-order.png`, fullPage: true });

  // checkpoint 1 by A
  step((await manual(a, "demo000001")) === 200, "A manual demo000001 -> HTTP 200");
  await expectText(a, "여의도 출발 게이트 태깅 완료", "A sees checkpoint 1 overlay");
  await a.getByRole("button", { name: "이동하기" }).click();

  // duplicate by B (team-level record)
  step((await manual(b, "demo000001")) === 400, "B manual demo000001 (already tagged by teammate) -> HTTP 400");
  await expectText(b, "이미 태깅한 지점입니다.", "duplicate error shown to teammate B");
  await b.screenshot({ path: `${OUT}/03-participant-duplicate.png`, fullPage: true });

  // checkpoint 2 by B using full tag URL
  step((await manual(b, `${BASE}/t/demo000002`)) === 200, "B manual full URL /t/demo000002 -> HTTP 200");
  await expectText(b, "국회의사당 태깅 완료", "B sees checkpoint 2 overlay");
  await b.getByRole("button", { name: "이동하기" }).click();

  // checkpoints 3, 4 by A
  step((await manual(a, "demo000003")) === 200, "A manual demo000003 -> HTTP 200");
  await expectText(a, "여의나루 태깅 완료", "A sees checkpoint 3 overlay");
  await a.getByRole("button", { name: "이동하기" }).click();
  step((await manual(a, "demo000004")) === 200, "A manual demo000004 -> HTTP 200");
  await expectText(a, "완주!", "A sees finish overlay");
  await a.getByRole("button", { name: "이동하기" }).click();
  await expectText(a, "기록 확정", "A race view shows 기록 확정 (finished)");
  await a.screenshot({ path: `${OUT}/04-participant-finished.png`, fullPage: true });
  await b.reload();
  await expectText(b, "기록 확정", "B (teammate) race view shows 기록 확정 after reload");

  // --- admin live view after reload
  await admin.reload();
  await expectText(admin, "브라우저팀", "admin live tab shows team after reload");
  await expectText(admin, "완주", "admin shows 완주 stat");
  await admin.screenshot({ path: `${OUT}/05-admin-live.png`, fullPage: true });
  await admin.getByRole("button", { name: "순위", exact: true }).click();
  const row = admin.locator("tr", { hasText: "브라우저팀" });
  await row.waitFor({ timeout: T });
  const rowText = (await row.textContent()) ?? "";
  step(/^\s*1/.test(rowText) && !rowText.includes("진행중"), `ranking row: rank 1, finished (row text: ${rowText.replace(/\s+/g, " ").trim()})`);
  await admin.screenshot({ path: `${OUT}/06-admin-rankings.png`, fullPage: true });
} catch (err) {
  step(false, `unexpected error: ${err.message.split("\n")[0]}`);
  for (const [n, p] of [["admin", admin], ["a", a], ["b", b]]) {
    await p.screenshot({ path: `${OUT}/error-${n}.png`, fullPage: true }).catch(() => {});
  }
} finally {
  await browser.close();
}
console.log(`\nRESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
