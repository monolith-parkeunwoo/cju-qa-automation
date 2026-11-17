# CJU QA Automation 진행 기록

## 목표와 현재 상태

2026-10-13: 로컬 Sites 대시보드와 사내 실행기를 연결해 **실제 개발 ALL 예약·재조회·가상 발권·티켓 조회**를 완료했다. 사용자 요청에 따라 발권을 독립 단계로 추가하고 예약번호를 먼저 큰 글씨로, 주문번호를 작은 글씨로 표시하고 옆에 wearableId를 표시했다. 새 예약의 주문 구분(ordererInfo)은 테스트로 지정한다. 기존 주문 125499의 구분은 변경하지 않았다. 레이스 단계 구현과 실제 사전 검증까지 진행했다. 레이스 한 사이클·액티비티·원격 배포는 아직 완료하지 않았다.

| 항목 | 실제 검증 결과 |
|---|---|
| 환경 | dev-api.cju.981park.com |
| 상품 | 116, 액티비티 ALL 패키지(최신), 123,500원 |
| 예약 | 2026-10-13 19:00 Asia/Seoul, 1매 |
| 주문 / 예약번호 | 125499 / 596B55B24212 |
| wearableId / 티켓 ID | 2610131118629 / 20069 |
| 실행 ID | e63ee084-de82-44ef-938d-ce8e1c79d09b |
| 예약 검증 | 상품·일시·수량·완료 상태·예약번호 일치 |
| 발권 검증 | 예약·주문·상품 일치, 활성 티켓과 미사용 이용권 존재 |

이용권 존재는 모든 체험의 실행 성공이나 예약 시각 전 이용 가능성을 의미하지 않는다. 가상 발권의 wrbId를 wearableId로 사용한다. 여러 장이면 각각 저장·조회하며 일부 조회 실패에도 확보한 식별자를 보존한다. 기존 가짜 이력은 삭제하지 않고 화면에서 로컬 테스트 데이터로 구분한다.

## 확인한 계약

Postman 개발 환경과 배포 API 응답으로 확인했다. 상품·재고는 실행 전 다시 조회하며 운영 호스트로 전환하지 않는다.

- 인증: dev-accounts.sgp.981park.com/oauth2/token, 서비스별 client_credentials. 실행기 메모리에서 발급·갱신한다.
- 상품: GET /product/os/v1/products, INFO_DESK 채널.
- 재고: GET /stock/v1/stocks/availability/date/{date}/prdId/116/quantity/{quantity}/location/INFO_DESK. enabled 시간만 사용한다.
- 주문: POST /order/os/v1/orders. 수량만큼 orderProducts를 보낸다.
- 완료: POST /order/os/v1/orders/{orderId}/complete, 개발 CARD 처리.
- 주문 조회: data.orderId, data.reservationId, data.orderProducts와 COMPLETED 상태를 정규화·검증한다.
- 가상 발권: POST /ticket/v1/reservation/order/{reservationId}/test-virtual-print.
- 티켓 조회: GET /ticket/v1/reservation/ticket/wearable/info/{wearableId}.

Postman Order collection: 15725328-7397a927-a3f6-458b-a6bd-c05218e5bda7. Ticket collection: 15920202-b3e05b45-2e45-4c72-a24a-8d461944ff6c. 테스트 주문자는 합성 정보이며 직원 regId는 저장된 Postman 예제를 사용했다. 인증값·주문자 연락처·전체 응답은 문서와 D1에 저장하지 않는다.

## 연결과 재개

