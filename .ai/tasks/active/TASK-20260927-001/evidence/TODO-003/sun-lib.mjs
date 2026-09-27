// Shared helpers for TODO-003 SUN API checks through the app (http://127.0.0.1:3000).
// Config comes from the process environment (same values the dev server was started with).
// CHECK_TARGET=hosted reads Supabase values from .env.local instead (hosted project; no psql / db reset / seed).
// Every check creates its own "[TEST]" sessions via the admin API and deletes them at the end.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  computeSdmMac,
  diversifyFileKey,
  encryptPiccData,
  parseKeyHex,
} from "/Users/kimgarden/dev/nfc-walk-race/src/lib/sun.ts";

export const BASE = "http://127.0.0.1:3000";
export const TARGET = process.env.CHECK_TARGET === "hosted" ? "hosted" : "local";

const envFile =
  TARGET === "hosted" ? readFileSync("/Users/kimgarden/dev/nfc-walk-race/.env.local", "utf8") : "";
// process env wins (same precedence as Next's env loading)
export const env = (k) => process.env[k] ?? new RegExp(`^${k}=(.*)$`, "m").exec(envFile)?.[1]?.trim();

// guard: the browser-exposed key must never be a service_role key
{
  const pub = env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? "";
  const role = pub.startsWith("sb_")
    ? pub.startsWith("sb_secret_") ? "service_role" : "public"
    : JSON.parse(Buffer.from(pub.split(".")[1] ?? "", "base64url").toString() || "{}").role;
  if (role === "service_role") {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is a service_role/secret key; refusing to run");
  }
}

const metaKey = parseKeyHex(env("SUN_META_KEY"));
const masterKey = parseKeyHex(env("SUN_MASTER_KEY"));
if (!metaKey || !masterKey) throw new Error("SUN_META_KEY / SUN_MASTER_KEY missing");

// secret values that must never appear in responses or rows (AC7)
export function secretStrings(uids) {
  const out = [metaKey, masterKey, ...uids.map((u) => diversifyFileKey(masterKey, u))].map((b) =>
    b.toString("hex"),
  );
  return out.flatMap((h) => [h.toLowerCase(), h.toUpperCase()]);
}

// SUN payload exactly like a tag would produce it
export function sun(uid, ctr) {
  const e = encryptPiccData(metaKey, uid, ctr, randomBytes(5)).toString("hex").toUpperCase();
  const c = computeSdmMac(diversifyFileKey(masterKey, uid), uid, ctr).toString("hex").toUpperCase();
  return { e, c };
}

async function rest(method, table, params, body, prefer) {
  const url = new URL(`${env("SUPABASE_URL")}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (res.status >= 300) throw new Error(`${method} ${table} -> HTTP ${res.status} ${await res.text()}`);
  return res;
}

export async function countRows(table, filters) {
  const res = await rest("HEAD", table, { select: "*", ...filters }, null, "count=exact");
  return Number(res.headers.get("content-range")?.split("/")[1]);
}

export async function selectRows(table, filters, select = "*") {
  return (await rest("GET", table, { select, ...filters })).json();
}

// test-only DB write: set a tag baseline (the admin UI/API for this is TODO-004)
export async function setBaseline(tagId, ctr) {
  await rest("PATCH", "tags", { id: `eq.${tagId}` }, { baseline_ctr: ctr, baseline_at: new Date().toISOString() });
}

export async function deleteSunCounters(uid) {
  const before = await countRows("sun_counters", { uid: `eq.${uid}` });
  await rest("DELETE", "sun_counters", { uid: `eq.${uid}` });
  const after = await countRows("sun_counters", { uid: `eq.${uid}` });
  return { before, after };
}

export async function sessionRowCounts(sessionId) {
  const f = { session_id: `eq.${sessionId}` };
  return [
    await countRows("sessions", { id: `eq.${sessionId}` }),
    await countRows("tags", f),
    await countRows("teams", f),
    await countRows("participants", f),
    await countRows("tag_events", f),
    await countRows("announcements", f),
  ].join(",");
}

export class Client {
  constructor() {
    this.cookies = new Map();
  }
  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async req(path, { method = "GET", body } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", cookie: this.cookieHeader() },
      body: body == null ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  }
}

export async function adminClient() {
  const admin = new Client();
  const r = await admin.req("/api/admin/login", { method: "POST", body: { password: env("ADMIN_PASSWORD") } });
  if (r.status !== 200) throw new Error(`admin login -> HTTP ${r.status}`);
  return admin;
}

// throwaway session with N tags, all names prefixed "[TEST]"
export async function createTestSession(admin, label, tagNames) {
  const created = await admin.req("/api/admin/sessions", {
    method: "POST",
    body: {
      name: `[TEST] ${label} ${new Date().toISOString()}`,
      description: "automated check; safe to delete",
      checkpointCount: tagNames.length,
      awardRanks: 3,
    },
  });
  if (created.status !== 200) throw new Error(`create session -> HTTP ${created.status} ${created.text}`);
  const session = created.json.data;
  const tags = [];
  for (const name of tagNames) {
    const r = await admin.req(`/api/admin/sessions/${session.id}/tags`, {
      method: "POST",
      body: { name, hint: `${name} 힌트`, nextHint: `${name} 다음 안내`, locationNote: "" },
    });
    tags.push(r.json.data);
  }
  return { session, tags };
}

export async function cleanupSession(admin, sessionId) {
  const before = await sessionRowCounts(sessionId).catch((e) => `error ${e.message}`);
  const del = await admin.req(`/api/admin/sessions/${sessionId}`, { method: "DELETE" });
  const after = await sessionRowCounts(sessionId).catch((e) => `error ${e.message}`);
  const get = await admin.req(`/api/admin/sessions/${sessionId}`);
  return {
    ok: after === "0,0,0,0,0,0" && get.status === 404,
    line: `cleanup session ${sessionId}: DELETE -> ${del.status}; rows (sessions,tags,teams,participants,tag_events,announcements) before=${before} after=${after}; GET -> ${get.status}`,
  };
}

// participant who joined the session and created (or joined) a team
export async function participant(code, name, team) {
  const p = new Client();
  const j = await p.req("/api/join", { method: "POST", body: { code, name } });
  if (j.status !== 200) throw new Error(`join -> ${j.status} ${j.text}`);
  if (team?.create) {
    const t = await p.req("/api/teams", { method: "POST", body: { name: team.create } });
    if (t.status !== 200) throw new Error(`team -> ${t.status} ${t.text}`);
    p.joinCode = t.json.data.team.joinCode;
  } else if (team?.join) {
    const t = await p.req("/api/teams/join", { method: "POST", body: { joinCode: team.join } });
    if (t.status !== 200) throw new Error(`team join -> ${t.status} ${t.text}`);
  }
  return p;
}
