// Hosted user-data guard: counts (and a content digest) of every row that is NOT test data, before and after the hosted runs.
// Read-only. Prints counts and a SHA-256 digest only - never names or other row content.
// Non-test = sessions whose name does not start with "[TEST]" and everything that belongs to them;
// sun_counters whose uid is not a test UID (04C0FFEE...); admin_login_attempts whose ip is not a TEST-NET-3 test IP.
// Run: node user-data-baseline.mjs <label>   (reads SUPABASE_URL / service key from .env.local; never printed)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const envFile = readFileSync("/Users/kimgarden/dev/nfc-walk-race/.env.local", "utf8");
const env = (k) => new RegExp(`^${k}=(.*)$`, "m").exec(envFile)?.[1]?.trim();
const URL_ = env("SUPABASE_URL");
const KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function get(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${path.split("?")[0]} -> HTTP ${res.status}`);
  return res.json();
}
const digest = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);

const label = process.argv[2] ?? "snapshot";
const sessions = await get("sessions?select=*&name=not.like.%5BTEST%5D*&order=id");
const ids = sessions.map((s) => s.id);
const inIds = `in.(${ids.map((i) => `"${i}"`).join(",")})`;
const out = [`# hosted user-data baseline [${label}] ${new Date().toISOString()} (counts + digest of full rows; no content printed)`];
out.push(`sessions (non-[TEST]): ${sessions.length} digest=${digest(sessions)}`);
for (const table of ["tags", "teams", "participants", "tag_events", "announcements"]) {
  const rows = ids.length ? await get(`${table}?select=*&session_id=${inIds}&order=id`) : [];
  out.push(`${table} (in those sessions): ${rows.length} digest=${digest(rows)}`);
}
const counters = await get("sun_counters?select=*&uid=not.like.04C0FFEE*&order=uid,ctr");
out.push(`sun_counters (non-test UIDs): ${counters.length} digest=${digest(counters)}`);
const attempts = await get("admin_login_attempts?select=*&ip=not.like.203.0.113.*&order=ip");
out.push(`admin_login_attempts (non-test IPs, incl. 127.0.0.1 if any): ${attempts.length}`);
const testSessions = await get("sessions?select=id&name=like.%5BTEST%5D*");
out.push(`[TEST] sessions present: ${testSessions.length}`);
console.log(out.join("\n"));
