"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      router.replace("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <p className="text-lime text-xs font-semibold tracking-[0.22em]">ADMIN CONSOLE</p>
        <h1 className="font-display mt-3 text-5xl">운영 데스크</h1>
        <p className="mt-3 text-sm text-paper/60">세션, 순위, NFC 지점, 시상 화면을 관리합니다.</p>
        <form onSubmit={onSubmit} className="mt-10 space-y-4">
          <label className="block text-sm">
            관리자 비밀번호
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-ink-2 px-4 py-3 text-paper outline-none focus:border-lime"
              autoFocus
            />
          </label>
          {error ? <p className="text-sm text-terra">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-2xl bg-lime py-3 font-semibold text-ink disabled:opacity-60"
          >
            {pending ? "확인 중…" : "입장"}
          </button>
        </form>
      </div>
    </main>
  );
}
