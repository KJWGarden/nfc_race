// TODO-005: every API handler returns 503 (no Set-Cookie) under an invalid production config,
// and the realtime-token route still works with a valid config (regression for TODO-002).
// Run: node guard-sweep-005.mjs <appDir> <envFile>   (next start on 127.0.0.1:3001, stopped at the end)
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const [appDir, envFile] = process.argv.slice(2);
const fileEnv = Object.fromEntries(
  readFileSync(envFile, "utf8").split("\n").map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]),
);
const CONFIG_ERROR = "서버 설정이 올바르지 않습니다. 운영자에게 문의해 주세요.";
let failures = 0;
function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` -- ${detail}` : ""}`);
}
async function startServer(overrides) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: "1", ...fileEnv, ...overrides };
  const child = spawn("node_modules/.bin/next", ["start", "-H", "127.0.0.1", "-p", "3001"], { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("not ready")), 30000);
    const iv = setInterval(() => /Ready in/.test(log) && (clearTimeout(t), clearInterval(iv), resolve()), 50);
  });
  return { stop: () => new Promise((r) => (child.once("exit", r), child.kill("SIGTERM"))) };
}
async function req(path, method = "GET", body, cookie) {
  const res = await fetch(`http://127.0.0.1:3001${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.30", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null), setCookie: res.headers.getSetCookie() };
}

// a cookie signed with the DEFAULT secret: must not be accepted even though APP_SECRET is the default
import { createHmac } from "node:crypto";
const forgedAdmin = `cp_admin=ok.${createHmac("sha256", "checkpoint-dev-secret").update("ok").digest("hex").slice(0, 24)}`;

const routes = [
  ["POST", "/api/admin/login", { password: fileEnv.ADMIN_PASSWORD }],
  ["POST", "/api/admin/logout"],
  ["GET", "/api/admin/realtime-token"],
  ["GET", "/api/admin/sdm-key?uid=04C0FFEE000011"],
  ["GET", "/api/admin/sessions"],
  ["POST", "/api/admin/sessions", { name: "[TEST] x" }],
  ["GET", "/api/admin/sessions/x"],
  ["PATCH", "/api/admin/sessions/x", { name: "y" }],
  ["DELETE", "/api/admin/sessions/x"],
  ["POST", "/api/admin/sessions/x/announcements", { message: "m" }],
  ["GET", "/api/admin/sessions/x/tags"],
  ["POST", "/api/admin/sessions/x/tags", { name: "t" }],
  ["PATCH", "/api/admin/sessions/x/tags/y", { name: "t" }],
  ["DELETE", "/api/admin/sessions/x/tags/y"],
  ["POST", "/api/admin/sessions/x/tags/y/sun", { e: "0", c: "0" }],
  ["POST", "/api/admin/sun/inspect", { e: "0", c: "0" }],
  ["POST", "/api/join", { code: "DEMO01", name: "[TEST] sweep" }],
  ["POST", "/api/logout"],
  ["GET", "/api/me"],
  ["POST", "/api/tag", { e: "0", c: "0" }],
  ["POST", "/api/teams", { name: "t" }],
  ["POST", "/api/teams/join", { joinCode: "ABCD" }],
];

console.log(`guard-sweep-005 at ${new Date().toISOString()}`);
let srv = await startServer({ APP_SECRET: "checkpoint-dev-secret" });
console.log("== invalid config: APP_SECRET = default; requests carry a cp_admin cookie signed with the default secret");
for (const [method, path, body] of routes) {
  const r = await req(path, method, body, forgedAdmin);
  check(`${method} ${path} -> 503 config message, no Set-Cookie`, r.status === 503 && r.json?.error === CONFIG_ERROR && r.setCookie.length === 0, `${r.status}`);
}
// /t page (server component using isAdmin): forged default-secret cookie must not open admin mode
const page = await fetch("http://127.0.0.1:3001/t/s?e=00&c=00", { headers: { cookie: forgedAdmin } }).then((r) => r.text());
check("/t with default-secret-signed cp_admin does not render admin mode", !page.includes("관리자 모드") && !page.includes("관리자 로그아웃"), `admin-marker=${page.includes("관리자 로그아웃")}`);
await srv.stop();

srv = await startServer({});
console.log("== valid config: realtime-token regression");
const login = await req("/api/admin/login", "POST", { password: fileEnv.ADMIN_PASSWORD });
const cookie = login.setCookie.find((c) => c.startsWith("cp_admin="))?.split(";")[0];
check("admin login -> 200", login.status === 200 && !!cookie, `${login.status}`);
let r = await req("/api/admin/realtime-token", "GET", null, cookie);
check("realtime-token with admin cookie -> 200 JWT + expiresAt", r.status === 200 && r.json?.data?.token?.split(".").length === 3 && r.json.data.expiresAt > Date.now(), `${r.status}`);
r = await req("/api/admin/realtime-token");
check("realtime-token without cookie -> 401", r.status === 401, `${r.status}`);
r = await req("/api/admin/realtime-token", "GET", null, forgedAdmin);
check("realtime-token with default-secret-signed cookie (valid config) -> 401", r.status === 401, `${r.status}`);
const page2 = await fetch("http://127.0.0.1:3001/t/s?e=00&c=00", { headers: { cookie } }).then((x) => x.text());
check("/t with a real admin cookie still renders admin mode", page2.includes("관리자 로그아웃") || page2.includes("관리자 모드"), "");
await srv.stop();
console.log(`\nRESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
