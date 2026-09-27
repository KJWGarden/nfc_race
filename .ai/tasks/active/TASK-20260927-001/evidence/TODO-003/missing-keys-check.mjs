// TODO-003: dev server started WITHOUT SUN_META_KEY / SUN_MASTER_KEY -> POST /api/tag {e,c} must return 503
// without naming the variable, and consume nothing. (This script itself holds keys only to build a payload.)
import { adminClient, cleanupSession, countRows, createTestSession, participant, sun } from "./sun-lib.mjs";
let failures = 0;
const check = (l, c, d = "") => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"} ${l}${d ? ` -- ${d}` : ""}`); };
const admin = await adminClient();
const s = await createTestSession(admin, "SUN missing keys", ["K1"]);
try {
  const p = await participant(s.session.code, "K", { create: "[TEST] 팀K" });
  const r = await p.req("/api/tag", { method: "POST", body: sun("04C0FFEE0000AA", 5) });
  check("missing SUN env -> 503", r.status === 503, `${r.status} ${r.text}`);
  check("error does not name the variable", !/SUN_|META|MASTER/.test(r.text));
  check("nothing consumed", (await countRows("sun_counters", { uid: "eq.04C0FFEE0000AA" })) === 0);
  const t = await p.req("/api/tag", { method: "POST", body: { token: s.tags[0].token } });
  check("token path unaffected by missing SUN env (reaches race rules)", t.status === 400 && t.json.error.startsWith("세션이 진행 중이 아닙니다"), `${t.status} ${t.json?.error}`);
} finally {
  const c = await cleanupSession(admin, s.session.id);
  check("cleanup", c.ok, c.line);
}
console.log(`RESULT failures=${failures}`);
