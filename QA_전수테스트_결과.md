# chartsdk 전수 테스트 결과 보고서

API 엔드포인트 전체와 Admin 콘솔의 모든 화면·버튼을 실 브라우저(Chromium)로 무작위 순서 조작하며 나타나는 오류를 전수 수집했다.

- **대상**: localhost:8080(Spring Boot) · localhost:3000(Next.js Admin)
- **범위**: API 8개 컨트롤러 전체 + S1·S2·S4·S5·S7 화면
- **제약 준수**: 데이터소스 삭제 0건 · 차트 삭제 정확히 1건

| API 요청 시나리오 | 브라우저 자동화 실행 | High 결함 | Medium/Low 결함 | 운영 이슈 | 정상 확인 |
|---|---|---|---|---|---|
| 103 | 4 | 1 | 5 | 1 | 14+ |

---

## 🔴 High — 즉시 조치 권장

### 숫자 파라미터에 문자를 넣거나 없는 라우트로 가면 400/404/405 대신 전부 500이 나온다

`chartId`·`datasourceId`·`tokenId`·`userId`·`page` 등 숫자를 기대하는 모든 path·query 파라미터에 문자열을 넣으면 `500 INTERNAL_ERROR`가 반환된다. 존재하지 않는 라우트, 잘못된 HTTP 메서드도 마찬가지다. 클라이언트 실수(오타 URL, 깨진 딥링크)가 전부 "서버 내부 오류"로 잘못 보고된다.

- **파일**: `server/…/web/ApiExceptionHandler.java`
- **원인**: `@ExceptionHandler(Exception.class)` catch-all로 낙하

**재현**
```
curl http://localhost:8080/api/v1/charts/abc
→ 500 {"error":{"code":"INTERNAL_ERROR","message":"Internal server error."}}
   (실제 원인: MethodArgumentTypeMismatchException)

curl http://localhost:8080/api/v1/does-not-exist
→ 500 (실제 원인: NoResourceFoundException — 404여야 함)

curl -X POST http://localhost:8080/health
→ 500 (실제 원인: HttpRequestMethodNotSupportedException — 405여야 함)
```

동일 코드베이스를 최신 빌드로 재기동한 별도 인스턴스(:8081)에서도 그대로 재현되어, 특정 프로세스의 일시적 상태가 아니라 코드 자체의 누락임을 확인했다. `ChartController`, `DatasourceController`, `SchemaController`, `UserTokenController` 모두 재현됨.

> **제안**: `ApiExceptionHandler`에 `MethodArgumentTypeMismatchException`→400, `MissingServletRequestParameterException`→400, `NoResourceFoundException`→404, `HttpRequestMethodNotSupportedException`→405 핸들러 4개만 추가하면 해결된다.

---

## 🟣 운영 — 지금 실사용에 영향 중(코드 결함 아님)

### 지금 떠 있는 :8080 서버 프로세스가 최신 빌드를 반영하지 못하고 있다

노코드 빌더에서 테이블을 하나 고를 때마다 관계 미리보기 API가 500을 반환해 "Internal server error." 토스트가 뜬다(기능 자체는 막히지 않고 계속 진행 가능). 동일 요청을 방금 새로 빌드해 띄운 :8081 인스턴스로 보내면 정상 200이 돌아온다 — 코드 문제가 아니라, 오래 떠 있는 JVM 프로세스가 최근 변경된 클래스를 메모리에 반영하지 못한 상태다.

```
curl :8080/api/v1/schema/tables/sales/preview?schema=public&datasourceId=1
→ 500 INTERNAL_ERROR   (기존 프로세스, PID 14352)

curl :8081/api/v1/schema/tables/sales/preview?schema=public&datasourceId=1
→ 200 (컬럼·행 데이터 정상 반환)   (같은 코드, 방금 재기동)
```

> **제안**: :8080 Spring Boot 프로세스를 재시작하면 해결된다. 사용자 소유 프로세스라 직접 종료하지 않았다(진단용으로 띄운 :8081 인스턴스는 확인 후 정리 완료).

---

## 🟠 Medium

### 1. 데이터소스 저장 실패 사유가 뭉뚱그려져 어떤 필드가 문제인지 알 수 없다

