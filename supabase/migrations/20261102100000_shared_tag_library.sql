-- 태그 목록 공유: 목록 태그(SUN·고정 URL)를 여러 세션의 지점에 동시에 연결하고, 세션마다 경로(지점 순서)를 따로 정한다.
-- 고정 URL 태그는 더 이상 지점 토큰을 바꿔 끼우지 않는다. 지점별 연결은 tags.library_id 에 저장하고 (세션당 같은 태그 하나),
-- 고정 URL 태깅은 참가자 세션 안에서 목록 토큰 → 연결된 지점으로 찾는다. 기존 마이그레이션은 수정하지 않는다.

-- 기능: 구버전 앱의 연결·해제 호출과 직렬화한다 (마이그레이션 전체가 한 트랜잭션)
select pg_advisory_xact_lock(hashtext('cp-library-binding'));

-- 기능: 지점별 고정 URL 목록 태그 연결. 연결된 목록 태그는 DB 수준에서도 삭제되지 않는다 (NO ACTION)
alter table public.tags add column library_id text references public.tag_library (id);
create unique index tags_session_library_key on public.tags (session_id, library_id) where library_id is not null;
create index tags_library_idx on public.tags (library_id) where library_id is not null;

-- 기능: 토큰을 바꿔 끼운 기존 연결을 옮기기 전 상태 확인. 복원할 수 없는 행이 있으면 전체를 중단한다
do $$
begin
  if exists (
    select 1 from public.tag_library l join public.tags t on t.id = l.bound_tag_id
      where l.kind = 'static' and t.original_token is null
  ) then
    raise exception 'shared_tag_library: bound static entry without a saved original token';
  end if;
  if exists (
    select 1 from public.tags t
      where t.original_token is not null
        and not exists (select 1 from public.tag_library l where l.bound_tag_id = t.id)
  ) then
    raise exception 'shared_tag_library: saved original token without a bound library entry';
  end if;
end;
$$;

-- 기능: 기존 연결 이전. 지점에 원래 자동 토큰을 되돌리고 같은 목록 태그를 library_id 로 연결한다
update public.tags t
  set library_id = l.id, token = t.original_token, original_token = null
  from public.tag_library l
  where l.kind = 'static' and l.bound_tag_id = t.id;
update public.tag_library set bound_tag_id = null where bound_tag_id is not null;

-- 기능: 토큰 교체 상태가 다시 생기지 않도록 구조적으로 막는다 (컬럼은 기존 함수 호환을 위해 남김)
alter table public.tag_library add constraint tag_library_bound_tag_unused check (bound_tag_id is null);
alter table public.tags add constraint tags_original_token_unused check (original_token is null);

-- 기능: 이 마이그레이션이 적용됐는지 앱이 확인하는 함수 (구 스키마에는 없음)
create function public.shared_library_schema()
returns integer
language sql
immutable
security invoker
set search_path = public
as $$
  select 2;
$$;

