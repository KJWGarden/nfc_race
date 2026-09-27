"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { toSunParams } from "@/lib/nfc";
import { overlayFor, PENDING_TAG_KEY, saveTagFlash, type TagSuccess } from "@/lib/tag-result";
import type { TeamRaceView } from "@/lib/types";

// 기능: Strict Mode 에서 effect 가 두 번 돌아도 같은 SUN URL 은 한 번만 제출한다
const submitted = new Set<string>();

export function ParticipantTagLanding({ e, c }: { e: string; c: string }) {
  const router = useRouter();
  const sun = useMemo(() => toSunParams(e, c), [e, c]);
  const [message, setMessage] = useState("태그를 확인하는 중…");

  // 변경: 정적 토큰 대신 태그가 만든 SUN 파라미터(e, c)를 제출한다. 팀·참가 정보가 없으면 보관했다가 참가 후 한 번 제출한다.
  useEffect(() => {
    if (!sun || submitted.has(sun.e)) return;
    submitted.add(sun.e);
    const payload = JSON.stringify(sun);
    async function run() {
      try {
        const me = await api<TeamRaceView>("/api/me");
        if (!me.team) {
          sessionStorage.setItem(PENDING_TAG_KEY, payload);
          router.replace("/race");
          return;
        }
        const result = await api<TagSuccess>("/api/tag", { method: "POST", body: payload });
        saveTagFlash(overlayFor(result));
        router.replace("/race");
      } catch (err) {
        const text = err instanceof Error ? err.message : "태깅에 실패했습니다.";
        if (text.includes("참가 정보")) {
          sessionStorage.setItem(PENDING_TAG_KEY, payload);
          router.replace("/");
          return;
        }
        setMessage(text);
      }
    }
    run();
  }, [sun, router]);

  return (
    <main className="grid min-h-screen place-items-center bg-ink px-6 text-center text-paper">
      <div>
        <p className="text-xs tracking-[0.2em] text-lime">NFC</p>
        <h1 className="font-display mt-3 text-4xl">
          {sun ? message : "SUN 정보가 없는 태그입니다. 관리자에게 문의해 주세요."}
        </h1>
        <button
          type="button"
          onClick={() => router.replace("/race")}
          className="mt-6 rounded-full bg-lime px-5 py-2 text-sm font-semibold text-ink"
        >
          레이스로 돌아가기
        </button>
      </div>
    </main>
  );
}
