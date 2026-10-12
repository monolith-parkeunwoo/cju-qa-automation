# CJU QA Automation

개발 환경 전용 예약 QA 도구. Sites 화면과 외부로 작업을 가져가는 Node.js 실행기를 분리한다.

- `app/`: 예약 실행·상세·이력, 사용자/실행기 API
- `db/`, `drizzle/`: D1 작업 큐 및 migration
- `packages/contracts/`: 공통 입력·결과와 검증 규칙
- `runner/`: 사내 실행기 및 OS 계약 어댑터
- `config/development.json`: 미검증 상태로 실행 차단
- `tests/`: 상태 변경 재시도 방지 및 조회 검증 테스트

```sh
npm run install:ci
node --experimental-strip-types --experimental-transform-types --test tests/*.test.ts
npx tsc --noEmit --incremental false
npm run db:generate
npm run build
```

로컬 preview는 공식 Sites starter의 `npm run dev`를 사용한다. 접근 허용 사용자 및 runner token을 로컬 전용 `.dev.vars`에 넣는다. 실제 개발 API 비밀은 실행기 환경에만 넣는다. 상세 연결과 미완료 조건은 [IMPLEMENTATION.md](IMPLEMENTATION.md)를 참조한다.

로컬 API 통합 검증: 미리보기와 D1 migration 준비 후 `node tests/local-integration.mjs`. 가짜 데이터만 만들고 실제 90초 작업 만료를 검증한다. 로컬 전용이며 개발 예약 API를 호출하지 않는다.