-- 변경: 고정 토큰 태깅. 참가자 세션 안에서 (가) 목록 토큰 → 그 태그가 연결된 지점, (나) 목록 태그가 연결되지 않은 지점의 자동 토큰 순으로 찾는다.
-- 스위치 확인·팀 잠금·경주 규칙·메시지는 20260928100000 과 같다.
create or replace function public.record_static_tag(
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

  -- 변경: (가) 목록 고정 URL 토큰이면 참가자 세션에서 그 태그가 연결된 지점
  select t.* into v_tag from public.tags t
    join public.tag_library l on l.id = t.library_id
    where t.session_id = v_session.id and l.kind = 'static' and v_token <> '' and lower(l.token) = v_token
    limit 1;
  -- 변경: (나) 아니면 목록 태그가 연결되지 않은 지점의 자동 토큰. 모르는 토큰·다른 세션 토큰은 기록 없이 거부
  if not found then
    select * into v_tag from public.tags
      where session_id = v_session.id and v_token <> '' and lower(token) = v_token and library_id is null
      order by seq limit 1;
  end if;
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

-- 변경: 고정 URL 태그를 지점에 연결. 토큰은 바꾸지 않고 tags.library_id 만 쓴다 (다른 세션 연결은 그대로).
-- 잠금 순서: 전역 advisory → tags(id 순) → tag_library. 같은 세션의 다른 지점에 이미 있으면 409, 다른 태그가 연결된 지점은 확인 후 교체.
create or replace function public.match_library_static(
  p_session_id text,
  p_tag_id text,
  p_library_id text,
  p_replace boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry public.tag_library%rowtype;
  v_target public.tags%rowtype;
  v_other public.tags%rowtype;
  v_prev_name text;
begin
  perform pg_advisory_xact_lock(hashtext('cp-library-binding'));
  select * into v_entry from public.tag_library where id = p_library_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그 목록에서 태그를 찾을 수 없습니다.');
  end if;
  if v_entry.kind <> 'static' then
    return jsonb_build_object('ok', false, 'status', 400, 'error', '고정 URL 태그가 아닙니다.');
  end if;

  -- 기능: 대상 지점과 이 세션에서 같은 태그가 연결된 지점을 id 순으로 잠근 뒤 상태를 다시 읽는다
  perform 1 from public.tags
    where id = p_tag_id or (session_id = p_session_id and library_id = p_library_id)
    order by id for no key update;
  select * into v_target from public.tags where id = p_tag_id and session_id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그를 찾을 수 없습니다.');
  end if;
  perform 1 from public.tag_library where id = p_library_id for share;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그 목록에서 태그를 찾을 수 없습니다.');
  end if;

  if v_target.library_id = p_library_id then
    return jsonb_build_object('ok', true, 'tag', to_jsonb(v_target));
  end if;

  -- 기능: 한 세션 경로에는 같은 목록 태그를 한 번만 쓴다
  select * into v_other from public.tags
    where session_id = p_session_id and library_id = p_library_id and id <> p_tag_id
    limit 1;
  if found then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error', format('이 태그는 이 세션의 "%s" 지점에 이미 연결되어 있습니다.', v_other.name)
    );
  end if;

  -- 기능: 다른 고정 URL 태그가 연결된 지점은 관리자가 확인한 경우에만 교체한다
  if v_target.library_id is not null and not coalesce(p_replace, false) then
    select name into v_prev_name from public.tag_library where id = v_target.library_id;
    return jsonb_build_object(
      'ok', false, 'status', 409, 'needsConfirm', true,
      'error', format('이 지점에는 다른 고정 URL 태그("%s")가 연결되어 있습니다. 교체하려면 확인해 주세요.', v_prev_name)
    );
  end if;

  begin
    update public.tags set library_id = p_library_id where id = p_tag_id returning * into v_target;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'status', 409, 'error', '이 태그는 이 세션의 다른 지점에 이미 연결되어 있습니다.');
  end;
  return jsonb_build_object('ok', true, 'tag', to_jsonb(v_target));
end;
$$;

-- 기능: 지점 하나의 고정 URL 목록 태그 연결 해제. 다른 세션·지점의 연결은 그대로 둔다
create function public.detach_library_tag(p_session_id text, p_tag_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tag public.tags%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('cp-library-binding'));
  select * into v_tag from public.tags
    where id = p_tag_id and session_id = p_session_id
    for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그를 찾을 수 없습니다.');
  end if;
  if v_tag.library_id is null then
    return jsonb_build_object('ok', true, 'detached', false, 'tag', to_jsonb(v_tag));
  end if;
  update public.tags set library_id = null where id = p_tag_id returning * into v_tag;
  return jsonb_build_object('ok', true, 'detached', true, 'tag', to_jsonb(v_tag));
end;
$$;

-- 변경: 고정 URL 태그를 모든 세션·지점에서 연결 해제한다. 연결이 없으면 released=false 로 성공
create or replace function public.release_library_static(p_library_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry public.tag_library%rowtype;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('cp-library-binding'));
  select * into v_entry from public.tag_library where id = p_library_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그 목록에서 태그를 찾을 수 없습니다.');
  end if;
  if v_entry.kind <> 'static' then
    return jsonb_build_object('ok', false, 'status', 400, 'error', '고정 URL 태그만 연결을 해제할 수 있습니다.');
  end if;

  perform 1 from public.tags where library_id = p_library_id order by id for no key update;
  perform 1 from public.tag_library where id = p_library_id for share;
  update public.tags set library_id = null where library_id = p_library_id;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'released', v_count > 0, 'count', v_count);
end;
$$;

-- 변경: 목록 태그 삭제. SUN 은 언제든, 고정 URL 은 어느 지점에도 연결되지 않았을 때만
create or replace function public.delete_library_entry(p_library_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry public.tag_library%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('cp-library-binding'));
  select * into v_entry from public.tag_library where id = p_library_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그 목록에서 태그를 찾을 수 없습니다.');
  end if;
  if v_entry.kind = 'static' and exists (select 1 from public.tags where library_id = p_library_id) then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error', '연결된 지점이 있는 태그는 삭제할 수 없습니다. 먼저 연결을 해제해 주세요.'
    );
  end if;
  delete from public.tag_library where id = p_library_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 변경: 목록 전체와 연결 상태. SUN·고정 URL 모두 bindings 목록 하나로 반환한다 (binding 단일 필드 제거)
