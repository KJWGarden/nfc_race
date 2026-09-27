import { clearAdminCookie, jsonOk } from "@/lib/auth";

export async function POST() {
  await clearAdminCookie();
  return jsonOk({ ok: true });
}
