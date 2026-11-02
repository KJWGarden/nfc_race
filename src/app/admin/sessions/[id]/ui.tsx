"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, originFromWindow } from "@/lib/api";
import { cn, formatClock, formatDateTime, formatDuration } from "@/lib/format";
import { isWebNfcAvailable, scanNfcOnce } from "@/lib/nfc";
import { useAdminRealtime } from "@/lib/admin-realtime";
import { QrImage } from "@/components/qr-image";
import { StatusBadge } from "@/components/status-badge";
import { RouteMap } from "./route-map";
import type { AdminLiveView, LibraryEntry, LibraryList, NfcTag, SessionStatus } from "@/lib/types";

const TABS = ["라이브", "참가자", "초대", "NFC", "순위", "공지", "설정"] as const;
type Tab = (typeof TABS)[number];

export function AdminSessionView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [live, setLive] = useState<AdminLiveView | null>(null);
  const [tab, setTab] = useState<Tab>("라이브");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setLive(await api<AdminLiveView>(`/api/admin/sessions/${sessionId}`));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // 변경: SSE 대신 관리자 전용 Supabase Realtime 변경 신호로 다시 불러온다
  useAdminRealtime(sessionId, load);

  async function patchStatus(status: SessionStatus) {
    await api(`/api/admin/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await load();
  }

  if (error && !live) {
    return <p className="min-h-screen bg-ink p-8 text-terra">{error}</p>;
  }
  if (!live) {
    return <p className="min-h-screen bg-ink p-8 text-paper/50">불러오는 중…</p>;
  }

  const { session, rankings, participants, tags } = live;
  const liveCount = rankings.filter((r) => r.progress > 0 && !r.finished).length;
  const finishedCount = rankings.filter((r) => r.finished).length;

  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/admin" className="text-xs text-paper/40">
              ← 세션 목록
            </Link>
            <div className="mt-2 flex items-center gap-3">
              <h1 className="font-display text-4xl sm:text-5xl">{session.name}</h1>
              <StatusBadge status={session.status} />
            </div>
            <p className="mt-2 text-sm text-paper/50">{session.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {session.status !== "live" ? (
              <button
                type="button"
                onClick={() => patchStatus("live")}
                className="rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink"
              >
                레이스 시작
              </button>
            ) : (
              <button
                type="button"
                onClick={() => patchStatus("finished")}
                className="rounded-full bg-terra px-4 py-2 text-sm font-semibold text-white"
              >
                레이스 종료
              </button>
            )}
            <Link
              href={`/admin/sessions/${sessionId}/ceremony`}
              target="_blank"
              className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-ink"
            >
              시상 화면 띄우기
            </Link>
          </div>
        </div>

        <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="참가자" value={`${participants.length}명`} />
          <Stat label="팀" value={`${live.teams.length}팀`} />
          <Stat label="진행중" value={`${liveCount}팀`} />
          <Stat label="완주" value={`${finishedCount}팀`} />
        </dl>

        <nav className="mt-8 flex gap-1 overflow-x-auto pb-1">
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={cn(
                "rounded-full px-4 py-2 text-sm whitespace-nowrap",
                tab === item ? "bg-paper text-ink" : "text-paper/55 hover:text-paper",
              )}
            >
              {item}
            </button>
          ))}
        </nav>

        <section className="mt-6 rounded-3xl bg-paper p-5 text-ink sm:p-7">
          {tab === "라이브" ? <LivePanel live={live} /> : null}
          {tab === "참가자" ? <ParticipantsPanel live={live} /> : null}
          {tab === "초대" ? <InvitePanel sessionId={sessionId} code={session.code} /> : null}
          {tab === "NFC" ? (
            <NfcPanel
              live={live}
              onChange={load}
              notice={notice}
              setNotice={setNotice}
            />
          ) : null}
          {tab === "순위" ? <RankingPanel live={live} /> : null}
          {tab === "공지" ? <AnnouncePanel sessionId={sessionId} live={live} onSent={load} /> : null}
          {tab === "설정" ? (
            <SettingsPanel
              live={live}
              onSaved={load}
              onDeleted={() => router.replace("/admin")}
            />
          ) : null}
        </section>
        {tags.length === 0 ? (
          <p className="mt-4 text-sm text-gold">NFC 지점이 없습니다. NFC 탭에서 태그를 먼저 등록하세요.</p>
        ) : null}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-ink-2 px-4 py-3">
      <dt className="text-[11px] tracking-[0.16em] text-paper/40 uppercase">{label}</dt>
      <dd className="mt-1 font-display text-2xl">{value}</dd>
    </div>
  );
}

function LivePanel({ live }: { live: AdminLiveView }) {
  const tags = live.tags;
  return (
    <div className="space-y-4">
      <h2 className="font-display text-3xl">실시간 현황</h2>
      {live.rankings.length === 0 ? (
        <p className="text-sm text-ink/50">아직 참가 팀이 없습니다.</p>
      ) : null}
      {live.rankings.map((row) => (
        <article key={row.teamId} className="rounded-2xl border border-ink/8 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-ink/40">{row.rank}위 · {row.memberCount}명</p>
              <h3 className="text-lg font-semibold">{row.teamName}</h3>
            </div>
            <p className="font-display text-2xl">
              {row.finished ? formatDuration(row.durationMs) : `${row.progress}/${row.required}`}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {tags.map((tag, index) => {
              const done = row.taggedTagIds.includes(tag.id);
              return (
                <div key={tag.id} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "grid h-9 w-9 place-items-center rounded-full text-xs font-semibold",
                      done ? "bg-moss text-white" : "bg-paper-2 text-ink/40",
                    )}
                    title={tag.name}
                  >
                    {tag.order}
                  </span>
                  {index < tags.length - 1 ? <span className="route-dash h-[2px] w-6" /> : null}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-ink/45">
            {row.finished
              ? `완주 ${formatClock(row.finishedAt)}`
              : row.startedAt
                ? `출발 ${formatClock(row.startedAt)}`
                : "아직 출발 전"}
          </p>
        </article>
      ))}
    </div>
  );
}

function ParticipantsPanel({ live }: { live: AdminLiveView }) {
  const unassigned = live.participants.filter((p) => !p.teamId);
  return (
    <div>
      <h2 className="font-display text-3xl">참가자 명단</h2>
      <div className="mt-5 space-y-6">
        {live.teams.map((team) => {
          const members = live.participants.filter((p) => p.teamId === team.id);
          const rank = live.rankings.find((r) => r.teamId === team.id);
          return (
            <section key={team.id}>
              <h3 className="font-semibold">
                {team.name}{" "}
                <span className="text-sm font-normal text-ink/45">
                  코드 {team.joinCode} · {rank?.finished ? `완주 ${formatDuration(rank.durationMs)}` : "진행중"}
                </span>
              </h3>
              <ul className="mt-2 divide-y divide-ink/8 rounded-2xl bg-white">
                {members.map((member) => (
                  <li key={member.id} className="flex justify-between px-4 py-2 text-sm">
                    <span>{member.name}</span>
                    <span className="text-ink/40">{member.isLeader ? "팀장" : "팀원"}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <section>
          <h3 className="font-semibold">팀 미배정</h3>
          {unassigned.length === 0 ? (
            <p className="mt-2 text-sm text-ink/45">없음</p>
          ) : (
            <ul className="mt-2 divide-y divide-ink/8 rounded-2xl bg-white">
              {unassigned.map((member) => (
                <li key={member.id} className="px-4 py-2 text-sm">
                  {member.name}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function InvitePanel({ sessionId, code }: { sessionId: string; code: string }) {
  const joinUrl = `${originFromWindow()}/join/${code}`;
  return (
    <div className="grid gap-8 sm:grid-cols-[1fr_auto]">
      <div>
        <h2 className="font-display text-3xl">참가자 초대</h2>
        <p className="mt-2 text-sm text-ink/55">
          코드 또는 QR로 세션에 들어올 수 있습니다. 링크를 현장 안내문에 붙여 두세요.
        </p>
        <p className="font-display mt-6 text-6xl tracking-[0.12em]">{code}</p>
        <p className="mt-3 break-all rounded-2xl bg-white px-4 py-3 text-sm">{joinUrl}</p>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(joinUrl)}
          className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-paper"
        >
          링크 복사
        </button>
      </div>
      <QrImage value={joinUrl} size={220} label={`${sessionId.slice(0, 6)} 초대 QR`} />
    </div>
  );
}

// 변경: SUN 태그 NFC 관리. 태그에서 읽은 SUN URL 로 등록/기준 갱신하며, NXP 도구에 입력할 SDM 설정값과 UID 별 키를 보여 준다.
// 세션별 '고정 QR/URL 허용' 스위치를 켜면 지점마다 고정 URL·복사·QR 을 함께 보여 준다 (NFC 쓰기·UID 직접 입력은 없음).
function NfcPanel({
  live,
  onChange,
  notice,
  setNotice,
}: {
  live: AdminLiveView;
  onChange: () => Promise<void>;
  notice: string;
  setNotice: (value: string) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    hint: "",
    nextHint: "",
    locationNote: "",
  });
  const [keyUid, setKeyUid] = useState("");
  const [fileKey, setFileKey] = useState<{ uid: string; fileReadKey: string } | null>(null);
  const [keyError, setKeyError] = useState("");
  const [switchError, setSwitchError] = useState("");
  const [switchBusy, setSwitchBusy] = useState(false);
  const origin = originFromWindow();
  const template = sdmTemplate(origin);
  const allowStatic = live.session.allowStaticUrl;
  const [library, setLibrary] = useState<LibraryList | null>(null);
  const [libraryKey, setLibraryKey] = useState(0);
  // 기능: 경로 만들기(목록에서 순서대로 추가·순서 변경) 상태. 진행 중·종료 세션은 서버와 같이 잠근다
  const [routePick, setRoutePick] = useState("");
  const [routeForm, setRouteForm] = useState({ hint: "", nextHint: "", locationNote: "" });
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState("");
  const routeLocked = live.session.status === "live" || live.session.status === "finished";

  // 변경: 태그 목록은 지점(live.tags)이 바뀔 때마다, 그리고 연결·해제 뒤에 다시 읽어 연결 표시가 낡지 않게 한다
  useEffect(() => {
    let stale = false;
    api<LibraryList>("/api/admin/library")
      .then((data) => {
        if (!stale) setLibrary(data);
      })
      .catch(() => {
        if (!stale) setLibrary(null);
      });
    return () => {
      stale = true;
    };
  }, [live.tags, libraryKey]);

  // 변경: 목록 태그가 연결된 지점은 목록 URL 을 보여 준다 (자동 URL 은 인정되지 않음). 목록을 못 읽었으면 URL 을 숨긴다
  function staticUrlFor(tag: NfcTag): string | null {
    if (!tag.libraryId) return `${origin}/t/${tag.token}`;
    const token = library?.entries.find((entry) => entry.id === tag.libraryId)?.token;
    return token ? `${origin}/t/${token}` : null;
  }

  // 기능: 세션별 고정 QR/URL 허용 스위치 저장 후 화면 갱신
  async function toggleStatic(next: boolean) {
    setSwitchBusy(true);
    setSwitchError("");
    try {
      await api(`/api/admin/sessions/${live.session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ allowStaticUrl: next }),
      });
      await onChange();
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setSwitchBusy(false);
    }
  }

  async function createTag(event: React.FormEvent) {
    event.preventDefault();
    await api(`/api/admin/sessions/${live.session.id}/tags`, {
      method: "POST",
      body: JSON.stringify(form),
    });
    setForm({ name: "", hint: "", nextHint: "", locationNote: "" });
    await onChange();
  }

  async function removeTag(tag: NfcTag) {
    if (!confirm(`${tag.name} 태그를 삭제할까요?`)) return;
    await api(`/api/admin/sessions/${live.session.id}/tags/${tag.id}`, { method: "DELETE" });
    await onChange();
  }

  // 기능: 선택한 목록 태그로 지점을 만들어 경로 끝에 붙인다 (이름은 목록 태그 이름)
  async function addFromLibrary(event: React.FormEvent) {
    event.preventDefault();
    if (!routePick) return;
    setRouteBusy(true);
    setRouteError("");
    try {
      const tag = await api<NfcTag>(`/api/admin/sessions/${live.session.id}/tags/from-library`, {
        method: "POST",
        body: JSON.stringify({ libraryId: routePick, ...routeForm }),
      });
      setRoutePick("");
      setRouteForm({ hint: "", nextHint: "", locationNote: "" });
      setNotice(`${tag.name}: 경로 ${tag.order}번째에 추가했습니다.`);
      await onChange();
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : "추가하지 못했습니다.");
    } finally {
      setRouteBusy(false);
    }
  }

  // 기능: 위/아래 이동. 현재 경로 id 전체를 바꾼 순서로 보낸다 (경로가 바뀌어 있으면 서버가 400 → 새로 읽는다)
  async function moveTag(index: number, delta: -1 | 1) {
    const ids = live.tags.map((tag) => tag.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setRouteBusy(true);
    setRouteError("");
    try {
      await api(`/api/admin/sessions/${live.session.id}/tags/order`, {
        method: "PUT",
        body: JSON.stringify({ tagIds: ids }),
      });
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : "순서를 바꾸지 못했습니다.");
    } finally {
      await onChange();
      setRouteBusy(false);
    }
  }

  // 기능: UID 로 SDM 파일 읽기 키 조회 (태그에 키를 넣기 전 단계라 UID 는 조회에만 쓰고 지점에 묶지 않는다)
  async function lookupKey(event: React.FormEvent) {
    event.preventDefault();
    setKeyError("");
    setFileKey(null);
    try {
      setFileKey(
        await api<{ uid: string; fileReadKey: string }>(
          `/api/admin/sdm-key?uid=${encodeURIComponent(keyUid.trim())}`,
        ),
      );
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "키를 불러오지 못했습니다.");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-3xl">NFC 지점</h2>
        <p className="mt-2 text-sm text-ink/55">
          NTAG 424 DNA SUN 태그는 스위치와 관계없이 항상 유효합니다. 각 지점에 태그를 찍어 읽은 URL로 등록하고, 레이스
          시작 직전에 다시 찍어 기준 갱신하세요. 기준값 이하의 URL은 무효입니다.
        </p>
      </div>
      {notice ? <p className="rounded-2xl bg-lime/60 px-4 py-2 text-sm">{notice}</p> : null}

      <section className="rounded-2xl bg-white p-4 text-sm">
        <label className="flex items-center gap-3 font-semibold">
          <input
            type="checkbox"
            checked={allowStatic}
            disabled={switchBusy}
            onChange={(e) => toggleStatic(e.target.checked)}
            className="h-5 w-5 accent-moss"
          />
          고정 QR/URL 허용 (이 세션)
          <span className={cn("text-xs", allowStatic ? "text-terra" : "text-ink/45")}>
            {allowStatic ? "켜짐" : "꺼짐"}
          </span>
        </label>
        <p className="mt-2 rounded-xl bg-gold/40 px-3 py-2 text-xs" data-testid="static-warning">
          주의: 켜면 이 세션은 복사·공유 방지가 없어집니다. 사진으로 찍거나 공유된 QR/URL로 현장에 가지 않고도 지점이
          인정될 수 있습니다. 꺼져 있으면 SUN 태그만 인정됩니다.
        </p>
        {allowStatic ? (
          <p className="mt-2 text-xs text-ink/55">
            켜져 있으면 지점마다 고정 URL과 QR이 표시됩니다. QR을 인쇄하거나, 같은 URL을 NFC 쓰기 앱으로 일반 NFC
            태그(NTAG213 등)에 기록하세요. SUN 태그와 섞어 쓸 수 있습니다.
          </p>
        ) : null}
        {switchError ? <p className="mt-2 text-terra">{switchError}</p> : null}
      </section>

      <section className="rounded-2xl bg-white p-4 text-sm">
        <h3 className="font-semibold">태그 SDM 설정값 (NXP 도구에 입력)</h3>
        <p className="mt-2 break-all font-mono text-xs">{template.url}</p>
        <ul className="mt-2 space-y-1 text-xs text-ink/65">
          <li>암호화 PICCData 미러링(UID + 카운터) · SDMMACInputOffset = SDMMACOffset · 암호화 파일 데이터 없음</li>
          <li>
            PICCDataOffset {template.piccOffset} · SDMMACOffset {template.macOffset} (NDEF 파일 기준 추정값, 실물 태그로
            확인 필요)
          </li>
          <li>SDM 메타 읽기 키 = 서버 SUN_META_KEY (운영자가 보관) · SDM 파일 읽기 키 = 아래 UID 별 키</li>
        </ul>
        <form onSubmit={lookupKey} className="mt-3 flex flex-wrap gap-2">
          <input
            value={keyUid}
            onChange={(e) => setKeyUid(e.target.value)}
            placeholder="UID 14자리 (예: 04A1B2C3D4E5F6)"
            aria-label="키 조회 UID"
            className="flex-1 rounded-xl border border-ink/10 bg-paper px-3 py-2 font-mono"
          />
          <button type="submit" className="rounded-full bg-ink px-4 py-2 text-paper">
            키 보기
          </button>
        </form>
        {keyError ? <p className="mt-2 text-terra">{keyError}</p> : null}
        {fileKey ? (
          <p className="mt-2 break-all font-mono text-xs" data-testid="file-read-key">
            {fileKey.uid} 파일 읽기 키 {fileKey.fileReadKey}
          </p>
        ) : null}
      </section>

      {/* 기능: 경로 만들기. 태그 목록에서 지점을 순서대로 골라 이 세션의 출발→골인 경로를 만든다 (다른 세션과 독립) */}
      <section className="rounded-2xl bg-white p-4 text-sm" data-testid="route-builder">
        <h3 className="font-semibold">경로 만들기 (태그 목록에서 순서대로 선택)</h3>
        <p className="mt-1 text-xs text-ink/55" data-testid="route-required">
          {/* 변경: 표시값은 min(지점 수 설정, 경로 길이). 빈 경로는 0 (race.ts 의 경주 규칙은 그대로) */}
          완주에 필요한 지점 수: {Math.min(live.session.checkpointCount, live.tags.length)} / 경로 {live.tags.length}
        </p>
        {/* 기능: 경로 순서 지도. live.tags 순서대로 출발 → 지점 → 골인을 크레파스 손그림으로 그리고, 순서가 바뀌면 다시 그린다 */}
        <RouteMap tags={live.tags} />
        {routeLocked ? (
          <p className="mt-2 rounded-xl bg-gold/40 px-3 py-2 text-xs" data-testid="route-locked">
            진행 중이거나 종료된 세션은 경로를 바꿀 수 없습니다. (추가·순서 변경 잠김)
          </p>
        ) : null}
        {library?.available === false ? (
          <p className="mt-2 text-xs text-ink/55">태그 목록 기능을 사용하려면 DB 업데이트가 필요합니다.</p>
        ) : null}
        {library?.available ? (
          <form onSubmit={addFromLibrary} className="mt-3 space-y-3">
            <select
              value={routePick}
              onChange={(event) => setRoutePick(event.target.value)}
              disabled={routeLocked || routeBusy}
              aria-label="경로에 추가할 태그"
              className="w-full rounded-xl border border-ink/10 bg-paper px-3 py-2"
            >
              <option value="">경로에 추가할 태그를 고르세요</option>
              {library.entries.map((entry) => {
                const inRoute = entry.bindings.some((b) => b.sessionId === live.session.id);
                return (
                  <option key={entry.id} value={entry.id} disabled={inRoute}>
                    {entry.kind === "sun" ? `SUN · ${entry.name} · 카운터 ${entry.counter}` : `고정 URL · ${entry.name}`}
                    {inRoute ? " (이미 경로에 있음)" : ""}
                  </option>
                );
              })}
            </select>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="이 지점 안내 (선택)" value={routeForm.hint} onChange={(v) => setRouteForm({ ...routeForm, hint: v })} />
              <Field
                label="다음 목적지 안내 (선택)"
                value={routeForm.nextHint}
                onChange={(v) => setRouteForm({ ...routeForm, nextHint: v })}
              />
              <Field
                label="위치 메모 (선택)"
                value={routeForm.locationNote}
                onChange={(v) => setRouteForm({ ...routeForm, locationNote: v })}
              />
            </div>
            <button
              type="submit"
              disabled={routeLocked || routeBusy || !routePick}
              className="rounded-full bg-ink px-4 py-2 text-paper disabled:opacity-40"
            >
              경로 끝에 추가
            </button>
          </form>
        ) : null}
        {routeError ? <p className="mt-2 text-terra" data-testid="route-error">{routeError}</p> : null}
        <p className="mt-2 text-xs text-ink/55">
          같은 태그를 다른 세션 경로에도 넣을 수 있고, 세션마다 순서는 따로 정해집니다. SUN 태그는 각 세션 레이스 직전에 기준
          갱신하세요.
        </p>
      </section>

      <ol className="space-y-4">
        {live.tags.map((tag, index) => (
          <SunTagRow
            key={tag.id}
            sessionId={live.session.id}
            tag={tag}
            canMoveUp={!routeLocked && !routeBusy && index > 0}
            canMoveDown={!routeLocked && !routeBusy && index < live.tags.length - 1}
            onMove={(delta) => moveTag(index, delta)}
            staticUrl={allowStatic ? staticUrlFor(tag) : null}
            onChange={onChange}
            onRemove={() => removeTag(tag)}
            setNotice={setNotice}
            library={library}
            onLibraryChange={() => setLibraryKey((k) => k + 1)}
          />
        ))}
      </ol>
      <form onSubmit={createTag} className="rounded-2xl border border-dashed border-ink/20 p-4">
        <h3 className="font-semibold">새 NFC 지점</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="지점 이름" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
          <Field label="위치 메모" value={form.locationNote} onChange={(v) => setForm({ ...form, locationNote: v })} />
          <Field label="이 지점 안내" value={form.hint} onChange={(v) => setForm({ ...form, hint: v })} />
          <Field label="다음 목적지 안내" value={form.nextHint} onChange={(v) => setForm({ ...form, nextHint: v })} />
        </div>
        <button type="submit" className="mt-4 rounded-full bg-ink px-4 py-2 text-sm text-paper">
          지점 생성
        </button>
      </form>
    </div>
  );
}

