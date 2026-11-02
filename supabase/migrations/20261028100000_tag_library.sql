-- 태그 목록(세션과 무관하게 미리 등록해 두는 물리 태그)과 지점 연결 함수.
-- SUN 태그는 서버에서 검증된 UID·카운터로만 등록하고, 고정 URL 태그는 앱이 발급한 토큰으로 등록한다.
-- 고정 URL 태그를 지점에 연결하면 지점의 원래 토큰은 tags.original_token 에 보관했다가 연결 해제 시 복원한다.

-- 기능: 연결 중 보관하는 지점의 원래 자동 발급 토큰 (기존 행은 모두 null)
alter table public.tags add column original_token text;
create unique index tags_original_token_key on public.tags (lower(original_token)) where original_token is not null;

-- 기능: 태그 목록. kind 별로 필요한 컬럼이 다르다 (sun: uid·ctr, static: token·bound_tag_id).
-- 연결된 지점이 삭제되면 연결만 풀린다 (on delete set null). tags 와 달리 session_id 가 없으므로 admin 알림 트리거는 두지 않는다.
create table public.tag_library (
  seq bigint generated always as identity,
  id text primary key,
  kind text not null check (kind in ('sun', 'static')),
  name text not null check (btrim(name) <> ''),
  uid text check (uid = upper(uid)),
  ctr integer check (ctr between 0 and 16777215),
  ctr_at timestamptz,
  token text,
  bound_tag_id text references public.tags (id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    (kind = 'sun' and uid is not null and ctr is not null and token is null and bound_tag_id is null)
    or (kind = 'static' and token is not null and uid is null and ctr is null)
  )
);
create unique index tag_library_sun_uid_key on public.tag_library (upper(uid)) where kind = 'sun';
create unique index tag_library_token_key on public.tag_library (lower(token)) where token is not null;
create unique index tag_library_bound_tag_key on public.tag_library (bound_tag_id) where bound_tag_id is not null;

alter table public.tag_library enable row level security;
revoke all on table public.tag_library from public, anon, authenticated;
grant select, insert, update, delete on table public.tag_library to service_role;

-- 기능: 토큰 유일성 보호. 새 토큰이 다른 지점의 보관 토큰이나 이 지점에 연결되지 않은 목록 토큰과 같으면 unique_violation.
-- 같은 값을 동시에 쓰는 트랜잭션은 토큰별 advisory lock 으로 직렬화한다 (현재 토큰과 보관할 토큰 모두, hash 오름차순).
-- create_tag 는 unique_violation 을 {retry:true} 로 바꾸므로 수정하지 않는다.
create function public.tags_token_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_token text := lower(new.token);
  v_saved text := lower(new.original_token);
begin
  if v_saved is null or v_saved = v_token then
    perform pg_advisory_xact_lock(hashtext('cp-token:' || v_token));
  elsif hashtext('cp-token:' || v_token) <= hashtext('cp-token:' || v_saved) then
    perform pg_advisory_xact_lock(hashtext('cp-token:' || v_token));
    perform pg_advisory_xact_lock(hashtext('cp-token:' || v_saved));
  else
    perform pg_advisory_xact_lock(hashtext('cp-token:' || v_saved));
    perform pg_advisory_xact_lock(hashtext('cp-token:' || v_token));
  end if;

  if exists (
    select 1 from public.tags where id <> new.id and lower(original_token) = v_token
  ) then
    raise exception 'token is saved as the original of another checkpoint' using errcode = 'unique_violation';
  end if;
  if exists (
    select 1 from public.tag_library
      where lower(token) = v_token and bound_tag_id is distinct from new.id
  ) then
    raise exception 'token belongs to a library tag' using errcode = 'unique_violation';
  end if;

  -- 기능: 보관할 토큰이 새로 정해질 때는 다른 곳에서 쓰이지 않는 값이어야 한다
  if v_saved is not null and (tg_op = 'INSERT' or old.original_token is distinct from new.original_token) then
    if exists (
      select 1 from public.tags
        where id <> new.id and (lower(token) = v_saved or lower(original_token) = v_saved)
    ) or exists (
      select 1 from public.tag_library where lower(token) = v_saved
    ) then
      raise exception 'saved original token is already in use' using errcode = 'unique_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger tags_token_guard before insert or update of token, original_token on public.tags
  for each row execute function public.tags_token_guard();

