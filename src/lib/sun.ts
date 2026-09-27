import { createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";

// 기능: NTAG 424 DNA SUN(SDM) 검증용 순수 암호 함수 (NXP AN12196).
// node:crypto 만 사용하고 Node 타입 제거로 바로 실행되도록 지울 수 있는 TS 문법만 쓴다.

export const SUN_E_PATTERN = /^[0-9A-Fa-f]{32}$/;
export const SUN_C_PATTERN = /^[0-9A-Fa-f]{16}$/;
export const UID_PATTERN = /^[0-9A-F]{14}$/;
export const MAX_SDM_COUNTER = 0xffffff;

// PICCDataTag 0xC7 = UID 미러링 + 카운터 미러링 + UID 7바이트 (AN12196 Table 2)
const PICC_DATA_TAG = 0xc7;
const ZERO_IV = Buffer.alloc(16);
const DIVERSIFY_LABEL = Buffer.from("CHECKPOINT-SDM", "ascii");

export type SunVerifyResult =
  | { ok: true; uid: string; ctr: number }
  | { ok: false; reason: "format" | "decrypt" | "mac" };

// 기능: 32자리 hex 문자열을 AES-128 키로 변환 (형식이 틀리면 null)
export function parseKeyHex(hex: string | undefined): Buffer | null {
  if (!hex || !/^[0-9A-Fa-f]{32}$/.test(hex.trim())) return null;
  return Buffer.from(hex.trim(), "hex");
}

function aesEcbBlock(key: Buffer, block: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

// 기능: CMAC 서브키 생성용 1비트 왼쪽 시프트 (최상위 비트가 1이면 0x87 XOR)
function shiftSubkey(input: Buffer): Buffer {
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    out[i] = ((input[i] << 1) | (i < 15 ? input[i + 1] >> 7 : 0)) & 0xff;
  }
  if (input[0] & 0x80) out[15] ^= 0x87;
  return out;
}

// 기능: AES-CMAC (NIST SP 800-38B). Node 에 내장 CMAC 이 없어 AES-ECB/CBC 로 구현한다.
export function aesCmac(key: Buffer, message: Buffer): Buffer {
  const k1 = shiftSubkey(aesEcbBlock(key, Buffer.alloc(16)));
  const k2 = shiftSubkey(k1);
  const complete = message.length > 0 && message.length % 16 === 0;
  const padded = Buffer.alloc(complete ? message.length : (Math.floor(message.length / 16) + 1) * 16);
  message.copy(padded);
  if (!complete) padded[message.length] = 0x80;
  const subkey = complete ? k1 : k2;
  const last = padded.length - 16;
  for (let i = 0; i < 16; i++) padded[last + i] ^= subkey[i];
  const cipher = createCipheriv("aes-128-cbc", key, ZERO_IV);
  cipher.setAutoPadding(false);
  const out = Buffer.concat([cipher.update(padded), cipher.final()]);
  return out.subarray(out.length - 16);
}

function counterBytes(ctr: number): Buffer {
  return Buffer.from([ctr & 0xff, (ctr >> 8) & 0xff, (ctr >> 16) & 0xff]);
}

// 기능: 암호화된 PICCData 복호화 → UID(대문자 hex)·SDMReadCtr (태그 바이트가 0xC7 이 아니면 null)
export function decryptPiccData(metaKey: Buffer, encrypted: Buffer): { uid: string; ctr: number } | null {
  const decipher = createDecipheriv("aes-128-cbc", metaKey, ZERO_IV);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  if (plain[0] !== PICC_DATA_TAG) return null;
  return {
    uid: plain.subarray(1, 8).toString("hex").toUpperCase(),
    ctr: plain[8] | (plain[9] << 8) | (plain[10] << 16),
  };
}

// 기능: 검증 도구용 PICCData 암호화 (C7 ‖ UID ‖ 카운터 LE ‖ 임의 5바이트)
export function encryptPiccData(metaKey: Buffer, uid: string, ctr: number, padding: Buffer): Buffer {
  const plain = Buffer.concat([Buffer.from([PICC_DATA_TAG]), Buffer.from(uid, "hex"), counterBytes(ctr), padding]);
  const cipher = createCipheriv("aes-128-cbc", metaKey, ZERO_IV);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
}

// 기능: SV2 = 3CC300010080 ‖ UID ‖ 카운터(LE) 로 세션 MAC 키 유도 (AN12196 Table 1)
export function sessionMacKey(fileKey: Buffer, uid: string, ctr: number): Buffer {
  const sv2 = Buffer.concat([Buffer.from("3CC300010080", "hex"), Buffer.from(uid, "hex"), counterBytes(ctr)]);
  return aesCmac(fileKey, sv2);
}

// 기능: 전체 CMAC 의 홀수 번째 바이트 8개를 SDMMAC 으로 사용 (AN12196 §3.4.4)
export function computeSdmMac(fileKey: Buffer, uid: string, ctr: number, macInput: Buffer = Buffer.alloc(0)): Buffer {
  const full = aesCmac(sessionMacKey(fileKey, uid, ctr), macInput);
  const out = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) out[i] = full[i * 2 + 1];
  return out;
}

// 기능: 태그별 SDM 파일 읽기 키 = CMAC(마스터 키, 01 ‖ UID ‖ "CHECKPOINT-SDM") (AN10922 방식, 호환 주장 없음)
export function diversifyFileKey(masterKey: Buffer, uid: string): Buffer {
  return aesCmac(masterKey, Buffer.concat([Buffer.from([0x01]), Buffer.from(uid, "hex"), DIVERSIFY_LABEL]));
}

// 기능: SUN 파라미터(e=PICCData, c=SDMMAC) 검증. MAC 입력은 빈 값 (SDMMACInputOffset == SDMMACOffset)
export function verifySunPayload(
  e: string,
  c: string,
  metaKey: Buffer,
  fileKeyFor: (uid: string) => Buffer,
): SunVerifyResult {
  if (!SUN_E_PATTERN.test(e) || !SUN_C_PATTERN.test(c)) return { ok: false, reason: "format" };
  const picc = decryptPiccData(metaKey, Buffer.from(e, "hex"));
  if (!picc) return { ok: false, reason: "decrypt" };
  const expected = computeSdmMac(fileKeyFor(picc.uid), picc.uid, picc.ctr);
  if (!timingSafeEqual(expected, Buffer.from(c, "hex"))) return { ok: false, reason: "mac" };
  return { ok: true, uid: picc.uid, ctr: picc.ctr };
}
