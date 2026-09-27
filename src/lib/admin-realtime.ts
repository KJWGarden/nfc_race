"use client";

import { useEffect, useRef } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { api } from "./api";

const REFETCH_DEBOUNCE_MS = 400;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const CHANNEL_LINGER_MS = 1000;

let cachedToken: { token: string; expiresAt: number } | null = null;
let client: SupabaseClient | null = null;

// 기능: 관리자 쿠키로 발급받은 Realtime 토큰을 캐시하고 만료 5분 전에 다시 받는다.
// Realtime 은 연결·heartbeat 마다 이 콜백을 호출하므로 토큰 갱신도 여기서 이뤄진다.
async function adminRealtimeToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
    return cachedToken.token;
  }
  cachedToken = await api<{ token: string; expiresAt: number }>("/api/admin/realtime-token");
  return cachedToken.token;
}

// 기능: 브라우저 Supabase 클라이언트는 공개 키 + 관리자 토큰(accessToken 콜백)만 사용한다
function adminRealtimeClient(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, { accessToken: adminRealtimeToken });
  return client;
}

type Entry = {
  listeners: Set<() => void>;
  channel: RealtimeChannel | null;
  disposed: boolean;
  removeTimer?: ReturnType<typeof setTimeout>;
};

const entries = new Map<string, Entry>();
const removals = new Map<string, Promise<unknown>>();

// 기능: 세션별 private 채널을 하나만 유지하는 참조 카운트 구독.
// 같은 topic 채널이 닫히는 중이면 닫힌 뒤에 새로 만들어 중복 구독을 막는다.
function acquireChannel(supabase: SupabaseClient, sessionId: string, listener: () => void) {
  let entry = entries.get(sessionId);
  if (!entry) {
    const created: Entry = {
      listeners: new Set(),
      channel: null,
      disposed: false,
    };
    const notify = () => created.listeners.forEach((fn) => fn());
    // 기능: 닫히는 중인 채널을 기다리고, 관리자 토큰을 먼저 설정한 뒤 private 채널에 참가한다
    void (removals.get(sessionId) ?? Promise.resolve())
      .then(() => supabase.realtime.setAuth())
      .catch(() => undefined)
      .then(() => {
        if (created.disposed) return;
        created.channel = supabase
          .channel(`cp-admin:${sessionId}`, { config: { private: true } })
          .on("broadcast", { event: "change" }, notify)
          .subscribe((status) => {
            if (status === "SUBSCRIBED") notify();
          });
      });
    entries.set(sessionId, created);
    entry = created;
  }
  const current = entry;
  clearTimeout(current.removeTimer);
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    current.removeTimer = setTimeout(() => {
      current.disposed = true;
      entries.delete(sessionId);
      if (!current.channel) return;
      const removal = supabase.removeChannel(current.channel).finally(() => {
        if (removals.get(sessionId) === removal) removals.delete(sessionId);
      });
      removals.set(sessionId, removal);
    }, CHANNEL_LINGER_MS);
  };
}

// 기능: cp-admin:<sessionId> 변경 신호를 받으면 onChange 를 디바운스 호출.
// 구독 완료(재연결 포함) 시에도 한 번 호출해 놓친 변경을 따라잡는다.
export function useAdminRealtime(sessionId: string | undefined, onChange: () => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const supabase = adminRealtimeClient();
    if (!sessionId || !supabase) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const release = acquireChannel(supabase, sessionId, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => onChangeRef.current(), REFETCH_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(debounce);
      release();
    };
  }, [sessionId]);
}
