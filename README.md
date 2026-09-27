# CHECKPOINT — NFC 워킹 레이스

걸어서 정해진 지점마다 NFC를 태깅하고, 참가 팀 순위로 시상하는 운영/참가 앱입니다.

관리자 뷰와 참가자 뷰가 분리되어 있습니다. 참가자는 자기 팀 현황만 볼 수 있습니다.

## 실행

```bash
cd ~/dev/nfc-walk-race
npm install
npm run dev
```

- 참가자: [http://localhost:3000](http://localhost:3000)
- 관리자: [http://localhost:3000/admin/login](http://localhost:3000/admin/login)
- 기본 비밀번호: `admin123` (`ADMIN_PASSWORD`)
- 데모 세션 코드: `DEMO01`

실기기 NFC는 HTTPS(또는 localhost)와 같은 네트워크 주소가 필요합니다.

## 역할

### 관리자
- 참가 세션 CRUD, 지점 수/시상 순위 수 지정
- 세션별 참가자 명단, 실시간 현황, 순위, 완주 시간
- 초대 링크/QR
- NFC 태그 생성·목록·유효성 기준, 물리 UID 등록, NFC 쓰기
- 실시간 공지
- 시상 화면 CTA (`시상 화면 띄우기`)

### 참가자
- 세션 코드 또는 QR로 참가
- 팀장이 팀 생성 → 팀 코드로 팀원 참가
- 우리 팀 레이스만 표시 (다른 팀 현황 비공개)
- 관리자 공지 배너 + 새 공지 알림
- NFC 태깅 후 다음 목적지 안내

## NFC 운용

1. 관리자 NFC 탭에서 지점을 순서대로 생성합니다.
2. 각 지점 QR을 출력하거나, Android Chrome에서 `NFC에 쓰기`로 URL을 기록합니다.
3. 태그에 기록되는 값은 `/t/{token}` URL입니다. iPhone은 태그 접촉 시 브라우저가 열립니다.
4. 데스크톱/테스트는 레이스 화면의 태그 코드 입력으로 시뮬레이션합니다.

데이터는 `data/db.json`에 저장됩니다. 별도 DB 없이 로컬에서 바로 운영할 수 있습니다.