1. Node 22.13 이상과 npm을 준비한다. 이번 검증은 번들 Node 24.19.0과 /private/tmp/cju-qa-toolchain/npm을 사용했다. 임시 도구는 재개 시 존재 여부를 확인한다.
2. Sites 비공개 정책, QA_TEAM_USER_IDS 허용 목록, 32자 이상 QA_RUNNER_TOKEN을 설정한다. 로컬 설정은 Git에서 제외된 .dev.vars에 둔다.
3. 공식 Sites 빌드와 D1 migration 0000~0004를 적용한다. 로컬은 .wrangler/state에 이미 적용했다. 로컬 결과 DB를 초기화하지 않는다.
4. 실제 개발 실행기는 `node --experimental-strip-types --experimental-transform-types runner/development-runner.ts`이다. 첫 stdin 한 줄에 JSON 설정을 비밀 주입한다. credentials는 product/order/ticket별 id·secret, 레이스 기능에는 race의 composer id·secret, orderer는 name·phone·regId, siteUrl, runnerToken을 받는다. 로컬은 local:true와 loopback URL을 사용한다. 원격은 HTTPS와 serviceToken이 필수다. 셸 명령·로그·추적 파일에 비밀을 넣지 않는다.
5. 실행기는 하나만 실행한다. 외부 인바운드 포트 없이 Sites 작업을 가져온다. 실제 개발 호출은 /product, /stock, /order, /ticket 접두사를 유지한다.

기존 runner/main.ts, runner/adapter.ts와 config/development.json은 범용 미검증 경로다. 실제 검증에 사용하지 않았으며 자동으로 검증 완료 설정으로 바꾸지 않는다. 기존 Dockerfile도 이 범용 경로를 사용하므로 현재 컨테이너 배포는 완료 상태가 아니다.

시간 선택은 날짜·수량별 재고 API 조회로 제공한다. 준비 상태는 연결·상품 확인용이며 시간 목록을 공유하지 않는다. 한 번에 1매 실검증을 완료했으며 다매 실발권은 단위 테스트만 수행했다.

## 재시작·실패 처리

상태 변경 요청 전 D1 체크포인트가 저장되어야 한다. 작업 인수는 조건부 UPDATE RETURNING이며 동시에 한 건만 처리한다. 발권 작업은 ticketing 지원을 선언한 실행기만 가져간다. 이미 발권 상태가 있는 실행을 다시 요청하면 현재 상태를 반환하고 재발권하지 않는다.

상태 변경 요청이 끊기면 자동 재호출하지 않는다. 예약 완료는 재조회로 판정한다. 발권 응답이나 조회를 확정할 수 없으면 확인 필요로 남긴다. 실행 중 90초 상태 보고가 없으면 확인 필요로 바꾸고 기존 식별자를 보존한다. 재시작 후 처리 중 작업을 다시 인수하지 않는다. 강제 재실행·삭제·환불·수동 성공 전환은 구현하지 않았다.

## 검증 결과

- 2026-10-13 단위·가짜 API 테스트 35개 통과. 새 발권·개발 계약 테스트는 구현 전 실패를 확인한 뒤 통과시켰다.
- TypeScript 타입 검사와 공식 Sites production build 통과.
- 실제 개발 예약과 가상 발권을 각 한 번 수행하고 후속 조회로 검증했다.
- tests/ticket-dashboard-integration.mjs 통과: 저장된 실결과, 비인가 접근·CSRF 차단, 재발권 방지, 가짜 예약의 발권 차단, 이전 토큰 보고 거절. 새 개발 API 변경 요청은 보내지 않는다. outputs/development-2026-10-13.json 로컬 기록이 필요하다.
- 브라우저 실행 이력에서 주문/예약번호 옆 wearableId 및 발권 성공을 확인했다. 캡처: /Users/reyu/.codex/visualizations/2026/10/12/01a12f20-ece5-75a3-acb4-554fd0521c9f/qa-wearable.png.
- 2026-10-12 기존 로컬 연결 테스트에서 중복 생성, 동시 인수, 체크포인트, 90초 만료·재인수 방지를 확인했다. tests/local-integration.mjs는 가짜 작업을 생성하므로 실제 실행기를 중지한 뒤 사용한다.
- 원격 Sites와 사내 실행기 HTTPS 연결, 컨테이너 배포, 레이스 체크인 이후 실호출·액티비티는 미검증이다.

