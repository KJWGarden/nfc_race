"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, api } from "@/lib/api";
import { formatDateTime, sessionStatusLabel } from "@/lib/format";
import { toSunParams } from "@/lib/nfc";
import type { NfcTag, SunAdminContext } from "@/lib/types";

type Done = { sessionId: string; text: string };

// 기능: 관리자 쿠키가 있는 기기로 태그를 찍었을 때의 화면. 참가자 태깅은 하지 않고 읽기 전용 조회 후
// 이미 등록된 태그면 '기준 갱신', 아니면 세션·지점을 골라 '등록'한다 (버튼을 눌렀을 때만 기록).
export function AdminSunPanel({ e, c }: { e: string; c: string }) {
  const sun = useMemo(() => toSunParams(e, c), [e, c]);
  const [ctx, setCtx] = useState<SunAdminContext | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [tagId, setTagId] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  // 기능: 읽기 전용 조회. 두 번 실행돼도(Strict Mode) 기록이 없으므로 안전하며, 늦게 온 이전 응답은 버린다
  useEffect(() => {
    if (!sun) return;
    let stale = false;
    api<SunAdminContext>("/api/admin/sun/inspect", { method: "POST", body: JSON.stringify(sun) })
      .then((data) => {
        if (!stale) setCtx(data);
      })
      .catch((err: unknown) => {
        if (!stale) setError(err instanceof Error ? err.message : "태그를 확인하지 못했습니다.");
      });
    return () => {
      stale = true;
    };
  }, [sun, reloadKey]);

  // 기능: 등록·기준 갱신 요청 (서버가 SUN 을 다시 검증). 다른 태그가 묶인 지점이면 교체 확인을 받는다
  async function register(targetSessionId: string, targetTagId: string, replace: boolean) {
    if (!sun) return;
    setBusy(true);
    setError("");
    setDone(null);
    try {
      const res = await fetch(`/api/admin/sessions/${targetSessionId}/tags/${targetTagId}/sun`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sun, replace }),
      });
      const json = (await res.json()) as { ok: boolean; data?: NfcTag; error?: string; needsConfirm?: boolean };
      if (!json.ok || !json.data) {
        setConfirmReplace(json.needsConfirm === true);
        throw new ApiError(json.error || "요청에 실패했습니다.");
      }
      setConfirmReplace(false);
      setDone({
        sessionId: targetSessionId,
        text: `${json.data.name}: 기준값 ${json.data.baselineCounter} 로 저장했습니다.`,
      });
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.reload();
  }

  const pickable = ctx?.sessions ?? [];
  const pickedSession = pickable.find((s) => s.id === sessionId);

  return (
    <main className="min-h-screen bg-ink px-5 py-8 text-paper">
      <div className="mx-auto max-w-md space-y-5">
        <div className="rounded-2xl bg-gold px-4 py-3 text-sm text-ink">
          관리자 모드 — 참가자 태깅은 기록되지 않습니다.
          <button type="button" onClick={logout} className="ml-2 underline">
            관리자 로그아웃
          </button>
        </div>
        <h1 className="font-display text-4xl">태그 등록 · 기준 갱신</h1>

        {!sun ? <p className="text-terra">SUN 정보가 없는 태그입니다.</p> : null}
        {error ? <p className="rounded-2xl bg-terra/20 px-4 py-3 text-sm text-terra">{error}</p> : null}
        {done ? (
          <p className="rounded-2xl bg-lime px-4 py-3 text-sm text-ink">
            {done.text}{" "}
            <Link href={`/admin/sessions/${done.sessionId}`} className="underline">
              세션 관리로 이동
            </Link>
          </p>
        ) : null}

        {ctx ? (
          <>
            <section className="rounded-2xl bg-ink-2 p-4 text-sm">
              <p>
                UID <span className="font-mono">{ctx.uid}</span> · 이 URL 카운터 <strong>{ctx.ctr}</strong>
              </p>
            </section>

            {ctx.bindings.length > 0 ? (
              <section className="space-y-3">
                <h2 className="font-semibold">등록된 지점</h2>
                {ctx.bindings.map((b) => (
                  <article key={b.tagId} className="rounded-2xl bg-paper p-4 text-ink">
                    <p className="text-xs text-ink/50">
                      {b.sessionName} · {sessionStatusLabel(b.sessionStatus)}
                    </p>
                    <h3 className="text-lg font-semibold">
                      지점 {b.order} {b.tagName}
                    </h3>
                    <p className="mt-1 text-sm">
                      현재 기준값 {b.baselineCtr ?? "없음"} ({formatDateTime(b.baselineAt)}) → 이 URL {ctx.ctr}
                    </p>
                    {b.sessionStatus === "live" ? (
                      <p className="mt-1 text-xs text-terra">진행 중인 세션입니다. 갱신하면 아직 제출되지 않은 이전 URL이 무효가 됩니다.</p>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => register(b.sessionId, b.tagId, false)}
                      className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
                    >
                      기준 갱신
                    </button>
                  </article>
                ))}
              </section>
            ) : (
              <p className="text-sm text-paper/60">아직 어느 지점에도 등록되지 않은 태그입니다.</p>
            )}

            <section className="space-y-3 rounded-2xl bg-paper p-4 text-ink">
              <h2 className="font-semibold">{ctx.bindings.length > 0 ? "다른 지점에 등록" : "지점에 등록"}</h2>
              <label className="block text-sm">
                세션 선택
                <select
                  value={sessionId}
                  onChange={(event) => {
                    setSessionId(event.target.value);
                    setTagId("");
                    setConfirmReplace(false);
                  }}
                  className="mt-1 w-full rounded-xl border border-ink/10 bg-white px-3 py-2"
                >
                  <option value="">세션을 고르세요</option>
                  {pickable.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({sessionStatusLabel(s.status)})
                    </option>
                  ))}
                </select>
              </label>
              {pickedSession ? (
                <label className="block text-sm">
                  지점 선택
                  <select
                    value={tagId}
                    onChange={(event) => {
                      setTagId(event.target.value);
                      setConfirmReplace(false);
                    }}
                    className="mt-1 w-full rounded-xl border border-ink/10 bg-white px-3 py-2"
                  >
                    <option value="">지점을 고르세요</option>
                    {pickedSession.tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.order}. {t.name} — {t.uid ? `등록됨 ${t.uid}` : "미등록"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {confirmReplace ? (
                <div className="rounded-xl bg-gold/40 px-3 py-2 text-sm">
                  기존 태그를 이 태그로 교체할까요?
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => register(sessionId, tagId, true)}
                    className="ml-2 rounded-full bg-terra px-3 py-1 text-xs text-white"
                  >
                    교체
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                disabled={busy || !sessionId || !tagId}
                onClick={() => register(sessionId, tagId, false)}
                className="rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40"
              >
                등록
              </button>
            </section>
          </>
        ) : sun && !error ? (
          <p className="text-paper/60">태그를 확인하는 중…</p>
        ) : null}
      </div>
    </main>
  );
}
