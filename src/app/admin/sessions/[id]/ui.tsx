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
import type { AdminLiveView, NfcTag, SessionStatus } from "@/lib/types";

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

      <ol className="space-y-4">
        {live.tags.map((tag) => (
          <SunTagRow
            key={tag.id}
            sessionId={live.session.id}
            tag={tag}
            staticUrl={allowStatic ? `${origin}/t/${tag.token}` : null}
            onChange={onChange}
            onRemove={() => removeTag(tag)}
            setNotice={setNotice}
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
  staticUrl,
  onChange,
  onRemove,
  setNotice,
}: {
  sessionId: string;
  tag: NfcTag;
  staticUrl: string | null;
  onChange: () => Promise<void>;
  onRemove: () => void;
  setNotice: (value: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const registered = tag.uid !== "";

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
