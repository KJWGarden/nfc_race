-- 관리자 화면 전용 Supabase Realtime 변경 신호.
-- 앱 테이블이 바뀌면 DB 가 private broadcast 채널 cp-admin:<sessionId> 로 {type, sessionId} 만 보낸다.
-- 행 데이터는 보내지 않는다. 수신은 서버가 발급한 관리자 JWT(cp_role=admin)를 가진 클라이언트만 가능하다.

-- 기능: 행 변경 시 해당 세션의 관리자 채널로 변경 신호 전송 (데이터와 같은 트랜잭션에서 커밋)
create function public.notify_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_row record;
  v_session_id text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  if tg_table_name = 'sessions' then
    v_session_id := v_row.id;
  else
    v_session_id := v_row.session_id;
  end if;
  perform realtime.send(
    jsonb_build_object('type', tg_table_name, 'sessionId', v_session_id),
    'change',
    'cp-admin:' || v_session_id,
    true
  );
  return null;
end;
$$;

revoke execute on function public.notify_admin_change() from public, anon, authenticated;

create trigger sessions_notify_admin after insert or update or delete on public.sessions
  for each row execute function public.notify_admin_change();
create trigger tags_notify_admin after insert or update or delete on public.tags
  for each row execute function public.notify_admin_change();
create trigger teams_notify_admin after insert or update or delete on public.teams
  for each row execute function public.notify_admin_change();
create trigger participants_notify_admin after insert or update or delete on public.participants
  for each row execute function public.notify_admin_change();
create trigger tag_events_notify_admin after insert or update or delete on public.tag_events
  for each row execute function public.notify_admin_change();
create trigger announcements_notify_admin after insert or update or delete on public.announcements
  for each row execute function public.notify_admin_change();

-- 기능: 관리자 JWT 로 cp-admin:* private broadcast 채널 수신만 허용 (송신 정책·anon 정책 없음)
create policy "cp admin receive" on realtime.messages
  for select
  to authenticated
  using (
    (select auth.jwt() ->> 'cp_role') = 'admin'
    and realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'cp-admin:%'
  );
