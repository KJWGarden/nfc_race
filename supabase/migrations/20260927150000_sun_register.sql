-- SUN 태그 등록·기준 갱신과 관리자 모드 조회 함수.
-- 두 함수 모두 서버에서 SUN(복호화·MAC) 검증이 끝난 UID·카운터만 받는다. 키는 DB 에 저장하지 않는다.

-- 기능: 검증된 SUN 읽기로 지점에 물리 태그(UID)를 묶고 기준 카운터를 설정한다.
-- 같은 UID 는 기준값을 낮출 수 없고, 다른 UID 가 이미 묶인 지점은 p_replace 로 확인한 경우에만 교체한다.
create function public.register_tag_sun(
  p_session_id text,
  p_tag_id text,
  p_uid text,
  p_ctr integer,
  p_replace boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tag public.tags%rowtype;
  v_uid text := upper(btrim(coalesce(p_uid, '')));
begin
  select * into v_tag from public.tags
    where id = p_tag_id and session_id = p_session_id
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그를 찾을 수 없습니다.');
  end if;

  if exists (
    select 1 from public.tags
      where session_id = p_session_id and id <> p_tag_id and uid <> '' and upper(uid) = v_uid
  ) then
    return jsonb_build_object('ok', false, 'status', 409, 'error', '이 세션의 다른 지점에 이미 등록된 태그입니다.');
  end if;

  if v_tag.uid <> '' and upper(v_tag.uid) <> v_uid then
    -- 기능: 다른 태그가 묶인 지점은 관리자가 교체를 확인한 경우에만 다시 묶는다
    if not coalesce(p_replace, false) then
      return jsonb_build_object(
        'ok', false, 'status', 409, 'needsConfirm', true,
        'error', '이 지점에는 다른 태그가 등록되어 있습니다. 교체하려면 확인해 주세요.'
      );
    end if;
  elsif v_tag.baseline_ctr is not null and p_ctr < v_tag.baseline_ctr then
    -- 기능: 같은 태그의 기준값은 내려가지 않는다 (예전 URL 이 되살아나지 않도록)
    return jsonb_build_object('ok', false, 'status', 409, 'error', '더 최근에 읽은 태그 URL로 갱신해 주세요.');
  end if;

  begin
    update public.tags
      set uid = v_uid, baseline_ctr = p_ctr, baseline_at = now()
      where id = v_tag.id
      returning * into v_tag;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'status', 409, 'error', '이 세션의 다른 지점에 이미 등록된 태그입니다.');
  end;
  return jsonb_build_object('ok', true, 'tag', to_jsonb(v_tag));
end;
$$;

-- 기능: 관리자 모드(/t)용 조회. 이 UID 가 묶인 지점들과, 등록 대상으로 고를 수 있는 종료 전 세션·지점 목록을 한 번에 반환한다.
create function public.get_sun_admin_context(p_uid text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'bindings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sessionId', s.id, 'sessionName', s.name, 'sessionStatus', s.status,
        'tagId', t.id, 'tagName', t.name, 'order', t.position,
        'baselineCtr', t.baseline_ctr, 'baselineAt', t.baseline_at
      ) order by s.created_at desc, t.position, t.seq)
      from public.tags t
      join public.sessions s on s.id = t.session_id
      where t.uid <> '' and upper(t.uid) = upper(btrim(p_uid))
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'status', s.status,
        'tags', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id, 'name', t.name, 'order', t.position, 'uid', t.uid,
            'baselineCtr', t.baseline_ctr
          ) order by t.position, t.seq)
          from public.tags t where t.session_id = s.id
        ), '[]'::jsonb)
      ) order by s.created_at desc, s.seq)
      from public.sessions s
      where s.status <> 'finished'
    ), '[]'::jsonb)
  );
$$;

-- 기능: 앱 함수는 service_role 만 실행 가능
revoke execute on function
  public.register_tag_sun(text, text, text, integer, boolean),
  public.get_sun_admin_context(text)
from public, anon, authenticated;

grant execute on function
  public.register_tag_sun(text, text, text, integer, boolean),
  public.get_sun_admin_context(text)
to service_role;