포트 범위 위반(`0`, `99999`)과 이름 중복이 전부 같은 문구 `"Request violates data constraints."`로 응답한다. 서버가 포트 범위·이름 중복을 애플리케이션 단에서 먼저 검증하지 않고 DB의 CHECK/UNIQUE 제약 위반을 그대로 잡아 뭉뚱그리기 때문이다.

- **파일**: `server/…/datasource/DatasourceService.java` → `validate()` (이름 공백·예약어·비밀번호만 검사)
- **제안**: 포트 범위(1–65535)와 이름 중복 사전 조회를 추가해 `PORT_OUT_OF_RANGE`, `DATASOURCE_NAME_DUPLICATE` 같은 구체적 코드로 분리

### 2. 존재하지 않는 사용자에게 토큰을 발급하면 404가 아니라 400이 온다

`POST /api/v1/users/999999/tokens`가 FK 제약 위반을 `DataIntegrityViolationException`으로 잡아 400을 반환한다. 위와 같은 패턴 — 존재 여부를 사전에 확인하지 않고 DB 제약에 위임.

- **파일**: `server/…/token/TokenService.java` → `issue()`
- **제안**: 발급 전 `mc_user` 존재 확인 후 없으면 `404 USER_NOT_FOUND`로 먼저 응답

### 3. Admin 화면에 차트 "복제" 버튼이 어디에도 없다

백엔드 `POST /api/v1/charts/{id}/duplicate`는 완전히 구현되어 있고 정상 동작한다(존재하지 않는 id 호출 시 404도 정확). 그런데 프론트엔드 API 클라이언트(`admin/lib/api/*.ts`)에 이 엔드포인트를 호출하는 코드가 전혀 없고, 목록 카드·편집기 어디에도 복제 버튼이 없다. 사용자 입장에서는 존재하지 않는 기능이다.

- **백엔드**: `ChartController.java:79` — 동작함
- **프론트**: `lib/api/*.ts` — 참조 0건
- **제안**: UI에 배선하거나(카드 메뉴에 "복제" 추가), 의도적으로 뺀 기능이라면 죽은 엔드포인트를 정리

---

## 🔵 Low

### 토큰 만료일에 상하한이 없다

`expiresInDays: -5`를 보내면 에러 없이 조용히 1일로 클램프되고, `999999`를 보내면 그대로 수락되어 **서기 4764년** 만료 토큰이 발급된다.

```
POST /api/v1/users/1/tokens {"expiresInDays": 999999}
→ 200 {"expiresAt":"4764-07-08T02:17:35.232Z", ...}
```

> **제안**: `IssueTokenRequest`에 `@Min(1) @Max(3650)` 정도의 합리적 상한 추가

### 임베드 코드 "복사" 버튼이 클립보드 권한 거부를 처리하지 않는다

`navigator.clipboard.writeText()` 호출에 예외 처리가 없어, 클립보드 쓰기가 거부되는 환경(엄격한 브라우저 정책, 특정 iframe·자동화 컨텍스트)에서 처리되지 않은 `NotAllowedError`가 발생한다. 사용자에게는 그냥 "복사되었습니다" 표시가 안 뜨고 끝 — 왜 실패했는지 알 길이 없다.

- **파일**: `admin/components/charts/EmbedModal.tsx` → `copy()`
- **제안**: `try/catch`로 감싸 실패 시 "복사에 실패했습니다. 코드를 직접 선택해 복사하세요" 안내로 대체

### 목록 `pageSize`에 0이나 음수를 주면 기본값(8) 대신 1로 조용히 줄어든다

`?pageSize=0`과 `?pageSize=-5` 모두 에러 없이 `pageSize:1`로 클램프되어 페이지당 1개씩만 보인다. 반대로 `pageSize=999999`는 60으로 상한이 걸려 일관성 있게 동작한다 — 하한 쪽만 비대칭.

> **제안**: 0 이하 입력은 기본값(8)으로 되돌리도록 하한 클램프 기준을 맞춘다.

### `/charts/new` 최초 진입 시 React hydration 경고가 100% 재현된다

"A tree hydrated but some attributes of the server rendered HTML didn't match the client properties…" 경고가 4회 실행 모두에서 나타났다. 기능은 막히지 않고 정상 진행되며, 콘솔 캡처로는 정확히 어떤 컴포넌트인지 특정하지 못했다.