create or replace function public.get_library()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object('entries', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'kind', l.kind, 'name', l.name, 'uid', l.uid, 'counter', l.ctr,
      'counterAt', l.ctr_at, 'token', l.token, 'createdAt', l.created_at,
      'bindings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'sessionId', s.id, 'sessionName', s.name, 'sessionStatus', s.status,
          'allowStaticUrl', s.allow_static_url,
          'tagId', t.id, 'tagName', t.name, 'order', t.position,
          'baselineCtr', case when l.kind = 'sun' then t.baseline_ctr else null end
        ) order by s.created_at desc, t.position, t.seq)
        from public.tags t
        join public.sessions s on s.id = t.session_id
        where (l.kind = 'sun' and t.uid <> '' and upper(t.uid) = upper(l.uid))
           or (l.kind = 'static' and t.library_id = l.id)
      ), '[]'::jsonb)
    ) order by l.created_at desc, l.seq)
    from public.tag_library l
  ), '[]'::jsonb));
$$;

-- 기능: 목록 태그로 지점을 만들어 경로 끝에 붙이고 같은 트랜잭션에서 연결한다 (준비 중·대기 세션만).
-- 이름은 목록 태그 이름, 순서·checkpoint_count 는 create_tag 규칙. 연결이 실패하면 savepoint 롤백으로 지점도 남지 않는다.
create function public.add_tag_from_library(
  p_session_id text,
  p_id text,
  p_token text,
  p_library_id text,
  p_hint text,
  p_next_hint text,
  p_location_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_entry public.tag_library%rowtype;
  v_other text;
  v_row jsonb;
  v_res jsonb;
  v_tag public.tags%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('cp-library-binding'));
  select status into v_status from public.sessions where id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '세션을 찾을 수 없습니다.');
  end if;
  if v_status in ('live', 'finished') then
    return jsonb_build_object('ok', false, 'status', 409, 'error', '진행 중이거나 종료된 세션은 경로를 바꿀 수 없습니다.');
  end if;
  select * into v_entry from public.tag_library where id = p_library_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그 목록에서 태그를 찾을 수 없습니다.');
  end if;

  -- 기능: 한 세션 경로에는 같은 목록 태그를 한 번만 쓴다 (고정 URL: library_id, SUN: UID)
  if v_entry.kind = 'static' then
    select name into v_other from public.tags
      where session_id = p_session_id and library_id = p_library_id limit 1;
    if found then
      return jsonb_build_object(
        'ok', false, 'status', 409,
        'error', format('이 태그는 이 세션의 "%s" 지점에 이미 연결되어 있습니다.', v_other)
      );
    end if;
  elsif exists (
    select 1 from public.tags
      where session_id = p_session_id and uid <> '' and upper(uid) = upper(v_entry.uid)
  ) then
    return jsonb_build_object('ok', false, 'status', 409, 'error', '이 세션의 다른 지점에 이미 등록된 태그입니다.');
  end if;

  begin
    v_row := public.create_tag(
      p_session_id, p_id, p_token, '', v_entry.name, null,
      coalesce(p_hint, ''), coalesce(p_next_hint, ''), coalesce(p_location_note, '')
    );
    if v_row ? 'retry' then
      return jsonb_build_object('retry', true);
    end if;
    if v_entry.kind = 'static' then
      update public.tags set library_id = v_entry.id where id = p_id returning * into v_tag;
    else
      -- 기능: SUN 은 목록 UID·카운터로 register_tag_sun 규칙 적용 (기준값 = 목록 카운터). 실패하면 지점 생성까지 되돌린다
      v_res := public.register_tag_sun(p_session_id, p_id, v_entry.uid, v_entry.ctr, false);
      if not coalesce((v_res ->> 'ok')::boolean, false) then
        raise exception using errcode = 'CPL01', message = v_res::text;
      end if;
      v_tag := jsonb_populate_record(null::public.tags, v_res -> 'tag');
    end if;
  exception
    when sqlstate 'CPL01' then
      return sqlerrm::jsonb;
    when unique_violation then
      return jsonb_build_object('ok', false, 'status', 409, 'error', '이 태그는 이 세션의 다른 지점에 이미 연결되어 있습니다.');
  end;
  return jsonb_build_object('ok', true, 'tag', to_jsonb(v_tag));
