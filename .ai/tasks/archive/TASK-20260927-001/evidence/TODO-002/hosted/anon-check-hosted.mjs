// TODO-001 AC4 / TODO-002 AC5 on hosted Supabase: the public (anon/publishable) key alone cannot read or write app data
// or execute app functions. HTTP only (no catalog access on hosted); the key value is never printed.
import { env } from "./hosted-lib.mjs";

const URL_ = env("NEXT_PUBLIC_SUPABASE_URL");
const KEY = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
let failures = 0;
const denied = (status, body) => status === 401 || status === 403 || (status === 200 && body === "[]") || /42501|permission denied/.test(body) || (status === 404 && /PGRST202/.test(body)); // PGRST202: function not exposed (e.g. trigger function)

async function check(label, method, path, body) {
  const res = await fetch(`${URL_}${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const ok = denied(res.status, text);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label} -> HTTP ${res.status} ${text.slice(0, 160)}`);
}

console.log(`# anon-key check against ${new URL(URL_).host} at ${new Date().toISOString()} (key value not recorded)`);
for (const t of ["sessions", "tags", "teams", "participants", "tag_events", "announcements"]) {
  await check(`GET ${t}`, "GET", `/rest/v1/${t}?select=*`);
}
await check("POST sessions (insert)", "POST", "/rest/v1/sessions", { id: "HACKTEST", name: "[TEST] hack", code: "HACK01", checkpoint_count: 1, award_ranks: 1 });
await check("PATCH sessions (update all)", "PATCH", "/rest/v1/sessions?id=neq.x", { status: "live" });
await check("DELETE tags (all)", "DELETE", "/rest/v1/tags?id=neq.x");
const rpcs = {
  record_tag: { p_participant_id: "x", p_token: "x", p_uid: null, p_event_id: "x" },
  get_admin_live_data: { p_session_id: "x" },
  get_team_race_data: { p_participant_id: "x" },
  create_team: { p_participant_id: "x", p_team_id: "x", p_name: "x", p_join_code: "XXXX" },
  join_team: { p_participant_id: "x", p_join_code: "XXXX" },
  create_announcement: { p_session_id: "x", p_id: "x", p_message: "x" },
  create_tag: { p_session_id: "x", p_id: "x", p_token: "x", p_uid: "", p_name: "x", p_position: null, p_hint: "", p_next_hint: "", p_location_note: "" },
  required_checkpoints: { p_session_id: "x" },
  notify_admin_change: {},
};
for (const [fn, body] of Object.entries(rpcs)) await check(`RPC ${fn}`, "POST", `/rest/v1/rpc/${fn}`, body);
console.log(`\nRESULT failures=${failures}`);
process.exit(failures ? 1 : 0);