-- 기능: SUN 태그를 UID 기준으로 목록에 추가하거나 갱신한다. 카운터는 내려가지 않고, 이름은 p_rename 일 때만 바꾼다.
-- sun_counters 는 건드리지 않는다.
create function public.upsert_library_sun(
  p_id text,
  p_uid text,
  p_ctr integer,
  p_name text,
  p_rename boolean
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  insert into public.tag_library as l (id, kind, name, uid, ctr, ctr_at)
    values (p_id, 'sun', btrim(p_name), upper(btrim(p_uid)), p_ctr, now())
  on conflict (upper(uid)) where kind = 'sun' do update set
    name = case when coalesce(p_rename, false) then excluded.name else l.name end,
    ctr = greatest(l.ctr, excluded.ctr),
    ctr_at = case when excluded.ctr > l.ctr then now() else l.ctr_at end
  returning jsonb_build_object(
    'id', l.id, 'kind', l.kind, 'name', l.name, 'uid', l.uid, 'counter', l.ctr,
    'counterAt', l.ctr_at, 'token', l.token, 'createdAt', l.created_at
  );
$$;

-- 기능: 고정 URL 태그 발급. 토큰이 tags.token / tags.original_token / 목록 토큰 어디에든 있으면 {retry:true}
create function public.issue_library_static(p_id text, p_name text, p_token text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_token text := lower(btrim(p_token));
  v_row public.tag_library%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('cp-token:' || v_token));
  if exists (select 1 from public.tags where lower(token) = v_token or lower(original_token) = v_token)
     or exists (select 1 from public.tag_library where lower(token) = v_token) then
    return jsonb_build_object('retry', true);
  end if;
  begin
    insert into public.tag_library (id, kind, name, token)
      values (p_id, 'static', btrim(p_name), v_token)
      returning * into v_row;
  exception when unique_violation then
    return jsonb_build_object('retry', true);
  end;
  return jsonb_build_object(
    'id', v_row.id, 'kind', v_row.kind, 'name', v_row.name, 'uid', v_row.uid, 'counter', v_row.ctr,
    'counterAt', v_row.ctr_at, 'token', v_row.token, 'createdAt', v_row.created_at
  );
end;
$$;

-- 기능: 목록 태그를 지점에 연결. SUN 은 목록의 UID·카운터로 register_tag_sun 규칙을 그대로 적용하고,
-- 고정 URL 은 match_library_static 으로 넘긴다. 잠금 순서 때문에 목록 행은 잠그지 않고 읽기만 한다.
create function public.match_library(
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
begin
  select * into v_entry from public.tag_library where id = p_library_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그 목록에서 태그를 찾을 수 없습니다.');
  end if;
  if v_entry.kind = 'static' then
    return public.match_library_static(p_session_id, p_tag_id, p_library_id, p_replace);
  end if;
  return public.register_tag_sun(p_session_id, p_tag_id, v_entry.uid, v_entry.ctr, p_replace);
end;
$$;

-- 기능: 고정 URL 태그를 지점에 연결. 잠금 순서는 전역 advisory → tags(id 순) → tag_library(id 순) → 토큰별 advisory(트리거).
-- 이전 지점은 원래 토큰을 복원하고, 대상 지점의 자동 토큰은 original_token 에 보관한다.
-- tag_library.bound_tag_id 를 먼저 바꿔야 트리거가 대상 지점의 목록 토큰 사용을 허용한다.
create function public.match_library_static(
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
  v_prev_id text;
  v_prev_tag text;
  v_prev_session text;
begin
  perform pg_advisory_xact_lock(hashtext('cp-library-binding'));
  select * into v_entry from public.tag_library where id = p_library_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그 목록에서 태그를 찾을 수 없습니다.');
  end if;
  if v_entry.kind <> 'static' then
    return jsonb_build_object('ok', false, 'status', 400, 'error', '고정 URL 태그가 아닙니다.');
  end if;

  -- 기능: tags 행을 id 순으로 잠근 뒤 목록 행을 id 순으로 잠그고 연결 상태를 다시 읽는다
  perform 1 from public.tags where id in (p_tag_id, v_entry.bound_tag_id) order by id for update;
  select * into v_target from public.tags where id = p_tag_id and session_id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그를 찾을 수 없습니다.');
  end if;
  perform 1 from public.tag_library where id = p_library_id or bound_tag_id = p_tag_id order by id for update;
  select * into v_entry from public.tag_library where id = p_library_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그 목록에서 태그를 찾을 수 없습니다.');
  end if;
  v_prev_id := v_entry.bound_tag_id;

  if v_prev_id = p_tag_id then
    return jsonb_build_object('ok', true, 'tag', to_jsonb(v_target));
  end if;

  if v_prev_id is not null and not coalesce(p_replace, false) then
    select t.name, s.name into v_prev_tag, v_prev_session
      from public.tags t join public.sessions s on s.id = t.session_id
      where t.id = v_prev_id;
    return jsonb_build_object(
      'ok', false, 'status', 409, 'needsConfirm', true,
      'error', format('이 태그는 "%s" 세션의 "%s" 지점에 연결되어 있습니다. 이동하려면 확인해 주세요.', v_prev_session, v_prev_tag)
    );
  end if;

  begin
    -- 기능: 대상 지점에 연결된 다른 목록 태그 해제 → 이 태그 연결 → 이전 지점 복원 → 대상 지점 토큰 교체
    update public.tag_library set bound_tag_id = null where bound_tag_id = p_tag_id;
    update public.tag_library set bound_tag_id = p_tag_id where id = p_library_id;
    if v_prev_id is not null then
      update public.tags set token = original_token, original_token = null
        where id = v_prev_id and original_token is not null;
    end if;
    update public.tags
      set original_token = coalesce(original_token, token), token = v_entry.token
      where id = p_tag_id
      returning * into v_target;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'status', 409, 'error', '태그 토큰이 충돌했습니다. 다시 시도해 주세요.');
  end;
  return jsonb_build_object('ok', true, 'tag', to_jsonb(v_target));
end;
$$;

-- 기능: 고정 URL 태그 연결 해제. 지점의 원래 토큰을 복원하고 연결을 푼다. 연결되지 않은 태그는 released=false 로 성공한다.
create function public.release_library_static(p_library_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry public.tag_library%rowtype;
  v_tag public.tags%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('cp-library-binding'));
  select * into v_entry from public.tag_library where id = p_library_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그 목록에서 태그를 찾을 수 없습니다.');
  end if;
  if v_entry.kind <> 'static' then
    return jsonb_build_object('ok', false, 'status', 400, 'error', '고정 URL 태그만 연결을 해제할 수 있습니다.');
  end if;
  if v_entry.bound_tag_id is null then
    return jsonb_build_object('ok', true, 'released', false);
  end if;

  perform 1 from public.tags where id = v_entry.bound_tag_id for update;
  perform 1 from public.tag_library where id = p_library_id for update;
  select * into v_entry from public.tag_library where id = p_library_id;
  if v_entry.bound_tag_id is null then
    return jsonb_build_object('ok', true, 'released', false);
  end if;

  begin
    update public.tags set token = original_token, original_token = null
      where id = v_entry.bound_tag_id and original_token is not null
      returning * into v_tag;
    if not found then
      return jsonb_build_object('ok', false, 'status', 409, 'error', '복원할 원래 URL을 찾을 수 없습니다.');
    end if;
    update public.tag_library set bound_tag_id = null where id = p_library_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'status', 409, 'error', '태그 토큰이 충돌했습니다. 다시 시도해 주세요.');
  end;
  return jsonb_build_object('ok', true, 'released', true, 'tag', to_jsonb(v_tag));
end;
$$;

-- 기능: 목록 태그 삭제. SUN 은 언제든(지점 연결은 바뀌지 않음), 고정 URL 은 지점에 연결되지 않았을 때만.
create function public.delete_library_entry(p_library_id text)
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
  if v_entry.bound_tag_id is not null then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error', '연결된 지점이 있는 태그는 삭제할 수 없습니다. 먼저 연결을 해제해 주세요.'
    );
  end if;
  delete from public.tag_library where id = p_library_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 기능: 목록 전체와 현재 연결 상태를 jsonb 하나로 반환 (max_rows 제한을 피하기 위해)
