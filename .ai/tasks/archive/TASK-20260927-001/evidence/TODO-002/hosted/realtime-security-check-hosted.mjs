// TODO-002 AC5 / AC6 against hosted Supabase Realtime via the app (http://localhost:3000).
// Also verifies whether hosted Realtime accepts the app-minted HS256 admin token.
// Own "[TEST]" session; changes are triggered through the admin API; session deleted at the end.
import { createHmac } from "node:crypto";
import { createClient } from "/Users/kimgarden/dev/nfc-walk-race/node_modules/@supabase/supabase-js/dist/index.mjs";
import { BASE, env, adminClient, createTestSession, cleanupSession } from "./hosted-lib.mjs";

const URL_ = env("NEXT_PUBLIC_SUPABASE_URL");
const PUBLIC_KEY = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const JWT_SECRET = env("SUPABASE_JWT_SECRET");
const T = 10000;

let failures = 0;
const log = (...a) => console.log(...a);
function assert(cond, label, detail = "") {
  if (!cond) failures++;
  log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
}

function jwt(claims, secret) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b(claims);
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
}
const now = () => Math.floor(Date.now() / 1000);

// subscribe and resolve with the first terminal status
async function join(client, topic, isPrivate, onMessage) {
  // same order as the app hook: resolve the access token before joining
  await client.realtime.setAuth();
  return new Promise((resolve) => {
    const ch = client
      .channel(topic, { config: { private: isPrivate } })
      .on("broadcast", { event: "change" }, (m) => onMessage?.(m))
      .subscribe((status, err) => {
        if (status !== "SUBSCRIBED" && status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return;
        resolve({ status, err: err?.message ?? "", ch });
      });
    setTimeout(() => resolve({ status: "NO_STATUS", err: "", ch }), T);
  });
}
const mk = (key, token) =>
  createClient(URL_, key, token ? { accessToken: async () => token } : { auth: { persistSession: false } });

// --- AC6: token route
const noCookie = await fetch(`${BASE}/api/admin/realtime-token`);
assert(noCookie.status === 401, "GET /api/admin/realtime-token without cookie -> 401", `${noCookie.status} ${await noCookie.text()}`);
const forged = await fetch(`${BASE}/api/admin/realtime-token`, { headers: { cookie: "cp_admin=ok.000000000000000000000000" } });
assert(forged.status === 401, "GET token with forged cp_admin cookie -> 401", String(forged.status));
const admin = await adminClient();
const adminCookie = admin.cookieHeader();
const { session: testSession } = await createTestSession(admin, "TODO-002 realtime security", ["S1"]);
const SESSION = testSession.id;
const TOPIC = `cp-admin:${SESSION}`;
log(`test session ${SESSION} (${testSession.name})`);
const openClients = [];
try {
const tokRes = await fetch(`${BASE}/api/admin/realtime-token`, { headers: { cookie: adminCookie } });
const tokJson = await tokRes.json();
const claims = JSON.parse(Buffer.from(tokJson.data.token.split(".")[1], "base64url").toString());
assert(
  tokRes.status === 200 && tokRes.headers.get("cache-control")?.includes("no-store") && claims.cp_role === "admin" && claims.role === "authenticated" && claims.exp - claims.iat === 3600,
  "GET token with admin cookie -> 200, no-store, claims {role:authenticated, cp_role:admin, ttl 3600}",
  JSON.stringify({ status: tokRes.status, cacheControl: tokRes.headers.get("cache-control"), claims: { ...claims, iat: "<n>", exp: "<n+3600>" } }),
);

// --- AC5 negative joins on the private admin topic
const keyKind = PUBLIC_KEY.startsWith("sb_publishable_") ? "publishable key" : "anon key";
const cases = [
  [`${keyKind} only, private channel`, mk(PUBLIC_KEY)],
  ["forged admin JWT (wrong secret)", mk(PUBLIC_KEY, jwt({ role: "authenticated", aud: "authenticated", cp_role: "admin", iat: now(), exp: now() + 600 }, "not-the-secret-not-the-secret-000"))],
  ["valid-signature authenticated JWT without cp_role", mk(PUBLIC_KEY, jwt({ role: "authenticated", aud: "authenticated", sub: "someone", iat: now(), exp: now() + 600 }, JWT_SECRET))],
  ["expired admin JWT", mk(PUBLIC_KEY, jwt({ role: "authenticated", aud: "authenticated", cp_role: "admin", iat: now() - 7200, exp: now() - 3600 }, JWT_SECRET))],
];
const negativeClients = [];
for (const [label, client] of cases) {
  const received = [];
  const r = await join(client, TOPIC, true, (m) => received.push(m));
  negativeClients.push({ label, client, received, r });
  assert(r.status !== "SUBSCRIBED", `private join denied: ${label}`, `${r.status} ${r.err}`);
}

// --- positive control: admin token joins private channel
const adminRt = mk(PUBLIC_KEY, tokJson.data.token);
const adminMsgs = [];
const adm = await join(adminRt, TOPIC, true, (m) => adminMsgs.push(m));
assert(adm.status === "SUBSCRIBED", "HOSTED HS256: app-minted admin token joins private cp-admin channel", `${adm.status} ${adm.err}`);

// --- eavesdrop: anon on a PUBLIC channel with the same topic name
const anonPublic = mk(PUBLIC_KEY);
const anonPublicMsgs = [];
const pub = await join(anonPublic, TOPIC, false, (m) => anonPublicMsgs.push(m));
log(`anon public-channel join on "${TOPIC}": ${pub.status}`);

// trigger DB changes through the app (admin API): session update + announcement insert
const marker = `rt-check-${Date.now()}`;
await admin.req(`/api/admin/sessions/${SESSION}`, { method: "PATCH", body: { description: "automated check; safe to delete" } });
await admin.req(`/api/admin/sessions/${SESSION}/announcements`, { method: "POST", body: { message: marker } });
const deadline = Date.now() + T;
while (adminMsgs.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
assert(adminMsgs.length >= 2, "admin receives change signals for admin-API update + announcement", String(adminMsgs.length));
// Realtime adds its own message "id" (uuid) to every broadcast payload; that is transport metadata, not row data
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
assert(
  adminMsgs.length > 0 &&
    adminMsgs.every(
      (m) =>
        Object.keys(m.payload).filter((k) => k !== "id").sort().join(",") === "sessionId,type" &&
        UUID.test(m.payload.id) &&
        m.payload.sessionId === SESSION,
    ),
  "signal payload carries only {type, sessionId} (+ Realtime message uuid id; no row data)",
  JSON.stringify(adminMsgs.map((m) => m.payload)),
);
// grace window after the admin (positive control) already received both signals
await new Promise((r) => setTimeout(r, 2000));
assert(anonPublicMsgs.length === 0, "anon PUBLIC channel with same topic received nothing", `${anonPublicMsgs.length} messages`);
for (const n of negativeClients) {
  assert(n.received.length === 0, `denied client received nothing: ${n.label}`, `${n.received.length} messages`);
}

// second admin receiver: broadcast defaults to self:false, so the sender's own channel is not a valid receiver
const adminClient2 = mk(PUBLIC_KEY, tokJson.data.token);
const admin2Msgs = [];
const adm2 = await join(adminClient2, TOPIC, true, (m) => admin2Msgs.push(m));
assert(adm2.status === "SUBSCRIBED", "second admin receiver joins", adm2.status);

// anon (public topic) and admin (private, no insert policy) client broadcasts must not reach admin receivers
const before = adminMsgs.length;
const before2 = admin2Msgs.length;
await pub.ch.send({ type: "broadcast", event: "change", payload: { type: "spoof", sessionId: SESSION } });
const adminSend = await adminRt.channel(TOPIC).send({ type: "broadcast", event: "change", payload: { type: "admin-spoof", sessionId: SESSION } });
await admin.req(`/api/admin/sessions/${SESSION}`, { method: "PATCH", body: { description: "automated check; safe to delete" } });
const d2 = Date.now() + T;
while (adminMsgs.length < before + 1 && Date.now() < d2) await new Promise((r) => setTimeout(r, 100));
await new Promise((r) => setTimeout(r, 1000));
while (admin2Msgs.length < before2 + 1 && Date.now() < d2) await new Promise((r) => setTimeout(r, 100));
const extra = adminMsgs.slice(before).map((m) => m.payload.type);
const extra2 = admin2Msgs.slice(before2).map((m) => m.payload.type);
assert(
  !extra.includes("spoof") && !extra2.includes("spoof") && !extra2.includes("admin-spoof") && extra.includes("sessions") && extra2.includes("sessions"),
  "client broadcasts (anon public, admin private) are not delivered; only DB signals arrive",
  `receiver1 ${JSON.stringify(extra)}, receiver2 ${JSON.stringify(extra2)} (admin send() result: ${adminSend})`,
);

openClients.push(...negativeClients.map((n) => n.client), adminRt, adminClient2, anonPublic);
} catch (err) {
  assert(false, `unexpected error: ${String(err.message).split("\n")[0]}`);
} finally {
  // always delete the [TEST] session (cascade) and record the evidence
  const cleanup = await cleanupSession(admin, SESSION);
  assert(cleanup.ok, cleanup.line);
  for (const c of openClients) await c.removeAllChannels();
}
log(`\nRESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