end;
$$;

-- 기능: 세션 경로 순서 변경. 현재 지점 id 전체를 순서대로 받아 position 을 1..n 으로 다시 쓴다 (준비 중·대기 세션만).
-- 잠근 뒤 비교하므로 동시에 삭제·추가된 지점이 있으면 400 으로 아무것도 바꾸지 않는다.
create function public.reorder_session_tags(p_session_id text, p_tag_ids text[])
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('cp-library-binding'));
  -- 기능: 세션 행은 상태 변경과만 직렬화한다 (NO KEY UPDATE 는 태깅 기록의 FK KEY SHARE 를 막지 않음)
  select status into v_status from public.sessions where id = p_session_id for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '세션을 찾을 수 없습니다.');
  end if;
  if v_status in ('live', 'finished') then
    return jsonb_build_object('ok', false, 'status', 409, 'error', '진행 중이거나 종료된 세션은 경로를 바꿀 수 없습니다.');
  end if;

  perform 1 from public.tags where session_id = p_session_id order by id for no key update;
  select count(*) into v_count from public.tags where session_id = p_session_id;
  if p_tag_ids is null
     or coalesce(array_length(p_tag_ids, 1), 0) <> v_count
     or (select count(distinct x) from unnest(p_tag_ids) as x) <> v_count
     or exists (
       select 1 from unnest(p_tag_ids) as x
         where not exists (select 1 from public.tags t where t.id = x and t.session_id = p_session_id)
     ) then
    return jsonb_build_object(
      'ok', false, 'status', 400,
      'error', '지점 목록이 현재 경로와 다릅니다. 새로고침 후 다시 시도해 주세요.'
    );
  end if;

  update public.tags t
    set position = x.ord::integer
    from unnest(p_tag_ids) with ordinality as x(id, ord)
    where t.id = x.id and t.session_id = p_session_id and t.position <> x.ord::integer;
  return jsonb_build_object('ok', true);
end;
$$;

-- 기능: /t 화면 분기용 고정 토큰 조회 (읽기 전용). 목록 고정 URL 토큰이면 연결된 세션·지점 목록,
-- 지점 자동 토큰이면 그 지점과 목록 태그 연결 여부, 둘 다 아니면 null
create function public.resolve_static_token(p_token text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'kind', 'library', 'name', l.name,
        'bindings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sessionId', s.id, 'sessionName', s.name, 'sessionStatus', s.status,
            'allowStaticUrl', s.allow_static_url,
            'tagId', t.id, 'tagName', t.name, 'order', t.position
          ) order by s.created_at desc, t.position, t.seq)
          from public.tags t
          join public.sessions s on s.id = t.session_id
          where t.library_id = l.id
        ), '[]'::jsonb)
      )
      from public.tag_library l
      where l.kind = 'static' and btrim(coalesce(p_token, '')) <> '' and lower(l.token) = lower(btrim(p_token))
    ),
    (
      select jsonb_build_object(
        'kind', 'checkpoint', 'tagName', t.name, 'order', t.position,
        'sessionId', s.id, 'sessionName', s.name, 'sessionStatus', s.status,
        'allowStaticUrl', s.allow_static_url,
        'attached', t.library_id is not null, 'libraryName', l.name
      )
      from public.tags t
      join public.sessions s on s.id = t.session_id
      left join public.tag_library l on l.id = t.library_id
      where btrim(coalesce(p_token, '')) <> '' and lower(t.token) = lower(btrim(p_token))
      order by t.seq
      limit 1
    )
  );
$$;

-- 기능: 앱 함수는 service_role 만 실행 가능 (새 함수와 바꾼 함수 모두)
revoke execute on function
  public.shared_library_schema(),
  public.record_static_tag(text, text, text),
  public.match_library_static(text, text, text, boolean),
  public.detach_library_tag(text, text),
  public.release_library_static(text),
  public.delete_library_entry(text),
  public.get_library(),
  public.add_tag_from_library(text, text, text, text, text, text, text),
  public.reorder_session_tags(text, text[]),
  public.resolve_static_token(text)
from public, anon, authenticated;

grant execute on function
  public.shared_library_schema(),
  public.record_static_tag(text, text, text),
  public.match_library_static(text, text, text, boolean),
  public.detach_library_tag(text, text),
  public.release_library_static(text),
  public.delete_library_entry(text),
  public.get_library(),
  public.add_tag_from_library(text, text, text, text, text, text, text),
  public.reorder_session_tags(text, text[]),
  public.resolve_static_token(text)
to service_role;
