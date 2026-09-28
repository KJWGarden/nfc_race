// TODO-006 AC6: POST /api/rejoin under the TODO-005 production misconfiguration -> 503, no cookie;
// with a valid production config the re-join works (Secure cookie) against a throwaway [TEST] session.
// next start runs from the isolated copy (no .env* files), env comes only from <envFile>. 127.0.0.1:3001, stopped at the end.
// Run: node prod-rejoin-006.mjs <appDir> <envFile>
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const [appDir, envFile] = process.argv.slice(2);
const fileEnv = Object.fromEntries(
  readFileSync(envFile, "utf8").split("\n").map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]),
);
{
  const pub = fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const role = pub.startsWith("sb_")
    ? pub.startsWith("sb_secret_") ? "service_role" : "public"
    : JSON.parse(Buffer.from(pub.split(".")[1] ?? "", "base64url").toString() || "{}").role;
  if (role === "service_role") throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is a service_role/secret key; refusing to run");
}
const SECRET_VALUES = Object.entries(fileEnv)
  .filter(([k]) => !k.startsWith("NEXT_PUBLIC_") && k !== "SUPABASE_URL")
  .map(([, v]) => v)
  .filter((v) => v.length >= 8);
const CONFIG_ERROR = "서버 설정이 올바르지 않습니다. 운영자에게 문의해 주세요.";
let failures = 0;
function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` -- ${detail}` : ""}`);
}
async function startServer(overrides) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: "1", ...fileEnv };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const child = spawn("node_modules/.bin/next", ["start", "-H", "127.0.0.1", "-p", "3001"], { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("not ready")), 30000);
    const iv = setInterval(() => /Ready in/.test(log) && (clearTimeout(t), clearInterval(iv), resolve()), 50);
  });
  return { get log() { return log; }, stop: () => new Promise((r) => (child.once("exit", r), child.kill("SIGTERM"))) };
}
async function req(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`http://127.0.0.1:3001${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.60", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null), setCookie: res.headers.getSetCookie() };
}
const cookieOf = (r, name) => r.setCookie.find((c) => c.startsWith(`${name}=`))?.split(";")[0];

console.log(`prod-rejoin-006 at ${new Date().toISOString()}`);
const body = { code: "OOOOOO", joinCode: "IIII", name: "[TEST] guard" }; // impossible codes (no I/O in codes)
for (const [name, overrides, expect] of [
  ["ADMIN_PASSWORD unset", { ADMIN_PASSWORD: undefined }, "ADMIN_PASSWORD"],
  ["ADMIN_PASSWORD default", { ADMIN_PASSWORD: "admin123" }, "ADMIN_PASSWORD"],
  ["APP_SECRET unset", { APP_SECRET: undefined }, "APP_SECRET"],
  ["APP_SECRET default", { APP_SECRET: "checkpoint-dev-secret" }, "APP_SECRET"],
]) {
  const srv = await startServer(overrides);
  const r = await req("/api/rejoin", { method: "POST", body });
  await srv.stop();
  check(`AC6 [${name}] POST /api/rejoin -> 503 config message, no Set-Cookie`, r.status === 503 && r.json?.error === CONFIG_ERROR && r.setCookie.length === 0, `${r.status}`);
  const lines = srv.log.split("\n").filter((l) => l.includes("[config]"));
  check(`AC6 [${name}] log names ${expect} only, no secret values`, lines.length === 1 && lines[0].endsWith(`: ${expect}`) && ![...SECRET_VALUES, "admin123", "checkpoint-dev-secret"].some((v) => srv.log.includes(v)), JSON.stringify(lines));
}

const srv = await startServer({});
let sessionId = null;
let adminCookie = null;
try {
  let r = await req("/api/admin/login", { method: "POST", body: { password: fileEnv.ADMIN_PASSWORD } });
  adminCookie = cookieOf(r, "cp_admin");
  r = await req("/api/admin/sessions", { method: "POST", cookie: adminCookie, body: { name: `[TEST] TODO-006 prod ${new Date().toISOString()}`, description: "automated check; safe to delete", checkpointCount: 1, awardRanks: 1 } });
  sessionId = r.json.data.id;
  const code = r.json.data.code;
  r = await req("/api/join", { method: "POST", body: { code, name: "[TEST] Prod Kim" } });
  const pid = cookieOf(r, "cp_pid");
  r = await req("/api/teams", { method: "POST", cookie: pid, body: { name: "[TEST] 운영팀" } });
  const joinCode = r.json.data.team.joinCode;
  const participantId = r.json.data.participant.id;
  r = await req("/api/rejoin", { method: "POST", body: { code, joinCode, name: " [test]  prod KIM " } });
  const again = r.setCookie.find((c) => c.startsWith("cp_pid="));
  check("valid prod config: re-join -> 200, Secure HttpOnly cp_pid", r.status === 200 && r.json.data.participantId === participantId && /Secure/.test(again) && /HttpOnly/i.test(again), `${r.status}`);
  r = await req("/api/me", { cookie: again.split(";")[0] });
  check("valid prod config: /api/me with the re-join cookie -> same participant, leader", r.status === 200 && r.json.data.participant.id === participantId && r.json.data.participant.isLeader === true, `${r.status}`);
  r = await req("/api/rejoin", { method: "POST", body: { code, joinCode, name: "someone else" } });
  check("valid prod config: non-member -> 400 generic error, no cookie", r.status === 400 && r.json.error === "일치하는 팀원을 찾을 수 없습니다." && r.setCookie.length === 0, `${r.status}`);
} finally {
  if (sessionId) {
    const d = await req(`/api/admin/sessions/${sessionId}`, { method: "DELETE", cookie: adminCookie });
    const g = await req(`/api/admin/sessions/${sessionId}`, { cookie: adminCookie });
    check("cleanup [TEST] session", d.status === 200 && g.status === 404, `DELETE ${d.status}, GET ${g.status}`);
  }
  await srv.stop();
  check("valid-config server log has no secret values", !SECRET_VALUES.some((v) => srv.log.includes(v)));
  // the admin login above succeeded, so no attempts row remains for 203.0.113.60
  const k = fileEnv.SUPABASE_SERVICE_ROLE_KEY;
  const rows = await fetch(`${fileEnv.SUPABASE_URL}/rest/v1/admin_login_attempts?ip=eq.203.0.113.60&select=ip`, { headers: { apikey: k, Authorization: `Bearer ${k}` } }).then((x) => x.json());
  check("no admin_login_attempts row left for 203.0.113.60", rows.length === 0, JSON.stringify(rows));
}
console.log(`\nRESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
