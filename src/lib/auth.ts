import { createHmac } from "crypto";
import { cookies } from "next/headers";

const ADMIN_COOKIE = "cp_admin";
const PARTICIPANT_COOKIE = "cp_pid";

function secret() {
  return process.env.APP_SECRET || "checkpoint-dev-secret";
}

export function adminPassword() {
  return process.env.ADMIN_PASSWORD || "admin123";
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
