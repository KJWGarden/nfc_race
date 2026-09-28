import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const ADMIN_COOKIE = "cp_admin";
const PARTICIPANT_COOKIE = "cp_pid";
const DEFAULT_APP_SECRET = "checkpoint-dev-secret";
const DEFAULT_ADMIN_PASSWORD = "admin123";

export const CONFIG_ERROR = "서버 설정이 올바르지 않습니다. 운영자에게 문의해 주세요.";

function secret() {
  return process.env.APP_SECRET || DEFAULT_APP_SECRET;
}

function adminPassword() {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
}

// 기능: 운영(NODE_ENV=production)에서 비었거나 기본값인 비밀 환경 변수의 이름 목록. 값은 절대 담지 않는다.
export function configErrors(): string[] {
  if (process.env.NODE_ENV !== "production") return [];
  const invalid: string[] = [];
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password === DEFAULT_ADMIN_PASSWORD) invalid.push("ADMIN_PASSWORD");
  const appSecret = process.env.APP_SECRET;
  if (!appSecret || appSecret === DEFAULT_APP_SECRET) invalid.push("APP_SECRET");
  return invalid;
}

let configErrorLogged = false;

// 기능: 설정 오류면 503 응답을 돌려준다 (쿠키를 읽거나 쓰기 전에 route handler 첫 줄에서 호출). 로그는 프로세스당 한 번, 변수 이름만.
export function configGuard(): Response | null {
  const invalid = configErrors();
  if (invalid.length === 0) return null;
  if (!configErrorLogged) {
    configErrorLogged = true;
    console.error(`[config] invalid (unset, empty or default): ${invalid.join(", ")}`);
  }
  return jsonError(CONFIG_ERROR, 503);
}

// 기능: 관리자 비밀번호를 고정 길이 해시로 비교해 길이·내용에 따른 시간 차이를 줄인다
export function checkAdminPassword(input: unknown) {
  if (typeof input !== "string" || !input) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(input), digest(adminPassword()));
}

// 기능: 로그인 제한 키로 쓸 클라이언트 IP. Vercel 은 x-forwarded-for 를 직접 덮어쓰므로 첫 값을 신뢰한다.
// next start 로 직접 운영하면 클라이언트가 보낸 값이 유지되므로 앞단 프록시가 이 헤더를 덮어써야 한다.
export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return ip.toLowerCase().slice(0, 64);
}

function sign(value: string) {
  const sig = createHmac("sha256", secret()).update(value).digest("hex").slice(0, 24);
  return `${value}.${sig}`;
}

function unsign(raw: string | undefined) {
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return null;
  const value = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = createHmac("sha256", secret()).update(value).digest("hex").slice(0, 24);
  if (sig !== expected) return null;
  return value;
}

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

export async function setAdminCookie() {
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, sign("ok"), { ...cookieBase, maxAge: 60 * 60 * 24 * 7 });
}

export async function clearAdminCookie() {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
}

export async function isAdmin() {
  // 변경: 운영 설정 오류(기본 비밀 값)면 기본 키로 위조된 쿠키를 받아들이지 않도록 항상 거부
  if (configErrors().length > 0) return false;
  const jar = await cookies();
  return unsign(jar.get(ADMIN_COOKIE)?.value) === "ok";
}

export async function setParticipantCookie(participantId: string) {
  const jar = await cookies();
  jar.set(PARTICIPANT_COOKIE, sign(participantId), {
    ...cookieBase,
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function getParticipantId() {
  // 변경: 운영 설정 오류면 참가자 쿠키도 신뢰하지 않는다
  if (configErrors().length > 0) return null;
  const jar = await cookies();
  return unsign(jar.get(PARTICIPANT_COOKIE)?.value);
}

export async function clearParticipantCookie() {
  const jar = await cookies();
  jar.delete(PARTICIPANT_COOKIE);
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return Response.json({ ok: true, data }, init);
}

export function jsonError(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}
