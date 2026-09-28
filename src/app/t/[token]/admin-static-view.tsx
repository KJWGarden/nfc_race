import Link from "next/link";
import { sessionStatusLabel } from "@/lib/format";
import type { StaticTagInfo } from "@/lib/types";
import { AdminLogoutButton } from "./admin-logout-button";

// 기능: 관리자 기기로 고정 URL(/t/{token})을 열었을 때의 읽기 전용 화면.
// 참가자 제출 코드를 마운트하지 않으므로 /api/tag 호출·pendingTag 저장이 없다.
export function AdminStaticView({ info }: { info: StaticTagInfo | null }) {
  return (
    <main className="min-h-screen bg-ink px-5 py-8 text-paper">
      <div className="mx-auto max-w-md space-y-5">
        <div className="rounded-2xl bg-gold px-4 py-3 text-sm text-ink">
          관리자 모드 — 참가자 태깅은 기록되지 않습니다.
          <AdminLogoutButton />
        </div>
        <h1 className="font-display text-4xl">고정 URL 지점 확인</h1>
        {info ? (
          <article className="rounded-2xl bg-paper p-4 text-ink" data-testid="admin-static-info">
            <p className="text-xs text-ink/50">
              {info.sessionName} · {sessionStatusLabel(info.sessionStatus)}
            </p>
            <h2 className="text-lg font-semibold">
              지점 {info.order} {info.tagName}
            </h2>
            <p className="mt-2 text-sm">
              고정 QR/URL 허용: <strong>{info.allowStaticUrl ? "켜짐" : "꺼짐"}</strong>
            </p>
            {!info.allowStaticUrl ? (
              <p className="mt-1 text-xs text-ink/55">꺼져 있어 참가자가 이 URL로 태깅해도 인정되지 않습니다.</p>
            ) : null}
            <Link href={`/admin/sessions/${info.sessionId}`} className="mt-3 inline-block text-sm underline">
              세션 관리로 이동
            </Link>
          </article>
        ) : (
          <p className="text-terra">등록되지 않은 태그입니다.</p>
        )}
        <Link href="/admin" className="inline-block text-sm text-paper/70 underline">
          관리자 홈
        </Link>
      </div>
    </main>
  );
}
