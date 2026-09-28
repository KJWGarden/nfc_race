"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export function JoinForm({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"join" | "rejoin">("join");
  const [code, setCode] = useState(initialCode);
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      // 변경: 다시 들어가기 모드는 세션 코드 + 팀 코드 + 이름으로 기존 참가자 쿠키를 받는다
      if (mode === "rejoin") {
        await api("/api/rejoin", {
          method: "POST",
          body: JSON.stringify({ code, joinCode, name }),
        });
      } else {
        await api("/api/join", {
          method: "POST",
          body: JSON.stringify({ code, name }),
        });
      }
      router.replace("/race");
    } catch (err) {
      setError(err instanceof Error ? err.message : "참가에 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  // 기능: 새로 참가 / 다시 들어가기 전환. 전환 시 이전 오류는 지운다
  function switchMode(next: "join" | "rejoin") {
    setMode(next);
    setError("");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-ink/5 p-1 text-sm" role="tablist">
        {(["join", "rejoin"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            className={
              mode === m
                ? "rounded-xl bg-white py-2 font-semibold shadow-sm"
                : "rounded-xl py-2 text-ink/50"
            }
          >
            {m === "join" ? "새로 참가" : "다시 들어가기"}
          </button>
        ))}
      </div>
      {mode === "rejoin" ? (
        <p className="text-xs leading-5 text-ink/50">
          팀에 들어갔던 참가자만 다시 들어갈 수 있습니다. 팀이 없었다면 새로 참가해 주세요.
        </p>
      ) : null}
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
      {mode === "rejoin" ? (
        <label className="block text-sm">
          팀 코드
          <input
            required
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="팀 코드 4자리"
            className="mt-1 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 tracking-[0.2em]"
          />
        </label>
      ) : null}
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
        {pending ? "입장 중…" : mode === "rejoin" ? "기존 참가자로 입장" : "레이스 참가"}
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