## 배포 조건과 다음 행동

Site ID appgprj_6accab70b2bc81918199aace2ed4ec7a를 재사용한다. 비공개 접근과 service access 지원은 확인했다. 원격 push·배포는 수행하지 않았다.

앞선 Sites source helper는 자동 승인 검토에서 거절되었다. credential의 기본 branch main이 사용자 main 직접 push 금지 규칙과 충돌하기 때문이다. credential을 임의 변경하거나 우회하지 않는다. 다음 배포 작업에서 공식 작업 브랜치 업로드 지원을 확인하거나 Sites 전용 저장소의 예외 승인을 받아야 한다. 기존 credential은 만료됐으므로 그 이후 새로 발급한다.

개발 작업 브랜치는 feature/reservation-qa다. 다음 행동은 기존 티켓의 시간 조건을 정상적으로 만족하는 시점에 레이스 조건을 다시 확인하는 것이다. 사전 검증이 성공한 뒤 단계별 실호출과 재조회를 진행한다. 자동 예약·강제 사용·시간 변경·정기 재실행은 설정하지 않았다. 사용자에게 예약 정보를 다시 요구할 필요는 없다.

## 레이스 단계: 2026-10-13

예약 596B55B24212 / wearableId 2610131118629의 실제 읽기 전용 사전 검증을 실행했다. 개발 티켓 API는 `TICKET.10104`와 `boarding time expired.`를 반환했다. 대시보드는 선행 조건 미충족으로 저장했으며 board=false, course=false, 차량 E001의 queue는 비어 있었다. 예약은 같은 날 19:00이지만 허용 시간 전후 범위는 응답으로 확정할 수 없다. 새로운 주문이나 발권을 만들거나 forceUse로 우회하지 않았다.

