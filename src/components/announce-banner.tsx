"use client";

import type { Announcement } from "@/lib/types";

export function AnnounceBanner({
  announcement,
  fresh,
}: {
  announcement: Announcement | null;
  fresh?: boolean;
}) {
  if (!announcement) return null;
  return (
    <div
      className={`rounded-2xl border border-ink/10 bg-ink px-4 py-3 text-paper shadow-sm ${
        fresh ? "animate-toast" : ""
      }`}
    >
      <p className="text-[11px] font-semibold tracking-[0.16em] text-lime uppercase">
        운영 공지
      </p>
      <p className="mt-1 text-sm leading-6">{announcement.message}</p>
    </div>
  );
}

export function AnnounceToast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div className="animate-toast flex w-full max-w-md items-start gap-3 rounded-2xl bg-terra px-4 py-3 text-white shadow-xl">
        <div className="flex-1">
          <p className="text-[11px] font-semibold tracking-[0.16em] uppercase">새 공지</p>
          <p className="mt-1 text-sm leading-6">{message}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-white/80 text-sm"
          aria-label="닫기"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