create function public.get_library()
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
      'bindings', case when l.kind = 'sun' then coalesce((
        select jsonb_agg(jsonb_build_object(
          'sessionId', s.id, 'sessionName', s.name, 'sessionStatus', s.status,
          'tagId', t.id, 'tagName', t.name, 'order', t.position, 'baselineCtr', t.baseline_ctr
        ) order by s.created_at desc, t.position, t.seq)
        from public.tags t
        join public.sessions s on s.id = t.session_id
        where t.uid <> '' and upper(t.uid) = upper(l.uid)
      ), '[]'::jsonb) else '[]'::jsonb end,
      'binding', (
        select jsonb_build_object(
          'sessionId', s.id, 'sessionName', s.name, 'sessionStatus', s.status,
          'allowStaticUrl', s.allow_static_url,
          'tagId', t.id, 'tagName', t.name, 'order', t.position
        )
        from public.tags t
        join public.sessions s on s.id = t.session_id
        where t.id = l.bound_tag_id
      )
    ) order by l.created_at desc, l.seq)
    from public.tag_library l
  ), '[]'::jsonb));
$$;

-- 기능: 관리자 모드(/t) 조회용. UID 가 목록에 있으면 id·이름·카운터만 반환한다.
create function public.get_library_entry_by_uid(p_uid text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object('id', l.id, 'name', l.name, 'counter', l.ctr)
    from public.tag_library l
    where l.kind = 'sun' and upper(l.uid) = upper(btrim(p_uid));
$$;

-- 기능: 앱 함수는 service_role 만 실행 가능
revoke execute on function
  public.tags_token_guard(),
  public.upsert_library_sun(text, text, integer, text, boolean),
  public.issue_library_static(text, text, text),
  public.match_library(text, text, text, boolean),
  public.match_library_static(text, text, text, boolean),
  public.release_library_static(text),
  public.delete_library_entry(text),
  public.get_library(),
  public.get_library_entry_by_uid(text)
from public, anon, authenticated;

grant execute on function
  public.upsert_library_sun(text, text, integer, text, boolean),
  public.issue_library_static(text, text, text),
  public.match_library(text, text, text, boolean),
  public.match_library_static(text, text, text, boolean),
  public.release_library_static(text),
  public.delete_library_entry(text),
  public.get_library(),
  public.get_library_entry_by_uid(text)
to service_role;
