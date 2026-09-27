import { jsonError, jsonOk, setParticipantCookie } from "@/lib/auth";
import { store } from "@/lib/db";

export async function POST(request: Request) {
  const body = (await request.json()) as { code?: string; name?: string };
  const code = body.code?.trim();
  const name = body.name?.trim();
  if (!code) return jsonError("세션 코드를 입력해 주세요.");
  if (!name) return jsonError("이름을 입력해 주세요.");
  const result = await store.joinSession(code, name);
  if (!result.ok) return jsonError(result.error);
  await setParticipantCookie(result.participant.id);
  return jsonOk(result);
}