- 구현: 사전 조건 → 탑승 → 코스 → 준비 → 시작 → 종료 → 더미 기록·조회. 한 번에 한 단계만 수동 실행한다. E1/트랙 1을 첫 시나리오로 제한했다. 차량 번호·게이트·랩타임·최고/평균 속도를 입력한다.
- 메타데이터: 개발 조회에서 트랙 1=E1, E001=E 모델, gate/list에 cju_board_checkin_b2f_ed01 존재를 확인했다. 실행 직전 차량 점유·티켓 소유 관계와 시간 조건을 다시 조회한다. 공유 개발 차량이므로 레이스 전용으로 예약된 자원이라고 주장하지 않는다.
- 코드 계약: composer `/race-dummy/*`, manager `/car-queue/{number}`, status `/race-workflow/{id}/detail`, `/race-record/{workflowId}`, record `/race/record/track-sensor/{workflowId}`. 종료 후 기록 생성 흐름은 [수동 더미 레이싱](https://981park.atlassian.net/wiki/spaces/AppScrum/pages/2614132794)과 서비스 코드로 구성했다. 실제 배포에서 체크인 이후 순서와 응답을 끝까지 검증한 상태는 아니다.
- 판정: 각 단계 조회, 소유 workflow, 시작 시 티켓 사용 시각, 종료 상태 FN004·차량 해제, 기록 값·NR001·특정 psuTraceId 사용을 확인한다. record 조회는 status를 참조하는 통합 조회이므로 별도 저장소의 독립 기록 검증은 아니다.
- 실패 처리: D1 체크포인트 전에는 상태 변경을 보내지 않는다. 변경 이후 불확실성은 확인 필요로 고정한다. 변경 전 차단은 사용자 버튼으로 같은 단계를 재확인할 수 있다. 같은 요청 키는 재실행하지 않는다. 90초 실행기 만료 시 확인 필요로 남긴다.
- 검증: 새 테스트 11개 포함 전체 35개, 타입 검사, 공식 빌드 통과. race-dashboard-integration.mjs에서 권한·CSRF·중복 방지·다른 wearable 거절·단계 건너뛰기·이전 보고 토큰 거절 및 기존 상태 보존을 확인했다.
- 미검증: 준비에서 새 workflow 확보, 시작과 티켓 사용, 종료 후 더미 기록 및 전체 값 일치. 시간 조건이 충족되기 전에는 레이스 기능 완료로 표시하지 않는다.

실행기 재개 시 credentials.race를 주입해야 레이스 작업을 가져온다. 로컬 UI는 기존 Sites 세션을 사용한다. 읽기용 임시 조사 프로세스는 종료한다. 재개 정보는 이 문서와 로컬 D1에 보존하며 임시 스크립트가 없어도 재개할 수 있다.

## 날짜·수량별 예약 시간: 2026-10-13

- 실제 개발 재고 응답 기준으로 셀렉트 박스를 제공한다. 오늘 1매·2매와 내일 1매 모두 19:00, 19:20, 19:40만 enabled=true였다. 조회는 14시대에 수행했으며 다른 시간은 API가 불가로 반환했다. 이 결과를 고정 설정으로 저장하지 않는다.
- 날짜·수량 변경 시 기존 선택을 무효화하고 사내 실행기에 읽기 전용 조회 작업을 요청한다. 실행기가 상품 가격과 재고를 다시 조회해 최소 결과만 D1 availability에 보고한다. 실패 시 예약 버튼을 차단한다.
- 조회 유효기간은 60초다. 날짜·수량·선택 시간의 일치와 enabled 값을 UI와 예약 생성 API에서 검사한다. 주문 생성 직전 실행기에서 재고·가격을 다시 확인한다. 가격은 선택 날짜의 조회 결과를 실행 스냅샷으로 전달한다.
- 한국 날짜가 기본값이며 가능한 첫 시간을 선택한다. 불가 시간은 비활성으로 표시한다. 현재 한국 시각과 조회 시각을 표시한다. 예약·가상 발권과 실제 레이스 입장 가능 여부는 구분한다.
- main의 park-ticket-api/ticket-cju-api TicketPsuProcessService 확인: 입장 시작은 boardingTime - 10분 - 장소 당김 시간. 횟수권 종료는 psuTime + 20분 + 장소 지연 + master/개별 delay, 시간권은 playTime 적용. 시작 전과 종료 후 모두 TICKET.10104가 가능하다. 개발 배포 버전·현재 장소 조정값은 별도 확인이 필요하다.
- migration 0004_orange_lady_ursula.sql을 로컬 D1에 적용했다. 기존 스키마는 이미 적용되어 있고 Wrangler d1_migrations에 이력이 없어서 migrations apply는 기존 runner 테이블 중복으로 실패했다. 0004 파일만 d1 execute로 적용했으며 기존 실행 데이터는 보존했다. 초기 migration을 현재 DB에 다시 실행하지 않는다.
- 검증: 단위 테스트 38개, 타입 검사, 공식 production build 통과. availability-dashboard-integration.mjs에서 날짜·수량별 개발 실조회, 비인가·CSRF·잘못된 날짜/수량·불가 시간 차단과 기존 실행 보존 확인. 새 예약·발권은 만들지 않았다. 브라우저에서도 수량 변경 시 잠금→조회→시간 선택을 확인했다.
- 기존 로컬 연결 fixture 테스트도 availability 작업·보고 흐름에 맞춰 갱신했다. QA_FIXTURE_TEST=true와 별도 로컬 DB가 필요하며 dev-live 실행기가 연결된 대시보드에서는 중단한다. 이번에는 실환경 보존을 위해 이 가짜 작업 생성 테스트를 실행하지 않았다.
- 로컬 Sites와 실행기는 변경 버전으로 실행 중이다. 원격 배포는 기존 source 업로드 승인 문제로 수행하지 않았다.
