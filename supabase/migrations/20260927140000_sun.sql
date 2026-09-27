-- NTAG 424 DNA SUN 검증용 스키마: 태그 기준 카운터, 사용된 카운터 기록, SUN 태깅 함수.
-- 키는 DB 에 저장하지 않는다 (서버 환경 변수 SUN_META_KEY / SUN_MASTER_KEY).

-- 기능: 지점 태그의 기준 카운터와 갱신 시각. 기준 이하 카운터의 SUN URL 은 무효다.
alter table public.tags
  add column baseline_ctr integer check (baseline_ctr between 0 and 16777215),
  add column baseline_at timestamptz;

-- 기능: 한 세션에서 같은 물리 태그(UID)를 두 지점에 묶을 수 없다
create unique index tags_session_uid on public.tags (session_id, upper(uid)) where uid <> '';

-- 기능: 사용된 SUN 카운터. 카운터는 물리 태그에 속하므로 세션과 무관하게 전역으로 한 번만 쓸 수 있다.
-- 세션 삭제 후에도 URL 이 되살아나지 않도록 FK 를 두지 않는다.
create table public.sun_counters (
  uid text not null check (uid ~ '^[0-9A-F]{14}$'),
  ctr integer not null check (ctr between 0 and 16777215),
  used_at timestamptz not null default clock_timestamp(),
  participant_id text not null,
  primary key (uid, ctr)
);

alter table public.sun_counters enable row level security;
revoke all on table public.sun_counters from public, anon, authenticated;
grant select, insert, update, delete on table public.sun_counters to service_role;

-- 기능: SUN 태깅을 한 트랜잭션에서 처리. 카운터 소비(unique) → 태그 조회 → 기준 카운터 → record_tag 와 같은 경주 규칙.
-- 암호 검증(복호화·MAC)은 앱 서버에서 끝난 뒤 검증된 UID·카운터만 넘어온다.
create function public.record_sun_tag(
  p_participant_id text,
  p_uid text,
  p_ctr integer,
  p_event_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_participant public.participants%rowtype;
  v_team public.teams%rowtype;
  v_session public.sessions%rowtype;
  v_tag public.tags%rowtype;
  v_next public.tags%rowtype;
  v_event public.tag_events%rowtype;
  v_uid text := upper(btrim(coalesce(p_uid, '')));
  v_required integer;
  v_tagged integer;
  v_reason text := null;
begin
  select * into v_participant from public.participants where id = p_participant_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', '참가자를 찾을 수 없습니다.');
  end if;
  if v_participant.team_id is null then
    return jsonb_build_object('ok', false, 'error', '먼저 팀에 참가해 주세요.');
  end if;

  -- 기능: 같은 팀의 태깅 요청은 이 잠금에서 순서대로 처리된다
  select * into v_team from public.teams where id = v_participant.team_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', '세션 정보를 찾을 수 없습니다.');
  end if;
  select * into v_session from public.sessions where id = v_participant.session_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', '세션 정보를 찾을 수 없습니다.');
  end if;

  -- 기능: 검증된 SUN URL 은 결과와 무관하게 여기서 소비된다. 같은 URL 의 동시 요청은 unique 인덱스에서 하나만 통과한다.
  begin
    insert into public.sun_counters (uid, ctr, participant_id)
      values (v_uid, p_ctr, v_participant.id);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', '이미 사용된 태그 URL입니다. 태그를 다시 찍어 주세요.');
  end;

  select * into v_tag from public.tags
    where session_id = v_session.id and uid <> '' and upper(uid) = v_uid
    order by seq limit 1;
  if not found then
    insert into public.tag_events (id, session_id, team_id, participant_id, tag_id, valid, reason)
      values (p_event_id, v_session.id, v_team.id, v_participant.id, null, false, '등록되지 않은 NFC 태그입니다.')
      returning * into v_event;
    return jsonb_build_object('ok', false, 'error', v_event.reason, 'event', to_jsonb(v_event));
  end if;

  -- 기능: 기준 카운터가 없거나 그 이하인 URL 은 기준 갱신 이전에 읽힌 것으로 거부
  if v_tag.baseline_ctr is null or p_ctr <= v_tag.baseline_ctr then
    v_reason := '기준 갱신 이전에 읽힌 태그 URL입니다. 태그를 다시 찍어 주세요.';
  elsif v_session.status <> 'live' then
    v_reason := '세션이 진행 중이 아닙니다. 관리자 시작을 기다려 주세요.';
  elsif not exists (select 1 from public.tags where session_id = v_session.id) then
    v_reason := '등록된 NFC 지점이 없습니다.';
  elsif exists (
    select 1 from public.tag_events
      where team_id = v_team.id and valid and tag_id = v_tag.id
  ) then
    v_reason := '이미 태깅한 지점입니다.';
  else
    v_required := public.required_checkpoints(v_session.id);
    select count(distinct tag_id) into v_tagged
      from public.tag_events where team_id = v_team.id and valid;
    if v_tagged >= v_required then
      v_reason := '이미 완주했습니다.';
    else
      select * into v_next from public.tags t
        where t.session_id = v_session.id
          and not exists (
            select 1 from public.tag_events e
              where e.team_id = v_team.id and e.valid and e.tag_id = t.id
          )
        order by t.position, t.seq
        limit 1;
      if not found then
        v_reason := '이미 완주했습니다.';
      elsif v_next.id <> v_tag.id then
        v_reason := format('순서가 아닙니다. 다음 지점은 "%s" 입니다.', v_next.name);
      end if;
    end if;
  end if;

  insert into public.tag_events (id, session_id, team_id, participant_id, tag_id, valid, reason)
    values (
      p_event_id, v_session.id, v_team.id, v_participant.id, v_tag.id,
      v_reason is null, coalesce(v_reason, 'OK')
    )
    returning * into v_event;

  if v_reason is not null then
    return jsonb_build_object(
      'ok', false, 'error', v_reason, 'event', to_jsonb(v_event),
      'race', public.get_team_race_data(v_participant.id)
    );
  end if;

  -- 기능: 유효 태깅이면 팀 시작 시각을 채우고 필요 지점 수에 도달하면 완주 처리 (record_tag 와 동일)
  v_required := public.required_checkpoints(v_session.id);
  select count(distinct tag_id) into v_tagged
    from public.tag_events where team_id = v_team.id and valid;
  update public.teams
    set started_at = coalesce(started_at, v_event.tagged_at),
        finished_at = case
          when finished_at is null and v_tagged >= v_required then v_event.tagged_at
          else finished_at
        end
    where id = v_team.id;

  return jsonb_build_object(
    'ok', true, 'event', to_jsonb(v_event), 'tag', to_jsonb(v_tag),
    'race', public.get_team_race_data(v_participant.id)
  );
end;
$$;

-- 기능: 앱 함수는 service_role 만 실행 가능
revoke execute on function public.record_sun_tag(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_sun_tag(text, text, integer, text) to service_role;
