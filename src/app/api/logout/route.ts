import { clearParticipantCookie, jsonOk } from "@/lib/auth";

export async function POST() {
  await clearParticipantCookie();
  return jsonOk({ ok: true });
}
