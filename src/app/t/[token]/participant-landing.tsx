"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { toStaticParams, toSunParams } from "@/lib/nfc";
import { overlayFor, PENDING_TAG_KEY, saveTagFlash, type TagSuccess } from "@/lib/tag-result";
import type { TeamRaceView } from "@/lib/types";

// 기능: Strict Mode 에서 effect 가 두 번 돌아도 같은 SUN URL 은 한 번만 제출한다
const submitted = new Set<string>();

type Router = ReturnType<typeof useRouter>;

// 변경: SUN·고정 URL 랜딩이 함께 쓰는 제출 흐름. 팀·참가 정보가 없으면 보관했다가 참가 후 한 번 제출한다.
async function submitTagPayload(payload: string, router: Router, setMessage: (text: string) => void) {
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

export function ParticipantTagLanding({ e, c }: { e: string; c: string }) {
  const router = useRouter();
  const sun = useMemo(() => toSunParams(e, c), [e, c]);
  const [message, setMessage] = useState("태그를 확인하는 중…");

  // 변경: 정적 토큰 대신 태그가 만든 SUN 파라미터(e, c)를 제출한다. 팀·참가 정보가 없으면 보관했다가 참가 후 한 번 제출한다.
  useEffect(() => {
    if (!sun || submitted.has(sun.e)) return;
    submitted.add(sun.e);
    void submitTagPayload(JSON.stringify(sun), router, setMessage);
  }, [sun, router]);

  return <LandingScreen text={sun ? message : "SUN 정보가 없는 태그입니다. 관리자에게 문의해 주세요."} />;
}

// 기능: 고정 QR/URL 허용 세션의 지점 URL 랜딩. 토큰({token})을 SUN 과 같은 흐름으로 제출한다.
// 같은 URL 을 나중에 다시 열 수 있도록 모듈 단위가 아닌 마운트 단위로 한 번만 제출한다.
export function ParticipantStaticLanding({ token }: { token: string }) {
  const router = useRouter();
  const params = useMemo(() => toStaticParams(token), [token]);
  const [message, setMessage] = useState("태그를 확인하는 중…");
  const started = useRef(false);

  useEffect(() => {
    if (!params || started.current) return;
    started.current = true;
    void submitTagPayload(JSON.stringify(params), router, setMessage);
  }, [params, router]);

  return <LandingScreen text={params ? message : "SUN 정보가 없는 태그입니다. 관리자에게 문의해 주세요."} />;
}

function LandingScreen({ text }: { text: string }) {
  const router = useRouter();
  return (
    <main className="grid min-h-screen place-items-center bg-ink px-6 text-center text-paper">
      <div>
        <p className="text-xs tracking-[0.2em] text-lime">NFC</p>
        <h1 className="font-display mt-3 text-4xl">{text}</h1>
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
