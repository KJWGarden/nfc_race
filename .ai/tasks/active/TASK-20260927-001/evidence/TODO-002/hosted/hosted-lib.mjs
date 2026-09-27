// Shared helpers for checks against the hosted Supabase project through the app (http://localhost:3000).
// Rules: no psql / db reset / seed; every check creates its own "[TEST]" session via the admin API and deletes it.
import { readFileSync } from "node:fs";

export const BASE = "http://127.0.0.1:3000";
const envFile = readFileSync("/Users/kimgarden/dev/nfc-walk-race/.env.local", "utf8");
export const env = (k) => new RegExp(`^${k}=(.*)$`, "m").exec(envFile)?.[1]?.trim();

// guard: the browser-exposed key must never be a service_role key
{
  const pub = env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? "";
  const role = pub.startsWith("sb_")
    ? (pub.startsWith("sb_secret_") ? "service_role" : "public")
    : JSON.parse(Buffer.from(pub.split(".")[1] ?? "", "base64url").toString() || "{}").role;
  if (role === "service_role") {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is a service_role/secret key; refusing to run");
  }
}

// read-only row counts via PostgREST with the server key (replaces the local psql queries)
export async function countRows(table, filters) {
  const url = new URL(`${env("SUPABASE_URL")}/rest/v1/${table}`);
  url.searchParams.set("select", "id");
  for (const [k, v] of Object.entries(filters)) url.searchParams.set(k, v);
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(url, {
    method: "HEAD",
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
  });
  if (res.status >= 300) throw new Error(`count ${table} -> HTTP ${res.status}`);
  return Number(res.headers.get("content-range")?.split("/")[1]);
}

export async function selectRows(table, filters, select) {
  const url = new URL(`${env("SUPABASE_URL")}/rest/v1/${table}`);
  url.searchParams.set("select", select);
  for (const [k, v] of Object.entries(filters)) url.searchParams.set(k, v);
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (res.status >= 300) throw new Error(`select ${table} -> HTTP ${res.status}`);
  return res.json();
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
    const json = await res.json().catch(() => null);
    return { status: res.status, json, headers: res.headers };
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
    body: { name: `[TEST] ${label} ${new Date().toISOString()}`, description: "automated check; safe to delete", checkpointCount: tagNames.length, awardRanks: 3 },
  });
  if (created.status !== 200) throw new Error(`create session -> HTTP ${created.status} ${JSON.stringify(created.json)}`);
  const session = created.json.data;
  const tags = [];
  for (const name of tagNames) {
    const r = await admin.req(`/api/admin/sessions/${session.id}/tags`, {
      method: "POST",
      body: { name, hint: `${name} 힌트`, nextHint: "", locationNote: "" },
    });
    tags.push(r.json.data);
  }
  return { session, tags };
}

// delete the session (FK cascade) and return evidence lines
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
