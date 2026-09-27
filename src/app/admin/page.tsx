"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import type { Session } from "@/lib/types";

export default function AdminHomePage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    checkpointCount: 4,
    awardRanks: 3,
  });

  async function load() {
    try {
      setSessions(await api<Session[]>("/api/admin/sessions"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createSession(event: React.FormEvent) {
    event.preventDefault();
    const session = await api<Session>("/api/admin/sessions", {
      method: "POST",
      body: JSON.stringify(form),
    });
    router.push(`/admin/sessions/${session.id}`);
  }

  async function logout() {
    await api("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  }

  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-lime">CHECKPOINT / ADMIN</p>
            <h1 className="font-display mt-2 text-5xl">참가 세션</h1>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink"
            >
              새 세션
            </button>
            <button
              type="button"
              onClick={logout}
              className="rounded-full border border-white/15 px-4 py-2 text-sm"
            >
              로그아웃
            </button>
          </div>
        </header>

        {error ? <p className="mt-6 text-terra">{error}</p> : null}

        <ul className="mt-10 grid gap-4">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link
                href={`/admin/sessions/${session.id}`}
                className="block rounded-3xl border border-white/10 bg-ink-2 p-5 transition hover:border-lime/60"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">{session.name}</h2>
                    <p className="mt-1 text-sm text-paper/55">{session.description || "설명 없음"}</p>
                  </div>
                  <StatusBadge status={session.status} />
                </div>
                <p className="mt-4 text-xs text-paper/40">
                  코드 {session.code} · 지점 {session.checkpointCount}개 · 시상 {session.awardRanks}팀 ·{" "}
                  {formatDateTime(session.createdAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={createSession}
            className="w-full max-w-md rounded-3xl bg-paper p-6 text-ink"
          >
            <h2 className="font-display text-3xl">새 세션</h2>
            <label className="mt-5 block text-sm">
              이름
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full rounded-2xl border border-ink/10 bg-white px-3 py-2"
              />
            </label>
            <label className="mt-3 block text-sm">
              설명
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="mt-1 w-full rounded-2xl border border-ink/10 bg-white px-3 py-2"
                rows={3}
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-sm">
                NFC 지점 수
                <input
                  type="number"
                  min={1}
                  value={form.checkpointCount}
                  onChange={(e) =>
                    setForm({ ...form, checkpointCount: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded-2xl border border-ink/10 bg-white px-3 py-2"
                />
              </label>
              <label className="text-sm">
                시상 순위 수
                <input
                  type="number"
                  min={1}
                  value={form.awardRanks}
                  onChange={(e) => setForm({ ...form, awardRanks: Number(e.target.value) })}
                  className="mt-1 w-full rounded-2xl border border-ink/10 bg-white px-3 py-2"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm">
                취소
              </button>
              <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm text-paper">
                만들기
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
