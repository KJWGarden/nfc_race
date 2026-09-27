import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aesCmac,
  computeSdmMac,
  decryptPiccData,
  diversifyFileKey,
  encryptPiccData,
  sessionMacKey,
  verifySunPayload,
} from "../src/lib/sun.ts";

// 기능: NXP AN12196 Rev 2.0 공개 벡터와 음성 사례로 SUN 검증 모듈을 확인한다

const ZERO_KEY = Buffer.alloc(16);
const hex = (b: Buffer) => b.toString("hex").toUpperCase();

// AN12196 Table 2 / Table 4: 두 키 모두 0
const E = "EF963FF7828658A599F3041510671E88";
const C = "94EED9EE65337086";
const UID = "04DE5F1EACC040";

test("AN12196 Table 2: PICCData decrypts to published UID and counter", () => {
  const picc = decryptPiccData(ZERO_KEY, Buffer.from(E, "hex"));
  assert.deepEqual(picc, { uid: UID, ctr: 61 });
});

test("AN12196 Table 4: session MAC key and SDMMAC", () => {
  assert.equal(hex(sessionMacKey(ZERO_KEY, UID, 61)), "3FB5F6E3A807A03D5E3570ACE393776F");
  assert.equal(hex(computeSdmMac(ZERO_KEY, UID, 61)), C);
});

test("AN12196 Table 4: full payload verifies", () => {
  assert.deepEqual(verifySunPayload(E, C, ZERO_KEY, () => ZERO_KEY), { ok: true, uid: UID, ctr: 61 });
  assert.deepEqual(verifySunPayload(E.toLowerCase(), C.toLowerCase(), ZERO_KEY, () => ZERO_KEY), {
    ok: true,
    uid: UID,
    ctr: 61,
  });
});

test("AN12196 Table 1: session key from non-zero file key", () => {
  const k = Buffer.from("5ACE7E50AB65D5D51FD5BF5A16B8205B", "hex");
  const sv2 = Buffer.from("3CC30001008004C767F2066180010000", "hex");
  assert.equal(hex(aesCmac(k, sv2)), "3A3E8110E05311F7A3FCF0D969BF2B48");
  assert.equal(hex(sessionMacKey(k, "04C767F2066180", 1)), "3A3E8110E05311F7A3FCF0D969BF2B48");
});

test("AN12196 Table 5: multi-block MAC input", () => {
  assert.equal(hex(sessionMacKey(ZERO_KEY, "04958CAA5C5E80", 8)), "3ED0920E5E6A0320D823D5987FEAFBB1");
  const input = Buffer.from("CEE9A53E3E463EF1F459635736738962&cmac=", "ascii");
  assert.equal(hex(computeSdmMac(ZERO_KEY, "04958CAA5C5E80", 8, input)), "ECC1E7F6C6C73BF6");
});

test("tampered MAC byte is rejected", () => {
  const flipped = (parseInt(C.slice(0, 2), 16) ^ 0x01).toString(16).padStart(2, "0") + C.slice(2);
  assert.deepEqual(verifySunPayload(E, flipped, ZERO_KEY, () => ZERO_KEY), { ok: false, reason: "mac" });
});

test("wrong meta key cannot decrypt PICCData", () => {
  const wrong = Buffer.from("00112233445566778899AABBCCDDEEFF", "hex");
  assert.deepEqual(verifySunPayload(E, C, wrong, () => ZERO_KEY), { ok: false, reason: "decrypt" });
});

test("wrong file key fails the MAC", () => {
  const wrong = Buffer.from("00112233445566778899AABBCCDDEEFF", "hex");
  assert.deepEqual(verifySunPayload(E, C, ZERO_KEY, () => wrong), { ok: false, reason: "mac" });
});

test("malformed parameters are rejected before crypto", () => {
  for (const [e, c] of [
    ["", C],
    [E, ""],
    [E.slice(2), C],
    [E, C + "00"],
    ["ZZ" + E.slice(2), C],
  ]) {
    assert.deepEqual(verifySunPayload(e, c, ZERO_KEY, () => ZERO_KEY), { ok: false, reason: "format" });
  }
});

// 기능: 키 다양화 회귀 벡터 (이 프로젝트에서 정의한 함수이므로 자체 생성 값으로 고정)
test("file key diversification is stable and UID-specific", () => {
  const master = Buffer.from("000102030405060708090A0B0C0D0E0F", "hex");
  const expected = hex(
    aesCmac(master, Buffer.concat([Buffer.from([1]), Buffer.from(UID, "hex"), Buffer.from("CHECKPOINT-SDM")])),
  );
  assert.equal(hex(diversifyFileKey(master, UID)), expected);
  assert.equal(hex(diversifyFileKey(master, UID)), "B82FAD8284148310F69239D19905AB8D");
  assert.notEqual(hex(diversifyFileKey(master, "04A1B2C3D4E5F6")), expected);
});

test("generated payload round-trips with diversified key; counter boundaries", () => {
  const meta = Buffer.from("F0E1D2C3B4A5968778695A4B3C2D1E0F", "hex");
  const master = Buffer.from("0F1E2D3C4B5A69788796A5B4C3D2E1F0", "hex");
  for (const ctr of [0, 1, 255, 256, 65536, 0xffffff]) {
    const uid = "04A1B2C3D4E5F6";
    const e = hex(encryptPiccData(meta, uid, ctr, Buffer.from("0102030405", "hex")));
    const c = hex(computeSdmMac(diversifyFileKey(master, uid), uid, ctr));
    assert.deepEqual(verifySunPayload(e, c, meta, (u) => diversifyFileKey(master, u)), { ok: true, uid, ctr });
    // 다른 UID 의 키로는 통과하지 않는다
    assert.deepEqual(verifySunPayload(e, c, meta, () => diversifyFileKey(master, "04000000000000")), {
      ok: false,
      reason: "mac",
    });
  }
});
