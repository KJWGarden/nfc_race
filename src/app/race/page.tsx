"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnnounceBanner, AnnounceToast } from "@/components/announce-banner";
import { api } from "@/lib/api";
import { cn, formatDuration, sessionStatusLabel } from "@/lib/format";
import {
  isWebNfcAvailable,
  parseStaticTagUrl,
  parseSunUrl,
  scanNfcOnce,
  toStaticParams,
  toSunParams,
  type StaticTagParams,
  type SunParams,
} from "@/lib/nfc";
import { overlayFor, PENDING_TAG_KEY, takeTagFlash, type TagSuccess } from "@/lib/tag-result";
import type { TeamRaceView } from "@/lib/types";

// 300명 기준 화면이 켜진 기기 전체가 폴링해도 초당 약 30회 요청
const POLL_INTERVAL_MS = 10_000;

export default function RacePage() {
  const router = useRouter();
  const [view, setView] = useState<TeamRaceView | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [overlay, setOverlay] = useState<{ title: string; body: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pendingUsed = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await api<TeamRaceView>("/api/me");
      setView((prev) => {
        if (
          prev?.announcement?.id &&
          next.announcement?.id &&
          prev.announcement.id !== next.announcement.id
        ) {
          setToast(next.announcement.message);
        }
        return next;
      });
      setError("");
      // 기능: /t 에서 기록된 태깅 성공 안내가 있으면 한 번 띄운다
      const flash = takeTagFlash();
      if (flash) setOverlay(flash);
    } catch {
      router.replace("/");
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  // 변경: SSE 대신 10초 폴링. 화면이 숨겨지면 멈추고, 다시 보이면 즉시 한 번 불러온 뒤 재개한다.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(timer);
      timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load();
        start();
      } else {
        clearInterval(timer);
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  // 변경: 태깅은 SUN 파라미터(e, c) 또는 고정 URL 토큰({token})으로 제출한다 (고정 URL 인정 여부는 서버가 판단)
  async function submitTag(payload: SunParams | StaticTagParams) {
    try {
      const result = await api<TagSuccess>("/api/tag", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setView(result.view);
      setOverlay(overlayFor(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : "태깅에 실패했습니다.");
      load();
    }
  }

  async function onNfc() {
    setScanning(true);
    setError("");
    try {
      // 변경: NDEF URL 레코드에서 SUN 파라미터를 꺼내 제출. 세션 스위치가 켜져 있으면 고정 URL 토큰도 제출 (UID 만으로는 제출하지 않음)
      const { url } = await scanNfcOnce();
      const payload = url
        ? (parseSunUrl(url) ?? (view?.session.allowStaticUrl ? parseStaticTagUrl(url) : null))
        : null;
      if (!payload) throw new Error("SUN 태그가 아닙니다.");
      await submitTag(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "NFC 읽기에 실패했습니다.");
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (pendingUsed.current || !view?.team || view.session.status !== "live") return;
    const pending = sessionStorage.getItem(PENDING_TAG_KEY);
    if (!pending) return;
    pendingUsed.current = true;
    sessionStorage.removeItem(PENDING_TAG_KEY);
    // 변경: 보관된 SUN 파라미터 또는 고정 토큰(JSON)만 한 번 제출하고, 예전 토큰 문자열 등 형식이 다르면 버린다
    let payload: SunParams | StaticTagParams | null = null;
    try {
      const parsed = JSON.parse(pending) as { e?: unknown; c?: unknown; token?: unknown };
      payload = toSunParams(parsed?.e, parsed?.c) ?? toStaticParams(parsed?.token);
    } catch {
      payload = null;
    }
    if (payload) void submitTag(payload);
  }, [view]);

  if (!view) {
    return <main className="grid min-h-screen place-items-center bg-paper">불러오는 중…</main>;
  }

  if (!view.team) {
    return <TeamGate view={view} onJoined={load} />;
  }

  const elapsed =
    view.team.startedAt && !view.finished
      ? now - new Date(view.team.startedAt).getTime()
      : view.elapsedMs;

  return (
    <main className="min-h-screen bg-paper pb-10 text-ink">
      {toast ? <AnnounceToast message={toast} onClose={() => setToast("")} /> : null}
      <div className="mx-auto max-w-md px-4 py-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.18em] text-moss">{view.session.name}</p>
            <h1 className="font-display mt-1 text-4xl">{view.team.name}</h1>
          </div>
          <span className="rounded-full bg-ink px-3 py-1 text-xs text-lime">
            {sessionStatusLabel(view.session.status)}
          </span>
        </header>

        <div className="mt-4">
          <AnnounceBanner announcement={view.announcement} />
        </div>

        <section className="mt-5 rounded-[28px] bg-ink p-5 text-paper">
          <p className="text-xs tracking-[0.16em] text-lime">OUR RACE</p>
          <div className="mt-3 flex items-end justify-between">
            <p className="font-display text-5xl">
              {view.taggedTagIds.length}/{view.required}
            </p>
            <p className="font-display text-3xl">{formatDuration(elapsed)}</p>
          </div>
          <p className="mt-2 text-sm text-paper/50">우리 팀 현황만 표시됩니다.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {view.tags.map((tag) => {
              const done = view.taggedTagIds.includes(tag.id);
              const current = view.nextTag?.id === tag.id;
              return (
                <span
                  key={tag.id}
                  className={cn(
                    "grid h-10 w-10 place-items-center rounded-full text-sm font-semibold",
                    done ? "bg-lime text-ink" : current ? "bg-terra text-white" : "bg-ink-3 text-paper/35",
                  )}
                >
                  {tag.order}
                </span>
              );
            })}
          </div>
        </section>

        <section className="mt-4 rounded-[28px] bg-white p-5">
          {view.finished ? (
            <>
              <p className="text-xs text-moss">완주</p>
              <h2 className="font-display mt-1 text-3xl">기록 확정</h2>
              <p className="mt-2 text-sm text-ink/55">시상식에서 순위가 공개됩니다.</p>
            </>
          ) : view.nextTag ? (
            <>
              <p className="text-xs text-terra">다음 목적지</p>
              <h2 className="font-display mt-1 text-3xl">{view.nextTag.name}</h2>
              <p className="mt-2 text-sm leading-6 text-ink/65">
                {view.lastValidEvent
                  ? view.nextTag.hint || `${view.nextTag.name}으로 이동하세요.`
                  : view.nextTag.hint || "출발 지점에서 NFC를 찍어 레이스를 시작하세요."}
              </p>
              {view.nextTag.locationNote ? (
                <p className="mt-2 text-xs text-ink/40">{view.nextTag.locationNote}</p>
              ) : null}
            </>
          ) : (
            <p>등록된 지점이 없습니다.</p>
          )}
        </section>

        <section className="mt-4 rounded-[28px] bg-white p-5">
          <p className="text-xs text-ink/40">팀원 · 참가 코드 {view.team.joinCode}</p>
          <ul className="mt-2 text-sm">
            {view.members.map((member) => (
              <li key={member.id} className="flex justify-between py-1">
                <span>{member.name}</span>
                <span className="text-ink/35">{member.isLeader ? "팀장" : "팀원"}</span>
              </li>
            ))}
          </ul>
        </section>

        {error ? <p className="mt-4 text-sm text-terra">{error}</p> : null}

        {!view.finished && view.session.status === "live" ? (
          <div className="mt-5 space-y-3">
            {isWebNfcAvailable() ? (
              <button
                type="button"
                onClick={onNfc}
                disabled={scanning}
                className="w-full rounded-2xl bg-terra py-4 text-lg font-semibold text-white"
              >
                {scanning ? "태그에 가까이…" : "NFC 태깅"}
              </button>
            ) : null}
            <p className="text-center text-[11px] text-ink/35">
              태그에 휴대폰을 대면 브라우저가 열리며 자동으로 기록됩니다. Android는 NFC 버튼으로도 찍을 수 있습니다.
            </p>
          </div>
        ) : view.session.status !== "live" ? (
          <p className="mt-5 rounded-2xl bg-white px-4 py-3 text-sm text-ink/55">
            관리자가 레이스를 시작하면 태깅할 수 있습니다.
          </p>
        ) : null}
      </div>

      {overlay ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-ink/80 p-6">
          <div className="animate-rise w-full max-w-sm rounded-[32px] bg-paper p-6 text-center">
            <p className="text-xs tracking-[0.18em] text-terra">NEXT</p>
            <h2 className="font-display mt-2 text-4xl">{overlay.title}</h2>
            <p className="mt-3 text-sm leading-7 text-ink/65">{overlay.body}</p>
            <button
              type="button"
              onClick={() => setOverlay(null)}
              className="mt-6 w-full rounded-2xl bg-ink py-3 text-paper"
            >
              이동하기
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function TeamGate({ view, onJoined }: { view: TeamRaceView; onJoined: () => Promise<void> }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/api/teams", { method: "POST", body: JSON.stringify({ name }) });
      await onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : "팀 생성에 실패했습니다.");
    }
  }

  async function joinTeam(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/api/teams/join", {
        method: "POST",
        body: JSON.stringify({ joinCode }),
      });
      await onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : "팀 참가에 실패했습니다.");
    }
  }

  return (
    <main className="min-h-screen bg-paper px-4 py-10 text-ink">
      <div className="mx-auto max-w-md">
        <p className="text-xs tracking-[0.18em] text-moss">{view.session.name}</p>
        <h1 className="font-display mt-2 text-4xl">팀을 선택하세요</h1>
        <p className="mt-2 text-sm text-ink/55">
          팀장이 팀을 만든 뒤, 팀원에게 참가 코드를 알려 주세요. {view.participant.name}님으로 참가 중입니다.
        </p>
        <div className="mt-6 flex rounded-full bg-white p-1">
          <button
            type="button"
            onClick={() => setMode("create")}
            className={cn("flex-1 rounded-full py-2 text-sm", mode === "create" && "bg-ink text-paper")}
          >
            팀 만들기
          </button>
          <button
            type="button"
            onClick={() => setMode("join")}
            className={cn("flex-1 rounded-full py-2 text-sm", mode === "join" && "bg-ink text-paper")}
          >
            코드로 참가
          </button>
        </div>
        {mode === "create" ? (
          <form onSubmit={createTeam} className="mt-5 space-y-3">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="팀 이름"
              className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3"
            />
            <button type="submit" className="w-full rounded-2xl bg-terra py-3 font-semibold text-white">
              팀장으로 시작
            </button>
          </form>
        ) : (
          <form onSubmit={joinTeam} className="mt-5 space-y-3">
            <input
              required
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="팀 코드 4자리"
              className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 tracking-[0.2em]"
            />
            <button type="submit" className="w-full rounded-2xl bg-ink py-3 font-semibold text-paper">
              팀에 들어가기
            </button>
          </form>
        )}
        {error ? <p className="mt-3 text-sm text-terra">{error}</p> : null}
      </div>
    </main>
  );
}
