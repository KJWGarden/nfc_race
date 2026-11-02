-- 태그 목록 화면에서 연결 하나를 바로 해제하고, 삭제할 때 모든 연결을 해제한 뒤 삭제하는 함수.
-- 고정 URL 연결은 tags.library_id, SUN 연결은 같은 UID 가 등록된 지점(uid·기준값)이다.
-- 기존 함수(delete_library_entry, detach_library_tag, release_library_static)와 기존 마이그레이션은 바꾸지 않는다.

-- 기능: 목록 태그 연결 하나 해제 (고정 URL: library_id, SUN: uid·기준값). 잠금 후 이 항목에 연결돼 있는지 다시 확인한다.
-- 잠금 순서: 전역 advisory → tags(NO KEY UPDATE) → tag_library(SHARE). sun_counters·태깅 기록·목록 카운터는 그대로 둔다.
create function public.detach_library_binding(p_library_id text, p_tag_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry public.tag_library%rowtype;
  v_tag public.tags%rowtype;
  v_connected boolean;
begin
  perform pg_advisory_xact_lock(hashtext('cp-library-binding'));
  select * into v_entry from public.tag_library where id = p_library_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그 목록에서 태그를 찾을 수 없습니다.');
  end if;
  select * into v_tag from public.tags where id = p_tag_id for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그를 찾을 수 없습니다.');
  end if;
  perform 1 from public.tag_library where id = p_library_id for share;

  -- 기능: 오래된 화면·다른 항목의 지점으로 호출되면 아무것도 바꾸지 않는다
  if v_entry.kind = 'static' then
    v_connected := coalesce(v_tag.library_id = v_entry.id, false);
  else
    v_connected := v_tag.uid <> '' and upper(v_tag.uid) = upper(v_entry.uid);
  end if;
  if not v_connected then
    return jsonb_build_object(
      'ok', true, 'detached', false, 'kind', v_entry.kind, 'sessionId', v_tag.session_id, 'tagId', v_tag.id
    );
  end if;

  if v_entry.kind = 'static' then
    update public.tags set library_id = null where id = p_tag_id;
  else
    update public.tags set uid = '', baseline_ctr = null, baseline_at = null where id = p_tag_id;
  end if;
  return jsonb_build_object(
    'ok', true, 'detached', true, 'kind', v_entry.kind, 'sessionId', v_tag.session_id, 'tagId', v_tag.id
  );
end;
$$;

-- 기능: 목록 태그의 모든 연결을 해제한 뒤 삭제 (한 트랜잭션, 실패하면 해제도 되돌려진다).
-- 잠금 순서: 전역 advisory → tags(id 순, NO KEY UPDATE) → tag_library(UPDATE). 잠근 id 집합만 갱신한다.
create function public.delete_library_entry_detach_all(p_library_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry public.tag_library%rowtype;
  v_ids text[];
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('cp-library-binding'));
  select * into v_entry from public.tag_library where id = p_library_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', '태그 목록에서 태그를 찾을 수 없습니다.');
  end if;

  -- 기능: 연결된 지점(고정 URL: library_id, SUN: 모든 세션의 같은 UID)을 id 순으로 잠그고 id 를 모은다
  select coalesce(array_agg(s.id), '{}') into v_ids from (
    select t.id from public.tags t
      where (v_entry.kind = 'static' and t.library_id = v_entry.id)
         or (v_entry.kind = 'sun' and t.uid <> '' and upper(t.uid) = upper(v_entry.uid))
      order by t.id
      for no key update
  ) s;
  perform 1 from public.tag_library where id = p_library_id for update;

  if v_entry.kind = 'static' then
    update public.tags set library_id = null
      where id = any(v_ids) and library_id = v_entry.id;
  else
    update public.tags set uid = '', baseline_ctr = null, baseline_at = null
      where id = any(v_ids) and uid <> '' and upper(uid) = upper(v_entry.uid);
  end if;
  get diagnostics v_count = row_count;

  delete from public.tag_library where id = p_library_id;
  return jsonb_build_object('ok', true, 'detached', v_count);
end;
$$;

-- 기능: 앱 함수는 service_role 만 실행 가능
revoke execute on function
  public.detach_library_binding(text, text),
  public.delete_library_entry_detach_all(text)
from public, anon, authenticated;

grant execute on function
  public.detach_library_binding(text, text),
  public.delete_library_entry_detach_all(text)
to service_role;
