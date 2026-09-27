"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn, formatDuration } from "@/lib/format";
import { useAdminRealtime } from "@/lib/admin-realtime";
import type { AdminLiveView } from "@/lib/types";

export default function CeremonyPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const [live, setLive] = useState<AdminLiveView | null>(null);
  const [revealed, setRevealed] = useState(0);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLive(await api<AdminLiveView>(`/api/admin/sessions/${sessionId}`));
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // 변경: SSE 대신 관리자 전용 Supabase Realtime 변경 신호로 다시 불러온다
  useAdminRealtime(sessionId, load);

  if (!live) {
    return (
      <main className="grid min-h-screen place-items-center bg-ink text-paper">불러오는 중…</main>
    );
  }

  const award = live.rankings.filter((r) => r.finished).slice(0, live.session.awardRanks);
  const revealOrder = [...award].sort((a, b) => b.rank - a.rank);
  const visible = revealOrder.slice(0, revealed);
  const upcoming = revealOrder[revealed];

  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10">
        <p className="text-center text-xs tracking-[0.28em] text-gold">CHECKPOINT AWARD</p>
        <h1 className="font-display mt-3 text-center text-5xl sm:text-7xl">{live.session.name}</h1>
        <p className="mt-3 text-center text-paper/50">완주 기록 순 시상</p>

        <div className="mt-12 flex flex-1 flex-col justify-center gap-5">
          {award.length === 0 ? (
            <p className="text-center text-paper/40">아직 완주 팀이 없습니다.</p>
          ) : null}
          {visible.map((row) => {
            const gold = row.rank === 1;
            return (
              <article
                key={row.teamId}
                className={cn(
                  "animate-stamp rounded-[28px] px-6 py-5",
                  gold ? "bg-gold text-ink" : "bg-ink-2 text-paper",
                )}
              >
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-sm opacity-70">{row.rank}등</p>
                    <h2 className="font-display text-4xl sm:text-6xl">{row.teamName}</h2>
                    <p className="mt-2 text-sm opacity-70">
                      {row.members.map((m) => m.name).join(" · ")}
                    </p>
                  </div>
                  <p className="font-display text-4xl">{formatDuration(row.durationMs)}</p>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-10 flex justify-center gap-3">
          {upcoming ? (
            <button
              type="button"
              onClick={() => setRevealed((n) => n + 1)}
              className="rounded-full bg-lime px-6 py-3 font-semibold text-ink"
            >
              {upcoming.rank}등 공개
            </button>
          ) : award.length > 0 ? (
            <button
              type="button"
              onClick={() => setRevealed(0)}
              className="rounded-full border border-white/15 px-6 py-3"
            >
              다시 발표
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
