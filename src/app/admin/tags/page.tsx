"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api, originFromWindow } from "@/lib/api";
import { formatDateTime, sessionStatusLabel } from "@/lib/format";
import { isWebNfcAvailable, scanNfcOnce } from "@/lib/nfc";
import { QrImage } from "@/components/qr-image";
import type { LibraryBinding, LibraryEntry, LibraryList } from "@/lib/types";

const UNAVAILABLE_MESSAGE = "태그 목록 기능을 사용하려면 DB 업데이트가 필요합니다.";

// 기능: 진행 중 세션이 연결에 있으면 확인 창에 붙이는 경고 (세션 이름 포함)
function liveWarning(bindings: LibraryBinding[]): string {
  const names = [...new Set(bindings.filter((b) => b.sessionStatus === "live").map((b) => b.sessionName))];
  if (names.length === 0) return "";
  return `\n\n진행 중인 세션이 있습니다: ${names.join(", ")}. 연결을 해제하면 이 지점은 바로 인정되지 않습니다. 아직 이 지점에 오지 않은 팀은 여기서 막힐 수 있습니다.`;
}

// 기능: 태그 목록 관리 화면. SUN 태그는 읽은 URL + 이름으로, 고정 URL 태그는 이름으로 등록하고 연결 현황을 본다
export default function AdminTagsPage() {
  const [library, setLibrary] = useState<LibraryList | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sunName, setSunName] = useState("");
  const [sunUrl, setSunUrl] = useState("");
  const [staticName, setStaticName] = useState("");
  // 변경: 주소와 Web NFC 지원은 목록을 받은 뒤에만 화면에 쓰이므로 초기값으로 한 번만 읽는다
  const [origin] = useState(() => originFromWindow());
  const [copiedId, setCopiedId] = useState("");
  const [nfcReady] = useState(() => isWebNfcAvailable());

  // 기능: 목록을 다시 읽는다 (등록·삭제 뒤마다 호출)
  async function load() {
    try {
      setLibrary(await api<LibraryList>("/api/admin/library"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    }
  }

  // 변경: 첫 로드는 응답이 온 뒤에만 상태를 바꾼다
  useEffect(() => {
    api<LibraryList>("/api/admin/library")
      .then(setLibrary)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "불러오지 못했습니다."));
  }, []);

  // 기능: 등록·발급·삭제 공통 실행. 서버 메시지를 그대로 보여 주고 성공하면 목록을 다시 읽는다
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
      await load();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  // 기능: 입력한 이름과 SUN URL 로 태그 목록에 등록 (서버가 SUN 을 검증)
  async function registerSun(url: string) {
    await run(async () => {
      const entry = await api<LibraryEntry>("/api/admin/library", {
        method: "POST",
        body: JSON.stringify({ kind: "sun", url, name: sunName }),
      });
      setSunUrl("");
      setSunName("");
      return `${entry.name}: 카운터 ${entry.counter} 로 저장했습니다.`;
    });
  }

  // 기능: Web NFC 로 태그의 URL 을 읽어 URL 입력란에 채운다
  async function readNfc() {
    setError("");
    try {
      const { url } = await scanNfcOnce();
      if (!url) throw new Error("URL을 읽지 못했습니다.");
      setSunUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "NFC 읽기에 실패했습니다.");
    }
  }

  // 기능: 이름으로 고정 URL 태그를 발급한다 (서버가 새 토큰 생성)
  async function issueStatic(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const entry = await api<LibraryEntry>("/api/admin/library", {
        method: "POST",
        body: JSON.stringify({ kind: "static", name: staticName }),
      });
      setStaticName("");
      return `${entry.name}: 고정 URL을 발급했습니다.`;
    });
  }

  // 변경: 확인을 받은 뒤 목록 태그를 삭제한다. 연결이 있으면 해제될 지점을 모두 보여 주고, 서버가 모두 해제한 뒤 삭제한다
  async function remove(entry: LibraryEntry) {
    const message =
      entry.bindings.length === 0
        ? `"${entry.name}" 태그를 목록에서 삭제할까요?`
        : `"${entry.name}" 태그를 목록에서 삭제할까요?\n모든 연결을 해제한 뒤 삭제합니다.\n${entry.bindings
            .map((b) => `- ${b.sessionName} · 지점 ${b.order} ${b.tagName}`)
            .join("\n")}${liveWarning(entry.bindings)}`;
    if (!window.confirm(message)) return;
    await run(async () => {
      const result = await api<{ id: string; detached: number }>(`/api/admin/library/${entry.id}`, { method: "DELETE" });
      return result.detached > 0
        ? `${entry.name}: 연결 ${result.detached}곳을 해제하고 삭제했습니다.`
        : `${entry.name}: 삭제했습니다.`;
    });
  }

  // 기능: 연결 하나를 확인 후 해제한다 (고정 URL: 이 지점의 목록 URL 연결, SUN: 이 지점의 등록). 진행 중 세션이면 경고를 붙인다
  async function detach(entry: LibraryEntry, binding: LibraryBinding) {
    const effect =
      entry.kind === "static"
        ? "이 지점에서 이 고정 URL이 더 이상 인정되지 않고, 고정 QR/URL 허용이 켜져 있으면 지점의 원래 URL·QR이 다시 인정됩니다."
        : "이 지점의 태그 등록(UID·기준값)이 지워져 미등록이 됩니다. 다시 쓰려면 등록이 필요합니다. 사용된 URL은 계속 무효입니다.";
    const message = `"${entry.name}" 연결을 해제할까요?\n${binding.sessionName} · 지점 ${binding.order} ${binding.tagName}\n\n${effect}${liveWarning([binding])}`;
    if (!window.confirm(message)) return;
    await run(async () => {
      const result = await api<{ detached: boolean }>(
        `/api/admin/library/${entry.id}/bindings/${binding.tagId}`,
        { method: "DELETE" },
      );
      return result.detached
        ? `${entry.name}: ${binding.sessionName} 지점 ${binding.order} ${binding.tagName} 연결을 해제했습니다.`
        : "이미 연결이 해제되어 있습니다.";
    });
  }

  // 기능: 고정 URL 을 클립보드에 복사 (NFC 쓰기 앱에 붙여넣기용)
  async function copy(entry: LibraryEntry, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(entry.id);
    } catch {
      setError("URL을 복사하지 못했습니다. 직접 선택해 복사하세요.");
    }
  }

  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-lime">CHECKPOINT / ADMIN</p>
            <h1 className="font-display mt-2 text-5xl">태그 목록</h1>
          </div>
          <Link href="/admin" className="rounded-full border border-white/15 px-4 py-2 text-sm">
            세션 목록
          </Link>
        </header>

        {error ? <p className="mt-6 text-terra">{error}</p> : null}
        {notice ? <p className="mt-6 rounded-2xl bg-lime px-4 py-3 text-sm text-ink">{notice}</p> : null}

        {library && !library.available ? (
          <p className="mt-8 rounded-2xl bg-gold px-4 py-3 text-sm text-ink">{UNAVAILABLE_MESSAGE}</p>
        ) : null}

        {library?.available ? (
          <>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <section className="rounded-3xl bg-paper p-5 text-ink">
                <h2 className="font-semibold">SUN 태그 등록</h2>
                <p className="mt-1 text-xs text-ink/55">
                  태그를 찍어 나온 URL과 이름을 입력합니다. 서버가 검증한 UID와 카운터가 저장됩니다.
                </p>
                <form
                  className="mt-3 space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    registerSun(sunUrl);
                  }}
                >
                  <input
                    value={sunName}
                    onChange={(e) => setSunName(e.target.value)}
                    placeholder="태그 이름"
                    aria-label="SUN 태그 이름"
                    className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm"
                  />
                  <input
                    value={sunUrl}
                    onChange={(e) => setSunUrl(e.target.value)}
                    placeholder="태그에서 읽은 URL 붙여넣기"
                    aria-label="SUN 태그 URL"
                    className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
                    >
                      SUN 태그 등록
                    </button>
                    {nfcReady ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={readNfc}
                        className="rounded-full border border-ink/20 px-4 py-2 text-sm disabled:opacity-50"
                      >
                        NFC로 읽기
                      </button>
                    ) : null}
                  </div>
                </form>
              </section>

              <section className="rounded-3xl bg-paper p-5 text-ink">
                <h2 className="font-semibold">고정 URL 태그 발급</h2>
                <p className="mt-1 text-xs text-ink/55">
                  이름을 입력하면 새 URL과 QR이 만들어집니다. QR로 인쇄하거나 NTAG213 같은 일반 태그에는 아무 NFC 쓰기 앱으로
                  URL을 기록하세요. 세션의 &quot;고정 QR/URL 허용&quot;이 켜져 있을 때만 지점이 인정됩니다.
                </p>
                <form className="mt-3 space-y-2" onSubmit={issueStatic}>
                  <input
                    value={staticName}
                    onChange={(e) => setStaticName(e.target.value)}
                    placeholder="태그 이름"
                    aria-label="고정 URL 태그 이름"
                    className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
                  >
                    고정 URL 발급
                  </button>
                </form>
              </section>
            </div>

            <ul className="mt-8 grid gap-4">
              {library.entries.length === 0 ? (
                <li className="text-sm text-paper/55">등록된 태그가 없습니다.</li>
              ) : null}
              {library.entries.map((entry) => {
                const url = entry.token && origin ? `${origin}/t/${entry.token}` : null;
                return (
                  <li
                    key={entry.id}
                    className="rounded-3xl border border-white/10 bg-ink-2 p-5"
                    data-testid={`library-row-${entry.id}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold text-lime">
                          {entry.kind === "sun" ? "SUN" : "고정 URL"}
                        </p>
                        <h2 className="mt-1 text-xl font-semibold">{entry.name}</h2>
                        {entry.kind === "sun" ? (
                          <p className="mt-1 text-sm text-paper/60">
                            <span className="font-mono">UID {entry.uid}</span> · 카운터 {entry.counter} ·{" "}
                            {formatDateTime(entry.counterAt)}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(entry)}
                        aria-label={`${entry.name} 삭제`}
                        className="rounded-full border border-white/15 px-3 py-1.5 text-xs disabled:opacity-50"
                      >
                        삭제
                      </button>
                    </div>

                    {url ? (
                      <div className="mt-3 flex flex-wrap items-start gap-4 rounded-2xl bg-paper p-3 text-xs text-ink">
                        <div>
                          <p className="font-semibold">고정 URL</p>
                          <p className="mt-1 break-all font-mono" data-testid={`library-url-${entry.id}`}>
                            {url}
                          </p>
                          <button
                            type="button"
                            onClick={() => copy(entry, url)}
                            aria-label={`${entry.name} URL 복사`}
                            className="mt-2 rounded-full bg-ink px-3 py-1.5 text-paper"
                          >
                            {copiedId === entry.id ? "복사됨" : "URL 복사"}
                          </button>
                        </div>
                        <QrImage value={url} size={120} label={entry.name} />
                      </div>
                    ) : null}

                    <div className="mt-3 text-sm text-paper/70" data-testid={`library-bindings-${entry.id}`}>
                      {/* 변경: 연결 현황(지점 수와 지점별 줄)과 연결별 해제 버튼. SUN 은 기준값, 고정 URL 은 스위치 꺼짐 안내를 함께 보여 준다 */}
                      {entry.bindings.length > 0 ? (
                        <>
                          <p className="font-semibold text-paper/85">연결된 지점 {entry.bindings.length}곳</p>
                          <ul className="mt-2 space-y-2">
                            {entry.bindings.map((b) => (
                              <li key={b.tagId} className="flex flex-wrap items-center justify-between gap-2">
                                <p>
                                  {b.sessionName} · {sessionStatusLabel(b.sessionStatus)} · 지점 {b.order} {b.tagName}
                                  {entry.kind === "static" && !b.allowStaticUrl
                                    ? " (이 세션은 고정 URL 허용이 꺼져 있습니다)"
                                    : ""}
                                  {entry.kind === "sun" ? ` · 기준값 ${b.baselineCtr ?? "—"}` : ""}
                                </p>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => detach(entry, b)}
                                  aria-label={`${entry.name} ${b.sessionName} 지점 ${b.order} 연결 해제`}
                                  className="rounded-full border border-white/15 px-3 py-1 text-xs disabled:opacity-50"
                                >
                                  연결 해제
                                </button>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p>연결 안 됨</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>
    </main>
  );
}
