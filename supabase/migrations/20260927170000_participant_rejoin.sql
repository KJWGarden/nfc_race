-- 참가자 재입장. 팀 안에서 정규화한 이름이 겹치지 않게 막고, 세션 코드 + 팀 코드 + 이름으로 기존 참가자를 찾는다.

-- 기능: 이름 정규화 (공백 연속을 한 칸으로, 앞뒤 공백 제거, 영문 대소문자 무시). 인덱스와 조회가 같은 함수를 쓴다.
create function public.normalize_name(p_name text)
returns text
language sql
immutable
strict
parallel safe
set search_path = public
as $$
  select lower(btrim(regexp_replace(p_name, '\s+', ' ', 'g')));
$$;

-- 기능: 같은 팀 안에서 정규화 이름 중복 금지 (동시 참가도 인덱스에서 한 건만 통과)
create unique index participants_team_name_uniq
  on public.participants (team_id, public.normalize_name(name))
  where team_id is not null;

-- 변경: 팀 참가 시 같은 이름의 팀원이 있으면 '다시 들어가기' 안내 오류로 돌려준다 (인덱스 위반을 제약 이름으로 구분)
create or replace function public.join_team(p_participant_id text, p_join_code text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_participant public.participants%rowtype;
  v_team public.teams%rowtype;
  v_constraint text;
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
  begin
    update public.participants set team_id = v_team.id, is_leader = false
      where id = v_participant.id
      returning * into v_participant;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'participants_team_name_uniq' then
      return jsonb_build_object(
        'ok', false,
        'error', '같은 이름의 팀원이 이미 있습니다. 쿠키를 잃었다면 ''다시 들어가기''를 이용해 주세요.'
      );
    end if;
    raise;
  end;
  return jsonb_build_object('ok', true, 'team', to_jsonb(v_team), 'participant', to_jsonb(v_participant));
end;
$$;

-- 기능: 재입장 대상 조회. 세션·팀·이름 중 무엇이 틀렸는지는 구분하지 않고 not_found 하나로 돌려준다.
-- 세션 상태와 무관하게 조회한다 (종료된 세션도 결과 확인용으로 재입장 가능).
create function public.rejoin_lookup(p_code text, p_join_code text, p_name text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_ids text[];
begin
  select coalesce(array_agg(p.id), '{}') into v_ids
    from public.sessions s
    join public.teams t on t.session_id = s.id and t.join_code = upper(btrim(p_join_code))
    join public.participants p on p.team_id = t.id
    where s.code = upper(btrim(p_code))
      and public.normalize_name(p.name) = public.normalize_name(p_name);
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('error', 'not_found');
  end if;
  if cardinality(v_ids) > 1 then
    return jsonb_build_object('error', 'ambiguous');
  end if;
  return jsonb_build_object('participantId', v_ids[1]);
end;
$$;

-- 기능: 앱 함수는 service_role 만 실행 가능 (join_team 은 create or replace 로 기존 권한 유지, 명시적으로 다시 지정)
revoke execute on function
  public.normalize_name(text),
  public.join_team(text, text),
  public.rejoin_lookup(text, text, text)
from public, anon, authenticated;

grant execute on function
  public.normalize_name(text),
  public.join_team(text, text),
  public.rejoin_lookup(text, text, text)
to service_role;
