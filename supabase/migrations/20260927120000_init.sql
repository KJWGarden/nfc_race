-- CHECKPOINT 초기 스키마: data/db.json(DbShape)을 대체하는 테이블과 원자적 RPC 함수.
-- 서버는 service_role 키로만 접근한다. anon/authenticated 에는 테이블·함수 권한을 주지 않는다.
-- 모든 테이블의 seq 는 기존 배열 삽입 순서를 재현하기 위한 정렬 보조 컬럼이다.

-- 기능: 세션 (코드는 대문자, 전역 유일)
create table public.sessions (
  seq bigint generated always as identity,
  id text primary key,
  name text not null,
  description text not null default '',
  code text not null unique check (code = upper(code)),
  status text not null default 'draft' check (status in ('draft', 'ready', 'live', 'finished')),
  checkpoint_count integer not null check (checkpoint_count >= 1),
  award_ranks integer not null check (award_ranks >= 1),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- 기능: NFC 지점. position 은 앱의 order 필드에 대응한다 (order 는 예약어).
create table public.tags (
  seq bigint generated always as identity,
  id text primary key,
  session_id text not null references public.sessions (id) on delete cascade,
  token text not null,
  uid text not null default '',
  name text not null,
  position integer not null,
  hint text not null default '',
  next_hint text not null default '',
  location_note text not null default '',
  created_at timestamptz not null default now()
);
create unique index tags_token_key on public.tags (lower(token));
create index tags_session_position_idx on public.tags (session_id, position);

-- 기능: 팀. leader_id 는 순환 cascade 를 피하려고 FK 를 두지 않는다.
create table public.teams (
  seq bigint generated always as identity,
  id text primary key,
  session_id text not null references public.sessions (id) on delete cascade,
  name text not null,
  join_code text not null,
  leader_id text not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (session_id, join_code)
);
create index teams_session_idx on public.teams (session_id);

create table public.participants (
  seq bigint generated always as identity,
  id text primary key,
  session_id text not null references public.sessions (id) on delete cascade,
  team_id text references public.teams (id) on delete cascade,
  name text not null,
  is_leader boolean not null default false,
  created_at timestamptz not null default now()
);
create index participants_session_idx on public.participants (session_id);
create index participants_team_idx on public.participants (team_id);

-- 기능: 태깅 기록. 미등록 태그 이벤트는 tag_id 가 null 이다 (앱에서는 "").
create table public.tag_events (
  seq bigint generated always as identity,
  id text primary key,
  session_id text not null references public.sessions (id) on delete cascade,
  team_id text not null references public.teams (id) on delete cascade,
  participant_id text not null references public.participants (id) on delete cascade,
  tag_id text references public.tags (id) on delete cascade,
  tagged_at timestamptz not null default clock_timestamp(),
  valid boolean not null,
  reason text not null
);
create index tag_events_session_idx on public.tag_events (session_id);
create index tag_events_team_idx on public.tag_events (team_id);
-- 기능: 팀+지점당 유효 기록은 하나뿐 (동시 요청 방어선)
create unique index tag_events_one_valid on public.tag_events (team_id, tag_id) where valid;

create table public.announcements (
  seq bigint generated always as identity,
  id text primary key,
  session_id text not null references public.sessions (id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  pinned boolean not null default true
);
create index announcements_session_created_idx on public.announcements (session_id, created_at desc);

-- 기능: 모든 앱 테이블 RLS 활성화, anon/authenticated 정책 없음
alter table public.sessions enable row level security;
alter table public.tags enable row level security;
alter table public.teams enable row level security;
alter table public.participants enable row level security;
alter table public.tag_events enable row level security;
alter table public.announcements enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- 기능: race.ts requiredCheckpoints 와 동일한 필요 지점 수 계산
create function public.required_checkpoints(p_session_id text)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when count(t.id) = 0 then s.checkpoint_count
    else least(s.checkpoint_count, count(t.id)::integer)
  end
  from public.sessions s
  left join public.tags t on t.session_id = s.id
  where s.id = p_session_id
  group by s.id, s.checkpoint_count;
$$;

-- 기능: 태깅 기록을 한 트랜잭션에서 처리. 팀 행 잠금으로 동시 요청을 직렬화하고
-- race.ts validateTagAttempt 와 같은 순서·문구로 검증한다.
create function public.record_tag(
  p_participant_id text,
  p_token text,
  p_uid text,
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
  v_found boolean := false;
  v_token text := nullif(lower(btrim(coalesce(p_token, ''))), '');
  v_uid text := nullif(lower(btrim(coalesce(p_uid, ''))), '');
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

  -- 기능: findTagByPayload 와 동일하게 토큰 우선, 그다음 UID (대소문자 무시)
  if v_token is not null then
    select * into v_tag from public.tags
      where session_id = v_session.id and lower(token) = v_token
      order by seq limit 1;
    v_found := found;
  end if;
  if not v_found and v_uid is not null then
    select * into v_tag from public.tags
      where session_id = v_session.id and uid <> '' and lower(uid) = v_uid
      order by seq limit 1;
    v_found := found;
  end if;

  if not v_found then
    insert into public.tag_events (id, session_id, team_id, participant_id, tag_id, valid, reason)
      values (p_event_id, v_session.id, v_team.id, v_participant.id, null, false, '등록되지 않은 NFC 태그입니다.')
      returning * into v_event;
    return jsonb_build_object('ok', false, 'error', v_event.reason, 'event', to_jsonb(v_event));
  end if;

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

  -- 기능: 유효 태깅이면 팀 시작 시각을 채우고 필요 지점 수에 도달하면 완주 처리
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

  -- 기능: 같은 트랜잭션에서 갱신된 참가자 화면 데이터를 함께 반환 (추가 왕복 없음)
  return jsonb_build_object(
    'ok', true, 'event', to_jsonb(v_event), 'tag', to_jsonb(v_tag),
    'race', public.get_team_race_data(v_participant.id)
  );
end;
$$;

-- 기능: 팀 생성과 참가자 소속 변경을 한 트랜잭션으로 처리. 팀 코드 충돌 시 retry 신호를 반환한다.
create function public.create_team(
  p_participant_id text,
  p_team_id text,
  p_name text,
  p_join_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_participant public.participants%rowtype;
  v_team public.teams%rowtype;
begin
  select * into v_participant from public.participants where id = p_participant_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', '참가자를 찾을 수 없습니다.');
  end if;
  if v_participant.team_id is not null then
    return jsonb_build_object('ok', false, 'error', '이미 팀에 속해 있습니다.');
  end if;
  begin
    insert into public.teams (id, session_id, name, join_code, leader_id)
      values (p_team_id, v_participant.session_id, btrim(p_name), p_join_code, v_participant.id)
      returning * into v_team;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'retry', true);
  end;
  update public.participants set team_id = v_team.id, is_leader = true
    where id = v_participant.id
    returning * into v_participant;
  return jsonb_build_object('ok', true, 'team', to_jsonb(v_team), 'participant', to_jsonb(v_participant));
end;
$$;

-- 기능: 팀 코드로 팀 참가 (참가자 행 잠금으로 중복 소속 방지)
create function public.join_team(p_participant_id text, p_join_code text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_participant public.participants%rowtype;
  v_team public.teams%rowtype;
begin
  select * into v_participant from public.participants where id = p_participant_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', '참가자를 찾을 수 없습니다.');
  end if;
  if v_participant.team_id is not null then
    return jsonb_build_object('ok', false, 'error', '이미 팀에 속해 있습니다.');
  end if;
  select * into v_team from public.teams
    where session_id = v_participant.session_id and join_code = upper(btrim(p_join_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', '팀 코드를 찾을 수 없습니다.');
  end if;
  update public.participants set team_id = v_team.id, is_leader = false
    where id = v_participant.id
    returning * into v_participant;
  return jsonb_build_object('ok', true, 'team', to_jsonb(v_team), 'participant', to_jsonb(v_participant));
end;
$$;

-- 기능: 기존 공지 고정 해제 후 새 공지를 고정 상태로 추가
create function public.create_announcement(p_session_id text, p_id text, p_message text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.announcements%rowtype;
begin
  perform 1 from public.sessions where id = p_session_id for update;
  if not found then
    return null;
  end if;
  update public.announcements set pinned = false where session_id = p_session_id and pinned;
  insert into public.announcements (id, session_id, message, pinned)
    values (p_id, p_session_id, btrim(p_message), true)
    returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- 기능: 지점 추가. 순서 미지정이면 마지막+1, 지점 수가 checkpoint_count 를 넘으면 함께 올린다.
create function public.create_tag(
  p_session_id text,
  p_id text,
  p_token text,
  p_uid text,
  p_name text,
  p_position integer,
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
  v_row public.tags%rowtype;
  v_count integer;
begin
  perform 1 from public.sessions where id = p_session_id for update;
  if not found then
    return null;
  end if;
  begin
    insert into public.tags (id, session_id, token, uid, name, position, hint, next_hint, location_note)
      values (
        p_id, p_session_id, p_token, btrim(coalesce(p_uid, '')), btrim(p_name),
        coalesce(
          p_position,
          (select position from public.tags where session_id = p_session_id
             order by position desc, seq desc limit 1) + 1,
          1
        ),
        btrim(p_hint), btrim(p_next_hint), btrim(p_location_note)
      )
      returning * into v_row;
  exception when unique_violation then
    return jsonb_build_object('retry', true);
  end;
  select count(*) into v_count from public.tags where session_id = p_session_id;
  update public.sessions set checkpoint_count = v_count
    where id = p_session_id and checkpoint_count < v_count;
  return to_jsonb(v_row);
end;
$$;

-- 기능: 참가자 화면용 원본 행을 한 번에 반환 (max_rows 제한을 피하기 위해 jsonb 하나로 묶음)
create function public.get_team_race_data(p_participant_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'participant', to_jsonb(p),
    'session', to_jsonb(s),
    'team', to_jsonb(tm),
    'members', case
      when tm.id is null then jsonb_build_array(to_jsonb(p))
      else coalesce((select jsonb_agg(to_jsonb(m) order by m.seq)
                       from public.participants m where m.team_id = tm.id), '[]'::jsonb)
    end,
    'tags', coalesce((select jsonb_agg(to_jsonb(t) order by t.seq)
                        from public.tags t where t.session_id = s.id), '[]'::jsonb),
    'events', case
      when tm.id is null then '[]'::jsonb
      else coalesce((select jsonb_agg(to_jsonb(e) order by e.seq)
                       from public.tag_events e where e.team_id = tm.id), '[]'::jsonb)
    end,
    'announcements', coalesce((select jsonb_agg(to_jsonb(a) order by a.seq)
                                 from public.announcements a
                                 where a.session_id = s.id and a.pinned), '[]'::jsonb)
  )
  from public.participants p
  join public.sessions s on s.id = p.session_id
  left join public.teams tm on tm.id = p.team_id
  where p.id = p_participant_id;
$$;

-- 기능: 관리자 라이브 화면용 세션 전체 원본 행을 한 번에 반환
create function public.get_admin_live_data(p_session_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'session', to_jsonb(s),
    'tags', coalesce((select jsonb_agg(to_jsonb(t) order by t.seq)
                        from public.tags t where t.session_id = s.id), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(to_jsonb(tm) order by tm.seq)
                         from public.teams tm where tm.session_id = s.id), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(to_jsonb(p) order by p.seq)
                                from public.participants p where p.session_id = s.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.seq)
                          from public.tag_events e where e.session_id = s.id), '[]'::jsonb),
    'announcements', coalesce((select jsonb_agg(to_jsonb(a) order by a.seq)
                                 from public.announcements a where a.session_id = s.id), '[]'::jsonb)
  )
  from public.sessions s
  where s.id = p_session_id;
$$;

-- 기능: 앱 함수는 service_role 만 실행 가능
revoke execute on function
  public.required_checkpoints(text),
  public.record_tag(text, text, text, text),
  public.create_team(text, text, text, text),
  public.join_team(text, text),
  public.create_announcement(text, text, text),
  public.create_tag(text, text, text, text, text, integer, text, text, text),
  public.get_team_race_data(text),
  public.get_admin_live_data(text)
from public, anon, authenticated;

grant execute on function
  public.required_checkpoints(text),
  public.record_tag(text, text, text, text),
  public.create_team(text, text, text, text),
  public.join_team(text, text),
  public.create_announcement(text, text, text),
  public.create_tag(text, text, text, text, text, integer, text, text, text),
  public.get_team_race_data(text),
  public.get_admin_live_data(text)
to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
