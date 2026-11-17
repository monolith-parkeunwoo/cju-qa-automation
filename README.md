# CJU QA Automation

개발 환경 전용 예약·가상 발권·레이스 단계 QA 도구. Sites 화면과 외부로 작업을 가져가는 Node.js 실행기를 분리한다.

- `app/`: 예약 실행·상세·이력, 사용자/실행기 API
- `db/`, `drizzle/`: D1 작업 큐 및 migration
- `packages/contracts/`: 공통 입력·결과와 검증 규칙
- `runner/`: 사내 실행기, 개발 API 연결과 예약·발권 검증
- `config/development.json`: 미검증 상태로 실행 차단
- `tests/`: 상태 변경 재시도 방지 및 조회 검증 테스트

```sh
npm run install:ci
node --experimental-strip-types --experimental-transform-types --test tests/*.test.ts
npx tsc --noEmit --incremental false
npm run db:generate
npm run build
```

로컬 preview는 공식 Sites starter의 `npm run dev`를 사용한다. 접근 허용 사용자 및 runner token을 로컬 전용 `.dev.vars`에 넣는다. 실제 개발 API 비밀은 development-runner.ts의 보호된 stdin으로만 주입한다. 상세 연결과 미완료 조건은 [IMPLEMENTATION.md](IMPLEMENTATION.md)를 참조한다.

로컬 API 통합 검증: 미리보기와 D1 migration 준비 후 `node tests/local-integration.mjs`. 실제 개발 실행기를 중지한 뒤 실행한다. 가짜 데이터만 만들고 실제 90초 작업 만료를 검증한다. 로컬 전용이며 개발 예약 API를 호출하지 않는다.

실제 개발 예약·발권 완료 및 wearableId 표시를 검증했다. 결과와 정확한 실행·재개 조건은 위 진행 기록을 따른다. 기존 Dockerfile과 범용 runner/main.ts는 실제 검증에 사용한 실행 경로가 아니다.

레이스는 발권 완료 실행의 상세에서 이용한다. E1/트랙 1부터 단계별로 실행하며, 현재 실제 티켓의 시간 조건 거절로 사전 검증에서 차단된 상태다. 체크인 이후 실사용 검증은 남아 있다.
