# CJU QA Automation 진행 기록

## 목표와 현재 상태
첫 납품: Sites에서 개발 ALL 예약을 요청하고 사내 실행기가 주문 생성·완료·재조회 검증을 수행한다. 발권 이후 기능은 아직 구현하지 않는다.

현재 구현: 공식 Vinext UI, D1 작업 저장, 팀 사용자 허용 목록, 실행기 별도 인증, 한 건 작업 인수, 중복 요청 키, 실행기 중단 후 확인 필요 처리, TypeScript 실행기, 예약 검증 계약, 가짜 API 테스트.

## 미확정 계약과 실행 차단
`config/development.json`은 의도적으로 유효한 계약이 아니다. 상품 ID/가격/시간, 반복 상품 방식의 수량 의미, 상품·재고 조회, OS 응답 필드, 결제 완료 조건, 개발 호스트 및 인증을 배포 기준으로 확인해야 한다. 샘플 ID와 실제 예약번호 필드를 추정하지 않았다.

확인된 요청: `POST /os/v1/orders`, `POST /os/v1/orders/{orderId}/complete`, OS 주문 조회. Postman Order collection `15725328-7397a927-a3f6-458b-a6bd-c05218e5bda7`. 조회 요청에는 저장된 응답 예제가 없었다. 계약 타입은 `runner/adapter.ts`의 `contractSchema`에 있다. `/`로 시작하는 JSON Pointer를 명시한다. 테스트 fixture는 실제 API 계약으로 사용하지 않는다.

## 연결과 실행
1. Node 22.13 이상, 의존성 설치 후 Sites 빌드 및 D1 migration 적용.
2. Sites 비공개 접근 정책 유지. `QA_TEAM_USER_IDS`에 이 Site의 사용자 ID를 쉼표로 설정한다. 로그인 화면에서 자신의 ID만 확인 가능하다. 처음에는 누구도 실행/조회 불가.
3. Sites의 `QA_RUNNER_TOKEN`과 내부 실행기의 동일 값을 별도 비밀 저장소에 넣는다(32자 이상).
4. Sites에서 지원하는 서비스 접근 자격을 내부 `QA_SITES_SERVICE_TOKEN`에 넣는다. 사이트 공개 전환이나 인증 우회는 금지한다.
5. 내부 환경에만 개발 bearer token, 테스트 주문자 이름/연락처, 직원 ID, 검증된 계약 파일을 배치한다. `.env.example`은 변수 이름만 제공한다. 현재 어댑터는 사전 발급 bearer token 방식이며 OAuth 토큰 발급·갱신은 후속 작업이다.
6. `node --experimental-strip-types --experimental-transform-types runner/main.ts` 실행. 환경변수는 배포 비밀 주입 사용. 하나의 인스턴스로 실행한다. 인바운드 포트 없음.

## 재시작·오류 처리
작업 인수는 D1 단일 UPDATE RETURNING으로 이루어진다. 상태 변경 전 체크포인트 저장이 성공해야 다음 요청을 보낸다. 처리 중 작업은 재인수하지 않는다. 90초 상태 보고가 없으면 확인 필요로 전환한다. 읽기 결과 없이 성공으로 만들지 않는다. 완료 요청 타임아웃은 조회로만 확인한다. 생성 요청 타임아웃에는 주문 ID가 없을 수 있어 확인 필요로 남긴다.

미해결 주문은 운영자가 개발 주문 시스템에서 대조한다. 이 버전에는 강제 재실행/삭제/환불/수동 성공 전환 UI가 없다. 이전 주문이 해결되기 전 같은 조건으로 새 실행을 요청하면 별도 주문이 생성될 수 있다.

## 남은 검증과 다음 행동
실제 ALL 및 배포 계약 확정 → 비밀 설정·팀 허용 → Sites와 사내 실행기 HTTPS 연결 → 개발 예약 실제 실행·재조회. 통과 전 예약 기능을 완료로 표시하지 않는다. 체험 단계는 이 조건 통과 후 진행한다.

검증 결과와 배포 상태는 이 문서 끝에 갱신한다.

## 2026-10-12 검증 결과
- 단위·가짜 HTTP API 테스트 14개 통과.
- TypeScript 타입 검사 및 공식 Sites production build 통과.
- 로컬 D1 migration 두 건 적용. HTTP 연결 테스트: 권한, CSRF, 입력 오류, 중복 생성 방지, 동시 인수 1건, 체크포인트 순서/토큰 검증, 결과 저장과 비밀 제외 통과.
- 실제 90초 만료 후 RUNNING → NEEDS_REVIEW, 이전 실행기 토큰 보고 거절, 재인수 방지 확인.
- 브라우저: 로컬 로그인, 팀 허용, 미검증 상품에서 실행 차단, 화면 렌더링 확인.
- 실제 개발 예약/재조회, 내부 배포 및 컨테이너 실행은 미검증.
- 비공개 Site ID: appgprj_6accab70b2bc81918199aace2ed4ec7a. 기존 ID를 재사용한다. Sites service access 지원 확인. 발급/접근 자격값은 문서에 기록하지 않는다.
- 로컬 Node/npm 기본 설치가 없어 번들 Node(`/Users/reyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`)와 임시 npm(`/private/tmp/cju-qa-toolchain/npm`)으로 검증했다. 재개 시 Node >=22.13과 npm을 준비한다.
- 사용자 Git 규칙에 맞춰 `feature/reservation-qa` 브랜치 사용. main 직접 push 금지.

## 배포 중단 지점
로컬 구현 커밋: `1d58aaa` (`feature/reservation-qa`). Sites source helper 실행은 자동 승인 검토가 거절했다. 반환된 credential의 기본 branch가 main이며 작업 브랜치 push 권한을 확인하지 못해 사용자 main 직접 push 금지와 충돌한다는 사유다. 원격 push와 배포는 수행되지 않았다. 우회하거나 credential의 branch를 임의 변경하지 않는다. 작업 브랜치 업로드를 지원하는 공식 경로를 확인하거나, 이 Sites 전용 저장소의 main 업로드 예외를 사용자에게 명시적으로 승인받아야 한다. 짧은 수명 source credential은 만료되었으므로 승인 후 동일 Site에 새 write credential을 요청한다.

실제 Node 실행기 프로세스 → 로컬 Sites 연결 및 미검증 계약 차단도 통과했다. 모든 로컬 이력은 가짜 API 테스트 데이터이며 실제 개발 예약이 아니다. 캡처는 `outputs/qa-preview.png`에 있으며 Git/배포에서 제외한다. 로컬 미리보기 프로세스는 작업 종료 시 중지한다.
