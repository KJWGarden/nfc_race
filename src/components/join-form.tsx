"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export function JoinForm({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api("/api/join", {
        method: "POST",
        body: JSON.stringify({ code, name }),
      });
      router.replace("/race");
    } catch (err) {
      setError(err instanceof Error ? err.message : "참가에 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm">
        세션 코드
        <input
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="DEMO01"
          className="mt-1 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 tracking-[0.2em]"
        />
      </label>
      <label className="block text-sm">
        내 이름
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3"
        />
      </label>
      {error ? <p className="text-sm text-terra">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-terra py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "입장 중…" : "레이스 참가"}
      </button>
      <p className="text-center text-xs text-ink/40">
        운영진이신가요?{" "}
        <Link href="/admin/login" className="underline">
          관리자 입장
        </Link>
      </p>
    </form>
  );
}
