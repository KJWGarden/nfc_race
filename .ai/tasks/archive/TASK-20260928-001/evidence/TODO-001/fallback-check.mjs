// Deploy-window check (analysis Q3): when record_static_tag does not exist yet (migration not applied),
// POST /api/tag {token} must keep today's 400 {"ok":false,"error":"태그 정보가 없습니다."} instead of a 500.
// LOCAL stack only: temporarily renames the function via psql, reloads the PostgREST schema cache, then restores it.
import { execFileSync } from "node:child_process";
import {
  TARGET,
  adminClient,
  cleanupSession,
  createTestSession,
  participant,
} from "../../../../archive/TASK-20260927-001/evidence/TODO-003/sun-lib.mjs";

if (TARGET !== "local") throw new Error("fallback check runs on the local stack only");
const DB = "postgresql://postgres:postgres@127.0.0.1:55422/postgres";
const psql = (sql) => execFileSync("psql", [DB, "-Atc", sql], { encoding: "utf8" }).trim();
const DISABLED_BODY = JSON.stringify({ ok: false, error: "태그 정보가 없습니다." });

async function waitFor(pred) {
  for (let i = 0; i < 50; i++) {
    if (await pred()) return true;
    await new Promise((res) => setTimeout(res, 200));
  }
  return false;
}

let failures = 0;
function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` -- ${detail}` : ""}`);
}

const admin = await adminClient();
const s = await createTestSession(admin, "static fallback", ["F1"]);
try {
  await admin.req(`/api/admin/sessions/${s.session.id}`, { method: "PATCH", body: { allowStaticUrl: true, status: "live" } });
  const p = await participant(s.session.code, "폴백", { create: "폴백팀" });
  psql("alter function public.record_static_tag(text, text, text) rename to record_static_tag_hidden; notify pgrst, 'reload schema';");
  let r;
  const hidden = await waitFor(async () => {
    r = await p.req("/api/tag", { method: "POST", body: { token: s.tags[0].token } });
    return r.text === DISABLED_BODY;
  });
  check("function missing -> 400 byte-equal old body (no 500)", hidden && r.status === 400, `${r.status} ${r.text}`);
  check("function missing -> 0 tag_events", psql(`select count(*) from public.tag_events where session_id = '${s.session.id}'`) === "0");
} finally {
  psql(
    "do $$ begin if to_regprocedure('public.record_static_tag_hidden(text, text, text)') is not null then " +
      "alter function public.record_static_tag_hidden(text, text, text) rename to record_static_tag; end if; end $$; " +
      "notify pgrst, 'reload schema';",
  );
  console.log(`restored: ${psql("select count(*) from pg_proc where proname = 'record_static_tag'")} record_static_tag`);
  console.log((await cleanupSession(admin, s.session.id)).line);
}
console.log(failures === 0 ? "ALL PASS" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
