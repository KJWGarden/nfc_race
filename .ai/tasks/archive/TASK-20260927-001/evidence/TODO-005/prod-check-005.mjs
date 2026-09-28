// TODO-005 production-mode checks (next start, NODE_ENV=production) against a Supabase stack.
// The app runs from an isolated copy with no .env* files, so every variable comes from the process env below
// and "unset" really means unset. Servers bind 127.0.0.1 only and are stopped at the end.
// Run: node prod-check-005.mjs <appDir> <envFile>
//   envFile = local stack values (SUPABASE_*, NEXT_PUBLIC_*, SUN_*, ADMIN_PASSWORD, APP_SECRET; non-default secrets)
// Login-limit tests use X-Forwarded-For values from 203.0.113.0/24 (TEST-NET-3), never a real client IP,
// and delete their admin_login_attempts rows at the end.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const [appDir, envFile] = process.argv.slice(2);
const fileEnv = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const SECRET_VALUES = Object.entries(fileEnv)
  .filter(([k]) => !k.startsWith("NEXT_PUBLIC_") && k !== "SUPABASE_URL")
  .map(([, v]) => v)
  .filter((v) => v.length >= 8);
// guard: the browser-exposed key must never be a service_role key
{
  const pub = fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const role = pub.startsWith("sb_")
    ? pub.startsWith("sb_secret_") ? "service_role" : "public"
    : JSON.parse(Buffer.from(pub.split(".")[1] ?? "", "base64url").toString() || "{}").role;
  if (role === "service_role") throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is a service_role/secret key; refusing to run");
}
const CONFIG_ERROR = "서버 설정이 올바르지 않습니다. 운영자에게 문의해 주세요.";
const PASSWORD = fileEnv.ADMIN_PASSWORD;

let failures = 0;
function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` -- ${detail}` : ""}`);
}

function baseEnv(overrides) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: "1", ...fileEnv };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

async function startServer(port, overrides) {
  const env = baseEnv(overrides);
  const child = spawn("node_modules/.bin/next", ["start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: appDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  // wait for the "Ready" line (no fixed sleep)
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server ${port} not ready: ${log}`)), 30000);
    const iv = setInterval(() => {
      if (/Ready in/.test(log)) {
        clearTimeout(t);
        clearInterval(iv);
        resolve();
      }
    }, 50);
  });
  return {
    port,
    envNames: Object.keys(env).sort(),
    get log() {
      return log;
    },
    stop: () =>
      new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill("SIGTERM");
      }),
  };
}

async function req(port, path, { method = "GET", body, xff, cookie } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (xff) headers["X-Forwarded-For"] = xff;
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, setCookie: res.headers.getSetCookie(), headers: res.headers };
}

