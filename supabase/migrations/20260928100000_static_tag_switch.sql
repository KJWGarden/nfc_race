-- 고정 URL(QR, 같은 URL 을 담은 일반 NFC 태그) 태깅을 세션별 스위치로 허용한다.
-- 스위치가 꺼진 세션은 지금처럼 SUN(NTAG 424 DNA) 전용이다. 기존 마이그레이션은 수정하지 않는다.

-- 기능: 세션별 고정 URL 태깅 허용 스위치. 기존·신규 세션 모두 꺼짐
alter table public.sessions add column allow_static_url boolean not null default false;

-- 기능: 고정 토큰 태깅을 한 트랜잭션에서 처리 (UID·카운터·기준값 경로 없음).
-- 스위치 확인 → 팀 잠금 → 스위치 재확인 → 참가자 세션 안에서 토큰 조회 → record_sun_tag 와 같은 경주 규칙.
create function public.record_static_tag(
  p_participant_id text,
  p_token text,
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
  v_token text := lower(btrim(coalesce(p_token, '')));
  v_disabled constant text := '태그 정보가 없습니다.';
  v_required integer;
  v_tagged integer;
  v_reason text := null;
begin
  -- 기능: 스위치가 꺼진 세션(또는 참가자·세션 없음)은 기존 응답과 같은 메시지로 아무것도 쓰지 않고 끝낸다
  select * into v_participant from public.participants where id = p_participant_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', v_disabled);
  end if;
  select * into v_session from public.sessions where id = v_participant.session_id;
  if not found or not v_session.allow_static_url then
    return jsonb_build_object('ok', false, 'error', v_disabled);
  end if;
  if v_participant.team_id is null then
    return jsonb_build_object('ok', false, 'error', '먼저 팀에 참가해 주세요.');
  end if;

  -- 기능: 같은 팀의 태깅 요청은 이 잠금에서 순서대로 처리된다
  select * into v_team from public.teams where id = v_participant.team_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', '세션 정보를 찾을 수 없습니다.');
  end if;
  -- 기능: 잠금 이후 세션을 다시 읽어 그 사이 꺼진 스위치를 반영한다
  select * into v_session from public.sessions where id = v_participant.session_id;
  if not found or not v_session.allow_static_url then
    return jsonb_build_object('ok', false, 'error', v_disabled);
  end if;

  -- 기능: 참가자 세션의 지점만 조회. 모르는 토큰·다른 세션 토큰은 기록 없이 거부 (무효 기록 남발 방지)
  select * into v_tag from public.tags
    where session_id = v_session.id and v_token <> '' and lower(token) = v_token
    order by seq limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', '등록되지 않은 NFC 태그입니다.');
  end if;

  -- 기능: record_sun_tag 의 경주 규칙과 메시지를 그대로 따른다 (기준 카운터 단계만 없음)
  if v_session.status <> 'live' then
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

  -- 기능: 유효 태깅이면 팀 시작 시각을 채우고 필요 지점 수에 도달하면 완주 처리 (record_sun_tag 와 동일)
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
revoke execute on function public.record_static_tag(text, text, text) from public, anon, authenticated;
grant execute on function public.record_static_tag(text, text, text) to service_role;