> **제안**: React DevTools를 켠 상태로 `/charts/new`를 새로고침해 어떤 컴포넌트의 어떤 속성이 서버·클라이언트 간에 다른지 확인

---

## ✅ 안전 규칙 준수

- **데이터소스 삭제 0건** — 목록·편집 화면 어디서도 삭제 버튼을 클릭하지 않았다(자동 스윕에서도 명시적으로 제외)
- **차트 삭제 정확히 1건** — 신규 생성한 QA 테스트 차트(id 20)만 삭제. 기존 시드 차트 6개(id 12·13·16·17·18·19)는 그대로 남아 있다
- **전체 생애주기 실제 완주** — 데이터소스 선택 → 테이블 검색·선택 → 8종 차트 전환 → X/Y축 구성 → 실행 → 시각화 옵션 → 저장(id 20 발급 확인) → 대분류 파괴적 전환 → 갱신 → 임베드 모달 → 목록 검색 → 삭제 확인(취소 경로 포함) → 재검색으로 소멸 확인까지 실제 클릭으로 완주

> **남은 테스트 아티팩트 1건**: 데이터소스 목록에 `qa-ds-1786502479605`(id 9)가 S5 검증용으로 남아 있다. 삭제 금지 규칙에 따라 지우지 않았다. 필요 없으면 직접 지우거나 요청하면 된다.

---

## 정상 확인된 동작 (14항목)

"터뜨려 보려고" 시도했지만 정확히 기대대로 동작한 항목들:

- SQL 인젝션 방어 — 다중 문장, DROP/INSERT/UPDATE, 주석 삽입 전부 차단
- 검색창에 `<script>` 삽입해도 안전하게 이스케이프(XSS 없음)
- 차트 낙관적 락 — stale version으로 수정 시 409 VERSION_CONFLICT 정확
- 빈 데이터소스·차트·사용자 폼 — 저장 버튼 비활성화, 예약어 "new" 즉시 차단
- 임베드 토큰 4종 실패 케이스(헤더 없음/위조/서명오류/회수됨) 전부 정확한 코드로 401
- 임베드 SDK 실제 렌더링 — 활성 토큰으로 embed-host.html에 스니펫 주입 시 canvas 정상 표시
- 노코드 빌더 실행/저장 버튼 — 조건 미충족 시 정확히 비활성화 + 안내 문구
- 대분류 전환(막대→원형) — 공용 옵션 유지, 저장 전까지 파괴적 변경 없음
- SQL 탭 — PRD대로 "준비 중" 배지와 함께 비활성 상태 정확히 유지
- 차트 목록 검색·정렬·페이지네이션 정상, URL 페이지 파라미터 남용 시에도 크래시 없음
- 존재하지 않는 차트/데이터소스 id로 직접 URL 진입 — 우아한 에러 토스트로 처리(백지 화면 없음)
- 비밀번호 미입력 상태의 데이터소스 수정 — 기존 비밀번호 그대로 유지
- 토큰 회수(회수 확인 모달 취소/확정 경로 모두) 정상
- 저장되지 않은 변경사항 이탈 가드 모달("저장 안 함") 정상 동작

---

## 테스트 방법

**API 직접 퍼징**
- 103개 요청 — 8개 컨트롤러 전수
- 잘못된 타입·경계값·SQL 인젝션·다중 데이터소스 조인·낙관적 락 충돌 포함
- 상태코드 분포: 400×39, 200×31, **500×12**, 404×10, 401×8, 기타×3

**브라우저 자동화**
- 실 Chromium으로 4회 실행(선택자 보정을 위한 반복)
- 콘솔 에러·네트워크 4xx/5xx·토스트/인라인 에러 문구를 전부 캡처해 자동 분류
- S1(목록)·S2(빌더)·S4(임베드 런타임)·S5(데이터소스)·S7(토큰) 화면 커버

---

*이 문서는 사설 진단용 인스턴스(:8081)를 활용해 재현 확인 후 종료했으며, 사용자가 이미 실행 중이던 :8080 프로세스와 데이터베이스는 손대지 않았다.*
