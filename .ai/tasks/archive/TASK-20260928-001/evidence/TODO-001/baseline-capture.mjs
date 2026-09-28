// Pre-change capture of POST /api/tag responses for non-SUN bodies (AC3/AC6 baseline).
// Run against the local stack BEFORE the TODO-001 code change: node baseline-capture.mjs
import {
  TARGET,
  Client,
  adminClient,
  cleanupSession,
  createTestSession,
  participant,
} from "../../../../archive/TASK-20260927-001/evidence/TODO-003/sun-lib.mjs";

if (TARGET !== "local") throw new Error("baseline capture runs on the local stack only");
const admin = await adminClient();
const s = await createTestSession(admin, "static baseline", ["B1"]);
try {
  const withTeam = await participant(s.session.code, "기준팀원", { create: "기준팀" });
  const noTeam = await participant(s.session.code, "무소속");
  const bodies = [
    ["token", { token: s.tags[0].token }],
    ["uid", { uid: "04C0FFEE0000AA" }],
    ["token+uid", { token: s.tags[0].token, uid: "04C0FFEE0000AA" }],
    ["empty", {}],
  ];
  for (const [who, p] of [["team", withTeam], ["no-team", noTeam], ["no-cookie", new Client()]]) {
    for (const [label, body] of bodies) {
      const r = await p.req("/api/tag", { method: "POST", body });
      console.log(`${who} ${label} -> ${r.status} ${r.text}`);
    }
  }
} finally {
  console.log((await cleanupSession(admin, s.session.id)).line);
}
