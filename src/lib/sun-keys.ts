import "server-only";
import { diversifyFileKey, parseKeyHex, verifySunPayload } from "./sun";

export const SUN_CONFIG_ERROR = "서버 설정 오류입니다. 관리자에게 문의해 주세요.";

// 기능: SUN 키는 서버 전용 환경 변수에서 요청 시점에 읽는다 (빌드 시점·클라이언트 번들에 포함되지 않음)
// SUN_META_KEY: 모든 태그 공통 SDM 메타 읽기 키, SUN_MASTER_KEY: UID 별 파일 읽기 키를 유도하는 마스터 키
function sunKeys(): { metaKey: Buffer; masterKey: Buffer } | null {
  const metaKey = parseKeyHex(process.env.SUN_META_KEY);
  const masterKey = parseKeyHex(process.env.SUN_MASTER_KEY);
  if (!metaKey || !masterKey) return null;
  return { metaKey, masterKey };
}

export type VerifySunResult =
  | { ok: true; uid: string; ctr: number }
  | { ok: false; error: string; status: number };

// 기능: SUN 파라미터를 검증해 UID·카운터만 반환한다. 기록은 하지 않는다 (관리자 등록에서도 사용)
export function verifySun(e: string, c: string): VerifySunResult {
  const keys = sunKeys();
  if (!keys) return { ok: false, error: SUN_CONFIG_ERROR, status: 503 };
  const result = verifySunPayload(e.trim(), c.trim(), keys.metaKey, (uid) =>
    diversifyFileKey(keys.masterKey, uid),
  );
  if (!result.ok) return { ok: false, error: "유효하지 않은 태그입니다.", status: 400 };
  return { ok: true, uid: result.uid, ctr: result.ctr };
}

// 기능: 관리자에게 보여 줄 UID 별 SDM 파일 읽기 키 (NXP 도구로 태그에 설정). 키 설정이 없으면 null
export function fileReadKeyFor(uid: string): string | null {
  const keys = sunKeys();
  if (!keys) return null;
  return diversifyFileKey(keys.masterKey, uid).toString("hex").toUpperCase();
}
