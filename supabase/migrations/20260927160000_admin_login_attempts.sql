-- 관리자 로그인 시도 제한. Vercel 서버리스 인스턴스끼리 공유되도록 카운터를 DB 에 둔다.

-- 기능: IP 별 현재 창의 시도 횟수와 잠금 만료 시각
create table public.admin_login_attempts (
  ip text primary key,
  attempts integer not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);

alter table public.admin_login_attempts enable row level security;
revoke all on table public.admin_login_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_login_attempts to service_role;

-- 기능: 비밀번호 확인 전에 시도를 한 번 센다. 행 잠금으로 동시 요청도 순서대로 세므로 창마다 최대 p_max 번만 비밀번호를 확인한다.
-- p_max 를 넘는 시도는 거부하고 그때부터 p_window 동안 잠근다. 잠금 중인 시도는 세지 않는다.
create function public.admin_login_attempt(
  p_ip text,
  p_max integer default 5,
  p_window interval default interval '15 minutes'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.admin_login_attempts%rowtype;
begin
  insert into public.admin_login_attempts (ip) values (p_ip) on conflict (ip) do nothing;
  select * into v from public.admin_login_attempts where ip = p_ip for update;

  if v.locked_until is not null and v.locked_until > now() then
    return jsonb_build_object(
      'allowed', false,
      'retryAfterSec', ceil(extract(epoch from v.locked_until - now()))::integer
    );
  end if;

  -- 기능: 잠금이 끝났거나 창이 지났으면 새 창에서 다시 센다
  if v.locked_until is not null or v.window_start <= now() - p_window then
    v.attempts := 0;
    v.window_start := now();
    v.locked_until := null;
  end if;

  v.attempts := v.attempts + 1;
  if v.attempts > p_max then
    v.locked_until := now() + p_window;
  end if;

  update public.admin_login_attempts
    set attempts = v.attempts, window_start = v.window_start, locked_until = v.locked_until
    where ip = p_ip;

  if v.locked_until is not null then
    return jsonb_build_object(
      'allowed', false,
      'retryAfterSec', ceil(extract(epoch from v.locked_until - now()))::integer
    );
  end if;
  return jsonb_build_object('allowed', true, 'attempts', v.attempts);
end;
$$;

-- 기능: 로그인 성공 시 그 IP 의 시도 기록을 지운다
create function public.admin_login_success(p_ip text)
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.admin_login_attempts where ip = p_ip;
$$;

-- 기능: 앱 함수는 service_role 만 실행 가능
revoke execute on function
  public.admin_login_attempt(text, integer, interval),
  public.admin_login_success(text)
from public, anon, authenticated;

grant execute on function
  public.admin_login_attempt(text, integer, interval),
  public.admin_login_success(text)
to service_role;