async function rest(method, path, key, body) {
  const res = await fetch(`${fileEnv.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}
const service = fileEnv.SUPABASE_SERVICE_ROLE_KEY;
const attemptRow = async (ip) => JSON.parse((await rest("GET", `admin_login_attempts?ip=eq.${ip}&select=*`, service)).text)[0] ?? null;

console.log(`prod-check-005 at ${new Date().toISOString()} app=${appDir}`);
console.log(`secret values tracked for log scan: ${SECRET_VALUES.length} (values not printed)`);

// ---------------- AC1: four invalid-config cases x four routes
const cases = [
  { name: "ADMIN_PASSWORD unset", overrides: { ADMIN_PASSWORD: undefined }, expect: "ADMIN_PASSWORD" },
  { name: "ADMIN_PASSWORD default", overrides: { ADMIN_PASSWORD: "admin123" }, expect: "ADMIN_PASSWORD" },
  { name: "APP_SECRET unset", overrides: { APP_SECRET: undefined }, expect: "APP_SECRET" },
  { name: "APP_SECRET default", overrides: { APP_SECRET: "checkpoint-dev-secret" }, expect: "APP_SECRET" },
  { name: "both empty", overrides: { ADMIN_PASSWORD: "", APP_SECRET: "" }, expect: "ADMIN_PASSWORD, APP_SECRET" },
];
for (const c of cases) {
  const srv = await startServer(3001, c.overrides);
  console.log(`\n== AC1 case: ${c.name}; server env names: ${srv.envNames.join(" ")}`);
  const loginPw = c.overrides.ADMIN_PASSWORD === "admin123" ? "admin123" : PASSWORD;
  const calls = [
    ["POST /api/admin/login", await req(3001, "/api/admin/login", { method: "POST", body: { password: loginPw }, xff: "203.0.113.1" })],
    ["POST /api/join", await req(3001, "/api/join", { method: "POST", body: { code: "DEMO01", name: "[TEST] guard" } })],
    ["GET /api/me", await req(3001, "/api/me")],
    ["GET /api/admin/sessions", await req(3001, "/api/admin/sessions")],
  ];
  for (const [label, r] of calls) {
    check(
      `AC1 [${c.name}] ${label} -> 503 config message, no Set-Cookie`,
      r.status === 503 && r.json?.error === CONFIG_ERROR && r.setCookie.length === 0,
      `${r.status} ${JSON.stringify(r.json)} set-cookie=${r.setCookie.length}`,
    );
  }
  await srv.stop();
  const lines = srv.log.split("\n").filter((l) => l.includes("[config]"));
  console.log(`server log [config] lines: ${JSON.stringify(lines)}`);
  check(`AC1 [${c.name}] log names ${c.expect}`, lines.length === 1 && lines[0].endsWith(`: ${c.expect}`));
  const leaked = [...SECRET_VALUES, "admin123", "checkpoint-dev-secret"].filter((v) => srv.log.includes(v));
  check(`AC1 [${c.name}] server log contains no secret/default values`, leaked.length === 0, `hits=${leaked.length}`);
  check(`AC1 [${c.name}] no .env file loaded`, !/Environments:/.test(srv.log));
}
const guardRows = JSON.parse((await rest("GET", "admin_login_attempts?ip=eq.203.0.113.1&select=ip", service)).text);
check("AC1 guarded login did not count an attempt", guardRows.length === 0, JSON.stringify(guardRows));
const guardJoin = JSON.parse((await rest("GET", "participants?name=eq.%5BTEST%5D%20guard&select=id", service)).text);
// (AC1 join targets DEMO01; under the guard it never reaches the DB, whether or not DEMO01 exists)
check("AC1 guarded join created no participant", guardJoin.length === 0, JSON.stringify(guardJoin));

// ---------------- valid config: two servers sharing the DB
const a = await startServer(3001, {});
const b = await startServer(3002, {});
const cleanupIps = [];
let testSessionId = null;
try {
  console.log(`\n== valid config (non-default values from envFile); servers 3001 + 3002`);
  // AC2
  let r = await req(3001, "/api/admin/login", { method: "POST", body: { password: PASSWORD }, xff: "203.0.113.2" });
  cleanupIps.push("203.0.113.2");
  const adminCookie = r.setCookie.find((c) => c.startsWith("cp_admin="))?.split(";")[0];
  check("AC2 admin login -> 200 + cp_admin cookie (Secure, HttpOnly)", r.status === 200 && !!adminCookie && /Secure/.test(r.setCookie[0]) && /HttpOnly/i.test(r.setCookie[0]), `${r.status}`);
  r = await req(3001, "/api/admin/sessions", { cookie: adminCookie });
  check("AC2 admin sessions with cookie -> 200", r.status === 200 && Array.isArray(r.json?.data), `${r.status}`);
  // throwaway [TEST] session for the join check (deleted in finally)
  r = await req(3001, "/api/admin/sessions", { method: "POST", cookie: adminCookie, body: { name: `[TEST] TODO-005 prod ${new Date().toISOString()}`, description: "automated check; safe to delete", checkpointCount: 1, awardRanks: 1 } });
  testSessionId = r.json?.data?.id;
  const joinCode = r.json?.data?.code;
  await req(3001, `/api/admin/sessions/${testSessionId}`, { method: "PATCH", cookie: adminCookie, body: { status: "ready" } });
  check("AC2 admin creates a [TEST] session", r.status === 200 && !!joinCode, `${r.status}`);
  r = await req(3001, "/api/join", { method: "POST", body: { code: joinCode, name: "[TEST] prod join" } });
  const pidCookie = r.setCookie.find((c) => c.startsWith("cp_pid="))?.split(";")[0];
  check("AC2 participant join -> 200 + cp_pid", r.status === 200 && !!pidCookie, `${r.status} ${r.json?.error ?? ""}`);
  r = await req(3002, "/api/me", { cookie: pidCookie });
  check("AC2 /api/me with that cookie (other instance) -> 200", r.status === 200 && r.json?.data?.participant?.name === "[TEST] prod join", `${r.status}`);
  r = await req(3001, "/api/admin/sessions", { cookie: "cp_admin=ok." + "0".repeat(24) });
  check("AC2 forged admin cookie -> 401", r.status === 401, `${r.status}`);

  // default client key when no X-Forwarded-For is sent: Next sets it from the socket address
  r = await req(3001, "/api/admin/login", { method: "POST", body: { password: "wrong" } });
  const sockRow = await attemptRow("127.0.0.1");
  check("client key without X-Forwarded-For is the socket address 127.0.0.1", r.status === 401 && sockRow?.attempts === 1, JSON.stringify(sockRow));
  cleanupIps.push("127.0.0.1");

  // AC5: 5 wrong -> 6th (correct password) 429 with wait message; window expiry -> success
  const ip5 = "203.0.113.5";
  cleanupIps.push(ip5);
  for (let i = 1; i <= 5; i++) {
    r = await req(3001, "/api/admin/login", { method: "POST", body: { password: `wrong-${i}` }, xff: ip5 });
    check(`AC5 wrong #${i} -> 401`, r.status === 401 && r.json?.error === "비밀번호가 올바르지 않습니다.", `${r.status}`);
  }
  r = await req(3001, "/api/admin/login", { method: "POST", body: { password: PASSWORD }, xff: ip5 });
  check("AC5 6th attempt with the CORRECT password -> 429 + wait message, no cookie", r.status === 429 && r.json?.error === "로그인 시도가 너무 많습니다. 약 15분 후 다시 시도해 주세요." && r.setCookie.length === 0, `${r.status} ${JSON.stringify(r.json)}`);
  check("AC5 Retry-After header ~900s", Number(r.headers.get("retry-after")) > 890 && Number(r.headers.get("retry-after")) <= 900, r.headers.get("retry-after"));
  r = await req(3002, "/api/admin/login", { method: "POST", body: { password: "wrong-7" }, xff: ip5 });
  check("AC5 locked IP also refused on the other instance", r.status === 429, `${r.status}`);
  let row = await attemptRow(ip5);
  check("AC5 lock row: attempts 6, locked_until ~15 min ahead", row.attempts === 6 && new Date(row.locked_until) - Date.now() > 14 * 60e3, JSON.stringify(row));
  const other = await req(3001, "/api/admin/login", { method: "POST", body: { password: "wrong" }, xff: "203.0.113.9" });
  cleanupIps.push("203.0.113.9");
  check("AC5 a different IP is not locked", other.status === 401, `${other.status}`);
  // window expiry simulated by moving the stored lock/window into the past (service key; recorded)
  const past = new Date(Date.now() - 1000).toISOString();
  const patched = await rest("PATCH", `admin_login_attempts?ip=eq.${ip5}`, service, { locked_until: past, window_start: new Date(Date.now() - 16 * 60e3).toISOString() });
  console.log(`expiry simulation: PATCH admin_login_attempts ip=${ip5} set locked_until=now-1s, window_start=now-16min -> HTTP ${patched.status}`);
  r = await req(3001, "/api/admin/login", { method: "POST", body: { password: PASSWORD }, xff: ip5 });
  check("AC5 after the window expired, correct password -> 200 + cookie", r.status === 200 && r.setCookie.some((c) => c.startsWith("cp_admin=")), `${r.status}`);
  check("AC5 success cleared the row", (await attemptRow(ip5)) === null);

  // AC6: success before reaching the limit clears the count
  const ip6 = "203.0.113.6";
  cleanupIps.push(ip6);
  for (let i = 1; i <= 4; i++) await req(3001, "/api/admin/login", { method: "POST", body: { password: "bad" }, xff: ip6 });
  check("AC6 after 4 wrong: attempts=4", (await attemptRow(ip6))?.attempts === 4);
  r = await req(3001, "/api/admin/login", { method: "POST", body: { password: PASSWORD }, xff: ip6 });
  check("AC6 5th attempt correct -> 200, row cleared", r.status === 200 && (await attemptRow(ip6)) === null, `${r.status}`);
  const statuses = [];
  for (let i = 1; i <= 5; i++) statuses.push((await req(3001, "/api/admin/login", { method: "POST", body: { password: "bad" }, xff: ip6 })).status);
  check("AC6 next 5 wrong -> all 401 (count restarted)", statuses.every((s) => s === 401), statuses.join(","));
  r = await req(3001, "/api/admin/login", { method: "POST", body: { password: PASSWORD }, xff: ip6 });
  check("AC6 6th -> 429 (locks only after 5 new failures)", r.status === 429, `${r.status}`);

  // AC7: failures split across two processes share one counter
  const ip7 = "203.0.113.7";
  cleanupIps.push(ip7);
  const seq = [];
  for (let i = 1; i <= 5; i++) {
    const port = i % 2 ? 3001 : 3002;
    seq.push(`${port}:${(await req(port, "/api/admin/login", { method: "POST", body: { password: "bad" }, xff: ip7 })).status}`);
  }
  check("AC7 5 wrong alternating 3001/3002 -> 401 each", seq.every((s) => s.endsWith(":401")), seq.join(" "));
  check("AC7 shared DB counter = 5", (await attemptRow(ip7))?.attempts === 5);
  const r7a = await req(3002, "/api/admin/login", { method: "POST", body: { password: PASSWORD }, xff: ip7 });
  const r7b = await req(3001, "/api/admin/login", { method: "POST", body: { password: PASSWORD }, xff: ip7 });
  check("AC7 6th (correct) on 3002 -> 429 and on 3001 -> 429", r7a.status === 429 && r7b.status === 429, `${r7a.status},${r7b.status}`);

  // R7: parallel burst cannot get more than 5 password checks
  const ip8 = "203.0.113.8";
  cleanupIps.push(ip8);
  const burst = await Promise.all(
    Array.from({ length: 12 }, (_, i) => req(i % 2 ? 3001 : 3002, "/api/admin/login", { method: "POST", body: { password: "bad" }, xff: ip8 })),
  );
  const counts = burst.reduce((m, x) => ((m[x.status] = (m[x.status] ?? 0) + 1), m), {});
  check("R7 12 parallel wrong attempts over 2 instances -> exactly 5x401, 7x429", counts[401] === 5 && counts[429] === 7, JSON.stringify(counts));

  // AC8: anon key cannot read/write the table or call the functions
  const anon = fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const sel = await rest("GET", "admin_login_attempts?select=*", anon);
  check("AC8 anon select admin_login_attempts -> denied", sel.status === 401 || sel.status === 403, `${sel.status} ${sel.text.slice(0, 120)}`);
  const ins = await rest("POST", "admin_login_attempts", anon, { ip: "203.0.113.66" });
  check("AC8 anon insert -> denied", ins.status === 401 || ins.status === 403, `${ins.status} ${ins.text.slice(0, 120)}`);
  const rpc1 = await rest("POST", "rpc/admin_login_attempt", anon, { p_ip: "203.0.113.66" });
  check("AC8 anon rpc admin_login_attempt -> denied", rpc1.status === 401 || rpc1.status === 403 || rpc1.status === 404, `${rpc1.status} ${rpc1.text.slice(0, 120)}`);
  const rpc2 = await rest("POST", "rpc/admin_login_success", anon, { p_ip: ip7 });
  check("AC8 anon rpc admin_login_success -> denied (cannot unlock)", (rpc2.status === 401 || rpc2.status === 403 || rpc2.status === 404) && (await attemptRow(ip7)) !== null, `${rpc2.status} ${rpc2.text.slice(0, 120)}`);
  check("AC8 no row for 203.0.113.66", (await attemptRow("203.0.113.66")) === null);

} finally {
  if (testSessionId) {
    const login = await req(3001, "/api/admin/login", { method: "POST", body: { password: PASSWORD }, xff: "203.0.113.2" });
    const ck = login.setCookie.find((c) => c.startsWith("cp_admin="))?.split(";")[0];
    const del = await req(3001, `/api/admin/sessions/${testSessionId}`, { method: "DELETE", cookie: ck });
    const rowsLeft = JSON.parse((await rest("GET", `participants?session_id=eq.${testSessionId}&select=id`, service)).text).length;
    const sessLeft = JSON.parse((await rest("GET", `sessions?id=eq.${testSessionId}&select=id`, service)).text).length;
    check("cleanup: [TEST] session deleted (cascade participants)", del.status === 200 && rowsLeft === 0 && sessLeft === 0, `DELETE ${del.status}; sessions=${sessLeft} participants=${rowsLeft}`);
  }
  await a.stop();
  await b.stop();
  const leaked = [...SECRET_VALUES, "admin123", "checkpoint-dev-secret"].filter((v) => a.log.includes(v) || b.log.includes(v));
  check("valid-config server logs contain no secret values", leaked.length === 0, `hits=${leaked.length}`);
  for (const ip of cleanupIps) await rest("DELETE", `admin_login_attempts?ip=eq.${ip}`, service);
  const left = JSON.parse((await rest("GET", "admin_login_attempts?select=ip", service)).text);
  const testLeft = left.filter((x) => x.ip.startsWith("203.0.113.") || x.ip === "127.0.0.1");
  check("cleanup: no admin_login_attempts rows for test IPs", testLeft.length === 0, `test rows=${testLeft.length}; other rows (not touched)=${left.length - testLeft.length}`);
  const leftP = JSON.parse((await rest("GET", "participants?name=like.%5BTEST%5D*&select=id", service)).text);
  check("cleanup: no [TEST] participants", leftP.length === 0, JSON.stringify(leftP));
}
console.log(`\nRESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
