-- 로컬 전용 시드 (supabase db reset 에서만 적용, db push 에는 포함되지 않음)
-- 기능: 검증용 DEMO01 데모 세션과 고정 토큰 4개 지점 생성
insert into public.sessions (id, name, description, code, status, checkpoint_count, award_ranks)
values (
  'DEMOSESS',
  '한강 워킹 챌린지',
  '여의도 일대를 걸으며 NFC 지점을 순서대로 태깅하세요.',
  'DEMO01',
  'ready',
  4,
  3
);

insert into public.tags (id, session_id, token, uid, name, position, hint, next_hint, location_note)
values
  ('DEMOTAG1', 'DEMOSESS', 'demo000001', '', '여의도 출발 게이트', 1,
   '출발 태그를 찍으면 레이스가 시작됩니다.', '국회의사당 정문 쪽으로 걸어가세요.', '여의도공원 문화의 마당'),
  ('DEMOTAG2', 'DEMOSESS', 'demo000002', '', '국회의사당', 2,
   '의사당 정문 안내판 옆 벤치에 태그가 있습니다.', '한강 방향으로 내려가 여의나루 나들목을 찾으세요.', '국회대로 1'),
  ('DEMOTAG3', 'DEMOSESS', 'demo000003', '', '여의나루', 3,
   '나들목 계단 옆 안내 봉에 태그가 붙어 있습니다.', '출발 게이트 옆 완주 부스로 돌아오세요.', '여의나루역 2번 출구 방면'),
  ('DEMOTAG4', 'DEMOSESS', 'demo000004', '', '완주 게이트', 4,
   '마지막 태그입니다. 찍는 순간 기록이 확정됩니다.', '시상식 안내를 기다려 주세요.', '여의도공원 문화의 마당');
