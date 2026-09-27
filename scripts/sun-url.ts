// 검증용 SUN URL 생성기. 실제 태그 없이 API·브라우저 검증을 하기 위한 개발 도구이며 앱 코드에서 import 하지 않는다.
//
// 사용법:
//   node --env-file=.env.local scripts/sun-url.ts --uid 04A1B2C3D4E5F6 --ctr 12 [--origin http://127.0.0.1:3000] [--json]
//
// 키는 SUN_META_KEY / SUN_MASTER_KEY 환경 변수(32자리 hex)에서 읽는다. 출력: <origin>/t/s?e=<PICCData>&c=<SDMMAC>
import { randomBytes } from "node:crypto";
import { computeSdmMac, diversifyFileKey, encryptPiccData, MAX_SDM_COUNTER, parseKeyHex, UID_PATTERN } from "../src/lib/sun.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const uid = (arg("uid") ?? "").toUpperCase();
const ctr = Number(arg("ctr"));
const origin = (arg("origin") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
if (!UID_PATTERN.test(uid)) fail("--uid 는 14자리 hex (7바이트 UID) 여야 합니다.");
if (!Number.isInteger(ctr) || ctr < 0 || ctr > MAX_SDM_COUNTER) fail("--ctr 는 0..16777215 정수여야 합니다.");

const metaKey = parseKeyHex(process.env.SUN_META_KEY);
const masterKey = parseKeyHex(process.env.SUN_MASTER_KEY);
if (!metaKey || !masterKey) fail("SUN_META_KEY / SUN_MASTER_KEY (32자리 hex) 환경 변수가 필요합니다.");

// 기능: 실제 태그와 같은 형식으로 PICCData 암호화(임의 패딩 5바이트)와 SDMMAC 계산
const e = encryptPiccData(metaKey, uid, ctr, randomBytes(5)).toString("hex").toUpperCase();
const c = computeSdmMac(diversifyFileKey(masterKey, uid), uid, ctr).toString("hex").toUpperCase();
const url = `${origin}/t/s?e=${e}&c=${c}`;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ uid, ctr, e, c, url }));
} else {
  console.log(url);
}