// 기능: 태그 URL 템플릿과 NDEF 파일 내 PICCData / SDMMAC 위치 계산.
// 오프셋 = 7(NDEF 길이 2 + 레코드 헤더 4 + URI 접두 코드 1) + 스킴을 뺀 URL 안의 위치 (실물 태그 미검증)
function sdmTemplate(origin: string) {
  const url = `${origin}/t/s?e=${"0".repeat(32)}&c=${"0".repeat(16)}`;
  const body = url.replace(/^https?:\/\//, "");
  return {
    url,
    piccOffset: 7 + body.indexOf("e=") + 2,
    macOffset: 7 + body.indexOf("&c=") + 3,
  };
}

// 기능: 지점 한 줄. 등록 상태·UID·기준값을 보여 주고 SUN URL 붙여넣기(또는 Android NFC 읽기)로 등록/기준 갱신한다
function SunTagRow({
  sessionId,
  tag,
  canMoveUp,
  canMoveDown,
  onMove,
  staticUrl,
  onChange,
  onRemove,
  setNotice,
  library,
  onLibraryChange,
}: {
  sessionId: string;
  tag: NfcTag;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  staticUrl: string | null;
  onChange: () => Promise<void>;
  onRemove: () => void;
  setNotice: (value: string) => void;
  library: LibraryList | null;
  onLibraryChange: () => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const registered = tag.uid !== "";
  // 변경: 태그 목록 연결 상태는 행마다 따로 둔다 (선택, 확인 대기, 오류)
  const [libraryId, setLibraryId] = useState("");
  const [libConfirm, setLibConfirm] = useState(false);
  const [libError, setLibError] = useState("");
  const [libBusy, setLibBusy] = useState(false);
  // 기능: 이 세션 지점의 안내 문구 편집 (다른 세션의 같은 목록 태그 지점과는 별개)
  const [editing, setEditing] = useState(false);
  const [hints, setHints] = useState({ hint: tag.hint, nextHint: tag.nextHint, locationNote: tag.locationNote });
  const [hintError, setHintError] = useState("");
  // 변경: 이 지점에 연결된 목록 항목. 고정 URL 은 지점의 library_id 로 먼저, 없으면 SUN 은 UID 로 찾는다
  const matched: LibraryEntry | null =
    (tag.libraryId ? library?.entries.find((entry) => entry.id === tag.libraryId) : undefined) ??
    (registered
      ? library?.entries.find((entry) => entry.kind === "sun" && entry.uid?.toUpperCase() === tag.uid.toUpperCase())
      : undefined) ??
    null;

  // 기능: 고정 URL 을 클립보드에 복사 (NFC 쓰기 앱에 붙여넣기용)
  async function copyStaticUrl() {
    if (!staticUrl) return;
    try {
      await navigator.clipboard.writeText(staticUrl);
      setCopied(true);
    } catch {
      setError("URL을 복사하지 못했습니다. 직접 선택해 복사하세요.");
    }
  }

  async function submit(sunUrl: string, replace: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/tags/${tag.id}/sun`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sunUrl, replace }),
      });
      const json = (await res.json()) as { ok: boolean; data?: NfcTag; error?: string; needsConfirm?: boolean };
      if (!json.ok || !json.data) {
        setConfirmReplace(json.needsConfirm === true);
        setError(json.error || "요청에 실패했습니다.");
        return;
      }
      setConfirmReplace(false);
      setUrl("");
      setNotice(`${json.data.name}: 기준값 ${json.data.baselineCounter} 로 저장했습니다.`);
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  // 기능: 선택한 목록 태그를 이 지점에 연결한다. 교체·이동 확인이 필요하면 서버 메시지와 확인 버튼을 보여 준다
  async function matchLibrary(replace: boolean) {
    setLibBusy(true);
    setLibError("");
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/tags/${tag.id}/library`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ libraryId, replace }),
      });
      const json = (await res.json()) as { ok: boolean; data?: NfcTag; error?: string; needsConfirm?: boolean };
      if (!json.ok || !json.data) {
        setLibConfirm(json.needsConfirm === true);
        setLibError(json.error || "요청에 실패했습니다.");
        return;
      }
      setLibConfirm(false);
      setLibraryId("");
      setNotice(`${json.data.name}: 목록 태그를 연결했습니다.`);
      await onChange();
      onLibraryChange();
    } catch (err) {
      setLibError(err instanceof Error ? err.message : "요청에 실패했습니다.");
    } finally {
      setLibBusy(false);
    }
  }

  // 변경: 이 지점의 고정 URL 목록 태그 연결만 해제한다 (다른 세션·지점 연결은 그대로, 이 지점의 자동 URL 이 다시 인정된다)
  async function releaseLibrary(entry: LibraryEntry) {
    if (!window.confirm(`"${entry.name}" 연결을 이 지점에서 해제할까요?`)) return;
    setLibBusy(true);
    setLibError("");
    try {
      await api(`/api/admin/sessions/${sessionId}/tags/${tag.id}/library`, { method: "DELETE" });
      setNotice(`${entry.name}: 연결을 해제했습니다.`);
      await onChange();
      onLibraryChange();
    } catch (err) {
      setLibError(err instanceof Error ? err.message : "연결을 해제하지 못했습니다.");
    } finally {
      setLibBusy(false);
    }
  }

  // 기능: 안내·다음 안내·위치 메모를 기존 PATCH 로 저장한다
  async function saveHints(event: React.FormEvent) {
    event.preventDefault();
    setHintError("");
    try {
      await api(`/api/admin/sessions/${sessionId}/tags/${tag.id}`, {
        method: "PATCH",
        body: JSON.stringify(hints),
      });
      setEditing(false);
      setNotice(`${tag.name}: 안내를 저장했습니다.`);
      await onChange();
    } catch (err) {
      setHintError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    }
  }

  async function readNfc() {
    setError("");
    try {
      const { url: read } = await scanNfcOnce();
      if (!read) throw new Error("URL을 읽지 못했습니다.");
      setUrl(read);
      await submit(read, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "NFC 읽기에 실패했습니다.");
    }
  }

  return (
    <li className="rounded-2xl bg-white p-4" data-testid={`tag-row-${tag.order}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs text-ink/40">지점 {tag.order}</p>
          <h3 className="text-lg font-semibold">{tag.name}</h3>
          <p className="mt-1 text-sm text-ink/55">{tag.locationNote || "위치 메모 없음"}</p>
          <p className="mt-2 text-xs text-ink/45">다음 안내: {tag.nextHint || "—"}</p>
        </div>
        <div className="text-right text-xs">
          <p className={cn("font-semibold", registered ? "text-moss" : "text-terra")}>
            {registered ? "등록됨" : "미등록"}
          </p>
          {registered ? (
            <>
              <p className="mt-1 font-mono">UID {tag.uid}</p>
              <p className="mt-1">
                기준값 {tag.baselineCounter ?? "—"} · {formatDateTime(tag.baselineAt)}
              </p>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="태그에서 읽은 URL 붙여넣기"
          aria-label={`${tag.name} 태그 URL`}
          className="min-w-0 flex-1 rounded-xl border border-ink/10 bg-paper px-3 py-1.5 font-mono text-xs"
        />
        <button
          type="button"
          disabled={busy || !url.trim()}
          onClick={() => submit(url, false)}
          className="rounded-full bg-ink px-3 py-1.5 text-xs text-paper disabled:opacity-40"
        >
          {registered ? "기준 갱신" : "등록"}
        </button>
        {isWebNfcAvailable() ? (
          <button
            type="button"
            disabled={busy}
            onClick={readNfc}
            className="rounded-full bg-paper-2 px-3 py-1.5 text-xs"
          >
            NFC로 읽기
          </button>
        ) : null}
        <button type="button" onClick={onRemove} className="rounded-full px-3 py-1.5 text-xs text-terra">
          삭제
        </button>
      </div>
      {/* 기능: 경로 순서 이동(맨 위의 위로·맨 아래의 아래로, 진행 중·종료 세션은 비활성)과 안내 편집 */}
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
          aria-label={`${tag.name} 위로`}
          className="rounded-full border border-ink/20 px-3 py-1 disabled:opacity-30"
        >
          ▲ 위로
        </button>
        <button
          type="button"
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
          aria-label={`${tag.name} 아래로`}
          className="rounded-full border border-ink/20 px-3 py-1 disabled:opacity-30"
        >
          ▼ 아래로
        </button>
        <button
          type="button"
          onClick={() => {
            setHints({ hint: tag.hint, nextHint: tag.nextHint, locationNote: tag.locationNote });
            setHintError("");
            setEditing((v) => !v);
          }}
          aria-label={`${tag.name} 안내 편집`}
          className="rounded-full border border-ink/20 px-3 py-1"
        >
          안내 편집
        </button>
      </div>
      {editing ? (
        <form onSubmit={saveHints} className="mt-2 grid gap-2 rounded-xl bg-paper p-3 sm:grid-cols-3">
          <Field label="이 지점 안내" value={hints.hint} onChange={(v) => setHints({ ...hints, hint: v })} />
          <Field label="다음 목적지 안내" value={hints.nextHint} onChange={(v) => setHints({ ...hints, nextHint: v })} />
          <Field label="위치 메모" value={hints.locationNote} onChange={(v) => setHints({ ...hints, locationNote: v })} />
          <div className="sm:col-span-3">
            <button type="submit" className="rounded-full bg-ink px-3 py-1.5 text-xs text-paper">
              안내 저장
            </button>
            {hintError ? <span className="ml-2 text-xs text-terra">{hintError}</span> : null}
          </div>
        </form>
      ) : null}
      {confirmReplace ? (
        <div className="mt-2 rounded-xl bg-gold/40 px-3 py-2 text-xs">
          기존 태그를 이 태그로 교체할까요?
          <button
            type="button"
            disabled={busy}
            onClick={() => submit(url, true)}
            className="ml-2 rounded-full bg-terra px-3 py-1 text-white"
          >
            교체
          </button>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs text-terra">{error}</p> : null}
      {/* 변경: 태그 목록에서 골라 이 지점에 연결. 목록 기능이 없으면(DB 업데이트 전) 안내만 보이고 나머지 행은 그대로 동작한다 */}
      {library?.available === false ? (
        <p className="mt-3 text-xs text-ink/55">태그 목록 기능을 사용하려면 DB 업데이트가 필요합니다.</p>
      ) : null}
      {library?.available ? (
        <div className="mt-3 rounded-xl bg-paper p-3 text-xs" data-testid={`library-control-${tag.order}`}>
          <p className="font-semibold" data-testid={`library-match-${tag.order}`}>
            {matched ? `태그 목록: ${matched.name}` : "태그 목록에서 연결 안 됨"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              value={libraryId}
              onChange={(event) => {
                setLibraryId(event.target.value);
                setLibConfirm(false);
                setLibError("");
              }}
              aria-label={`${tag.name} 목록에서 연결`}
              className="min-w-0 flex-1 rounded-xl border border-ink/10 bg-white px-3 py-1.5"
            >
              <option value="">목록에서 연결할 태그를 고르세요</option>
              {library.entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.kind === "sun"
                    ? `SUN · ${entry.name} · 카운터 ${entry.counter}`
                    : `고정 URL · ${entry.name}${
                        entry.bindings.length > 0 ? ` (연결된 지점 ${entry.bindings.length}곳)` : ""
                      }`}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={libBusy || !libraryId}
              onClick={() => matchLibrary(false)}
              className="rounded-full bg-ink px-3 py-1.5 text-paper disabled:opacity-40"
            >
              연결
            </button>
            {matched?.kind === "static" ? (
              <button
                type="button"
                disabled={libBusy}
                onClick={() => releaseLibrary(matched)}
                className="rounded-full border border-ink/20 px-3 py-1.5 disabled:opacity-40"
              >
                연결 해제
              </button>
            ) : null}
          </div>
          {libConfirm ? (
            <div className="mt-2 rounded-xl bg-gold/40 px-3 py-2">
              {libError}
              <button
                type="button"
                disabled={libBusy}
                onClick={() => matchLibrary(true)}
                className="ml-2 rounded-full bg-terra px-3 py-1 text-white"
              >
                확인하고 연결
              </button>
            </div>
          ) : libError ? (
            <p className="mt-2 text-terra">{libError}</p>
          ) : null}
          {/* 변경: 공유 연결 규칙 안내 (토큰 교체·이동 없음, 지점별 해제) */}
          <p className="mt-2 text-ink/55" data-testid={`library-note-${tag.order}`}>
            고정 URL 태그를 연결하면 참가자는 목록 URL로 이 지점을 인정받고, 연결된 동안 이 지점의 원래 URL·QR은 인정되지
            않습니다. 같은 태그를 다른 세션의 지점에도 함께 연결할 수 있지만 한 세션에는 한 지점만 연결됩니다. 연결 해제는 이
            지점에만 적용되며, 해제하면 원래 URL·QR이 다시 인정됩니다. 목록 URL은 &quot;고정 QR/URL 허용&quot;이 켜진
            세션에서만 인정됩니다. SUN 태그를 연결하면 기준값이 목록에 저장된 카운터로 정해지므로, 각 세션 레이스 직전 기준
            갱신은 그대로 필요합니다.
          </p>
        </div>
      ) : null}
      {/* 기능: 고정 QR/URL 허용 세션에서만 지점 고정 URL·복사·QR 표시 */}
      {staticUrl ? (
        <div className="mt-3 flex flex-wrap items-start gap-4 rounded-xl bg-paper p-3">
          <div className="min-w-0 flex-1 text-xs">
            <p className="font-semibold">고정 URL (QR·일반 NFC 태그용)</p>
            <p className="mt-1 break-all font-mono" data-testid={`static-url-${tag.order}`}>
              {staticUrl}
            </p>
            <button
              type="button"
              onClick={copyStaticUrl}
              className="mt-2 rounded-full bg-ink px-3 py-1.5 text-paper"
            >
              {copied ? "복사됨" : "URL 복사"}
            </button>
          </div>
          <QrImage value={staticUrl} size={140} label={`${tag.order}. ${tag.name}`} />
        </div>
      ) : null}
    </li>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      {label}
      <input
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-ink/10 bg-paper px-3 py-2"
      />
    </label>
  );
}

function RankingPanel({ live }: { live: AdminLiveView }) {
  return (
    <div>
      <h2 className="font-display text-3xl">순위 · 완주 기록</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-ink/45">
            <tr>
              <th className="py-2">순위</th>
              <th>팀</th>
              <th>진행</th>
              <th>출발</th>
              <th>완주</th>
              <th>기록</th>
            </tr>
          </thead>
          <tbody>
            {live.rankings.map((row) => (
              <tr key={row.teamId} className="border-t border-ink/8">
                <td className="py-3 font-display text-xl">{row.rank}</td>
                <td>
                  <div className="font-semibold">{row.teamName}</div>
                  <div className="text-xs text-ink/40">
                    {row.members.map((m) => m.name).join(", ")}
                  </div>
                </td>
                <td>
                  {row.progress}/{row.required}
                </td>
                <td>{formatClock(row.startedAt)}</td>
                <td>{formatClock(row.finishedAt)}</td>
                <td className="font-semibold">{row.finished ? formatDuration(row.durationMs) : "진행중"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnnouncePanel({
  sessionId,
  live,
  onSent,
}: {
  sessionId: string;
  live: AdminLiveView;
  onSent: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");

  async function send(event: React.FormEvent) {
    event.preventDefault();
    await api(`/api/admin/sessions/${sessionId}/announcements`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    setMessage("");
    await onSent();
  }

  return (
    <div>
      <h2 className="font-display text-3xl">실시간 공지</h2>
      <p className="mt-2 text-sm text-ink/55">
        보낸 즉시 모든 참가자 화면에 배너와 알림으로 나타납니다. 다른 팀 순위는 노출되지 않습니다.
      </p>
      <form onSubmit={send} className="mt-5">
        <textarea
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3"
          placeholder="예: 3번 지점 우회, 시상식은 5시 정각"
        />
        <button type="submit" className="mt-3 rounded-full bg-terra px-5 py-2 text-sm font-semibold text-white">
          공지 보내기
        </button>
      </form>
      <ul className="mt-6 space-y-2">
        {live.announcements.map((item) => (
          <li key={item.id} className="rounded-2xl bg-white px-4 py-3 text-sm">
            {item.pinned ? <span className="mr-2 text-xs text-terra">LIVE</span> : null}
            {item.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SettingsPanel({
  live,
  onSaved,
  onDeleted,
}: {
  live: AdminLiveView;
  onSaved: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState({
    name: live.session.name,
    description: live.session.description,
    checkpointCount: live.session.checkpointCount,
    awardRanks: live.session.awardRanks,
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    await api(`/api/admin/sessions/${live.session.id}`, {
      method: "PATCH",
      body: JSON.stringify(form),
    });
    await onSaved();
  }

  async function remove() {
    if (!confirm("세션과 참가 기록을 모두 삭제할까요?")) return;
    await api(`/api/admin/sessions/${live.session.id}`, { method: "DELETE" });
    onDeleted();
  }

  return (
    <form onSubmit={save} className="max-w-xl space-y-3">
      <h2 className="font-display text-3xl">세션 설정</h2>
      <Field label="이름" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
      <label className="block text-sm">
        설명
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="mt-1 w-full rounded-xl border border-ink/10 bg-white px-3 py-2"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          NFC 태깅 개수
          <input
            type="number"
            min={1}
            value={form.checkpointCount}
            onChange={(e) => setForm({ ...form, checkpointCount: Number(e.target.value) })}
            className="mt-1 w-full rounded-xl border border-ink/10 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm">
          시상 순위 수
          <input
            type="number"
            min={1}
            value={form.awardRanks}
            onChange={(e) => setForm({ ...form, awardRanks: Number(e.target.value) })}
            className="mt-1 w-full rounded-xl border border-ink/10 bg-white px-3 py-2"
          />
        </label>
      </div>
      <p className="text-xs text-ink/45">완주에 필요한 지점 수입니다. 등록된 NFC 태그 목록이 유효성 검사 기준입니다.</p>
      <div className="flex gap-2 pt-2">
        <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm text-paper">
          저장
        </button>
        <button type="button" onClick={remove} className="rounded-full px-4 py-2 text-sm text-terra">
          세션 삭제
        </button>
      </div>
    </form>
  );
}
