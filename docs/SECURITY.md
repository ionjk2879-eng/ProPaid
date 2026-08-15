# 보안 강화

요청받은 11개 항목과 Cloudflare Turnstile 적용 현황을 정리합니다. 각 항목은 **구현함 / 이미 만족함(코드 감사로 확인) / 의도적으로 범위에서 제외함** 중 하나로 표시하고, 제외한 항목은 이유를 명시합니다.

## 1. 모든 API에서 사용자 소유권 확인 — 이미 만족함(감사 완료)

`worker/src/index.ts`의 모든 `:id` 라우트를 감사했습니다. 예외 없이 `WHERE id = ? AND user_id = ?` 패턴(또는 그 이전 단계에서 소유권이 확인된 리소스로부터 파생된 ID)을 사용하고, 존재하지 않거나 남의 소유인 경우 `404`를 반환합니다. 대상: 거래(조회·수정·상태변경·삭제·Notion 내보내기), 비용(조회·수정·삭제·증빙 업로드/다운로드), 구독(수정·삭제), 수신 메일(분석 수정·저장·재시도). `saveExpense`가 `dealId`를 받을 때도 해당 거래가 요청자 소유인지 먼저 확인합니다.

## 2. 다른 사용자의 거래 ID로 접근 테스트 — 구현함(자동 테스트 스크립트)

`worker/scripts/ownership-check.mjs`를 추가했습니다. 로컬 D1에 가짜 사용자 A·B와 A 소유의 거래·비용·구독·수신 메일을 만든 뒤, B의 정상 JWT로 A의 리소스 ID 11곳을 호출해 전부 `404`인지 검증합니다(끝나면 가짜 데이터는 정리).

```bash
cd worker
npm run dev            # 다른 터미널에서
npm run ownership:check
```

실행해 11개 항목 모두 통과함을 확인했습니다. Calendar 동기화(`/api/deals/:id/calendar`)와 수신 메일 재시도(`/api/inbox/messages/:id/retry`)는 각각 Google 연결 여부·`RESEND_API_KEY` 설정 여부를 거래/메일 소유권보다 먼저 확인하므로 스크립트로 신뢰성 있게 재현하기 어려워 제외했습니다 — 코드 감사로 두 라우트 모두 동일한 `WHERE ... AND user_id = ?` 패턴을 쓰는 것은 확인했습니다.

## 3. 로그인·분석·메일 처리 요청 제한 — 구현함

Cloudflare Rate Limiting 바인딩(`worker/src/ratelimit.ts`)을 세 가지 목적으로 나눠 등록했습니다(`wrangler.jsonc`의 `ratelimits`).

| 바인딩 | 한도 | 적용 대상 | 기준 |
| --- | --- | --- | --- |
| `LOGIN_LIMITER` | 60초당 20회 | `GET /api/auth/google`, `GET /api/auth/google/callback` | 클라이언트 IP(`CF-Connecting-IP`) |
| `ANALYSIS_LIMITER` | 60초당 20회 | `POST /api/proposals/preview`, `POST /api/inbox/messages/:id/retry` | 로그인한 사용자 ID |
| `MAIL_LIMITER` | 60초당 30회 | `POST /api/webhooks/resend`(수신 처리 단계) | 수신함 소유자(사용자) ID |

바인딩 API의 기간(`period`)은 10초 또는 60초만 지원해 "분당 N회"만 표현할 수 있습니다(시간 단위 제한은 불가). 바인딩이 없는 환경(로컬 개발 등)이거나 호출이 실패하면 안전하게 허용합니다(`fail-open`) — 요청 제한 인프라 장애로 서비스 전체가 막히는 것을 막기 위함입니다. `npm run dev` 상태에서 20회 초과 요청 시 `429`가 오는 것을 직접 확인했습니다.

"메일 전송 요청 제한"은 ProPaid에 아직 발신 메일 기능이 없어(입금 알림 등은 사용자가 직접 복사해 보내는 초안 생성기만 있음), 대신 수신 메일 처리(웹훅 트리거 → Claude 분석) 쪽에 남용 방지 제한을 걸었습니다. 실제 발신 메일 기능이 생기면 같은 방식으로 제한을 추가하면 됩니다.

## 4. CSRF 및 OAuth state 검증 — 이미 만족함 + 보강

- **API 자체는 쿠키를 쓰지 않습니다.** 인증은 `Authorization: Bearer <JWT>` 헤더뿐이고 세션 쿠키가 없으므로, 브라우저가 자동으로 자격 증명을 실어 보내는 전통적 CSRF(위조 폼 제출)가 구조적으로 성립하지 않습니다. 공격 페이지가 피해자 대신 요청을 보내려면 JS로 `localStorage`의 토큰을 읽어야 하는데, 이는 CSRF가 아니라 별개 취약점(XSS)의 영역입니다.
- **OAuth `state` 파라미터**는 Notion·Google 각각 HMAC 서명 + 10분 만료로 검증합니다(`notion.ts`/`google.ts`의 `createXState`/`verifyXState`). 콜백에서 상태가 없거나 서명이 틀리거나 만료되면 거부합니다 — 이것이 OAuth 흐름 자체의 CSRF 방어입니다.
- **PKCE(Notion 권장 사항)는 의도적으로 추가하지 않았습니다.** ProPaid의 Notion 연동은 `client_secret`을 가진 confidential client이고 redirect_uri도 Notion에 등록된 값과 정확히 일치해야만 동작합니다. PKCE의 핵심 이득(인가 코드를 가로챈 제3자가 client_secret 없이도 토큰을 교환하는 것을 막음)은 이미 client_secret으로 확보되어 있어, 상태 파라미터에 code_verifier를 얹는 방식으로 억지로 구현하면 오히려 verifier가 상태값과 함께 브라우저·리퍼러에 노출되어 실질적 이득이 없다고 판단했습니다. 별도 저장소(KV 등) 없이 안전하게 verifier를 보관할 방법이 생기면 재검토할 수 있습니다.

## 5. Notion·Google 토큰 만료와 재인증 처리 — 구현함(보강)

기존에도 액세스 토큰 만료 시 리프레시 토큰으로 자동 갱신했지만, **리프레시 토큰 자체가 만료·철회된 경우**를 제대로 처리하지 않았습니다(에러만 던지고 연결 정보는 DB에 그대로 남아 `/api/integrations/*/status`가 계속 "연결됨"으로 잘못 보고).

- `google.ts`에 `GoogleReauthRequiredError`를 추가해 되돌릴 수 없는 갱신 실패를 구분하고, Calendar 동기화 라우트에서 이 에러를 잡으면 `google_connections` 행을 삭제한 뒤 `409`와 함께 "다시 연결해주세요" 메시지를 반환합니다.
- Notion 내보내기 라우트도 리프레시 시도가 실패하면(`refreshed.ok`가 아니거나 토큰이 없으면) `notion_connections` 행을 삭제하고 동일하게 `409`를 반환합니다.
- 두 경우 모두 `/api/integrations/notion/status`, `/api/integrations/google/status`가 즉시 "연결 안 됨"을 정확히 보고하게 되어, 프런트엔드가 재연결 유도 UI를 자연스럽게 보여줄 수 있습니다.

## 6. 암호화 키 버전 관리와 교체 — 구현함

기존에는 Notion·Google 토큰 암호화 키를 **로그인 서명용 `JWT_SECRET`에서 파생**해 썼습니다 — `JWT_SECRET`을 교체하면(예: 유출 대응) 기존에 저장된 모든 연동 토큰이 즉시 복호화 불가능해지는 구조였습니다.

`worker/src/token-crypto.ts`로 통합하고 버전 스킴을 도입했습니다.

- 저장 형식에 `v{N}:` 접두사를 붙입니다. 접두사가 없는 기존 값은 "레거시 v1"로 간주해 예전과 동일하게 `JWT_SECRET` 파생 키로만 복호화합니다(새로 저장할 때는 쓰지 않음).
- 이번 배포부터 새로 저장되는 값은 `v2`를 사용하며, 전용 시크릿 `TOKEN_ENCRYPTION_KEY_V2`(권장, 미등록 시 `JWT_SECRET`으로 대체하고 경고 로그를 남김)로 파생한 키를 씁니다.
- **회전 절차**: ① `TOKEN_ENCRYPTION_KEY_V{N+1}` 시크릿을 새로 등록 → ② `token-crypto.ts`의 `CURRENT_KEY_VERSION`을 올려 배포 → ③ 이후 사용자가 재연결하거나 토큰이 자동 갱신될 때마다(리프레시 시점) 새 키로 자연스럽게 재암호화됩니다. 옛 버전 시크릿(`TOKEN_ENCRYPTION_KEY_V{N}`)은 모든 데이터가 재암호화될 때까지 계속 보관해야 합니다(삭제하면 아직 옛 키로 남아있는 행을 복호화하지 못합니다).
- D1 스키마 변경이나 마이그레이션이 필요 없는 설계입니다.

## 7. R2 파일에 공개 URL 사용 금지 — 이미 만족함

`wrangler.jsonc`의 `r2_buckets`(`propaid-evidence`, `propaid-backups`)에는 공개 접근(`r2.dev` 서브도메인, 커스텀 도메인)을 켜는 설정이 전혀 없습니다. 두 버킷 모두 Worker 바인딩을 통해서만 접근 가능하며, 증빙 파일은 반드시 `/api/expenses/:id/evidence` API(JWT 인증 + 소유권 검사)를 거쳐야만 내려받을 수 있습니다.

## 8. 다운로드 시 짧은 유효기간의 서명 URL 사용 — 설계상 더 강한 방식으로 대체

현재 프런트엔드(`frontend/src/api/finance.ts`)는 증빙 파일을 `Authorization` 헤더가 포함된 인증 요청으로 받아 Blob으로 변환한 뒤 다운로드합니다. 이는 서명 URL보다 **더 엄격합니다**:

- 서명 URL은 한번 발급되면 그 URL을 아는 누구나 유효기간 내에는 재인증 없이 접근할 수 있습니다.
- 현재 방식은 **매 다운로드마다** 살아있는 JWT + 실시간 소유권 검사를 요구합니다. URL이 유출돼도(애초에 그런 URL이 없음) 재사용할 수 없습니다.

따라서 별도의 단기 서명 URL 발급 기능은 추가하지 않았습니다. 다운로드 트래픽이 커져 Worker를 경유하는 비용이 부담되는 시점이 오면, 그때 R2 presigned URL 발급을 검토하는 편이 낫다고 판단했습니다(지금 추가하면 오히려 보안 수준을 낮추는 트레이드오프이기 때문).

## 9. Resend 웹훅 서명과 재전송 검증 — 이미 만족함

`verifyWebhook()`(`index.ts`)이 이미 아래를 모두 수행합니다.

- **서명 검증**: `svix-signature` 헤더를 웹훅 시크릿으로 HMAC-SHA256 검증.
- **재전송(replay) 방어**: `svix-timestamp`가 현재 시각과 5분(300초) 이상 차이나면 거부 — 오래된 요청을 나중에 재전송해도 통과하지 못합니다.
- **중복 처리 방지**: `svix_id`(웹훅 전달 고유 ID) 또는 `resend_email_id`가 이미 처리된 경우 별도로 감지해 재처리하지 않습니다(정상적인 중복 전달과 재전송 공격을 모두 무해화).

## 10. 관리자 기능 접근 기록 — 구현함

`/api/admin/*` 미들웨어에서 모든 접근 시도(성공·실패 모두)를 구조화 로그로 남기도록 했습니다 — `경로`, `메서드`, `클라이언트 IP`, `요청 허용 여부`, `request_id`를 포함합니다. 지난 대화에서 다룬 [운영 로그/Workers Logs](OBSERVABILITY.md) 인프라를 그대로 재사용해, 별도의 D1 감사 테이블 없이 Cloudflare 대시보드에서 검색·보존할 수 있게 했습니다.

## 11. 운영·개발용 Secret 분리 — 체크리스트(기존 구조가 이미 이 원칙을 따름)

- 로컬 비밀값은 Git에서 제외되는 `worker/.dev.vars`에만 두고, 운영 비밀값은 `wrangler secret put`으로 Cloudflare에 등록합니다(로컬 파일에 존재하지 않음). 이 둘은 물리적으로 다른 저장소입니다.
- **지켜야 할 규칙**(코드가 강제하지는 않으므로 운영 규율로 관리):
  - 로컬 `.dev.vars`에만 쓰는 값(테스트용 `JWT_SECRET` 등)을 운영 `wrangler secret put`에 그대로 복사하지 않는다.
  - 반대로 운영 비밀값을 로컬 `.dev.vars`에 붙여넣지 않는다(실수로 커밋될 위험, 로컬 로그에 노출될 위험).
  - 한 값이 두 환경 중 하나에라도 유출 의심이 되면 그 환경의 값만 교체하고, 다른 환경 값과 절대 공유하지 않았는지 재확인한다.
  - `ADMIN_TOKEN`, `TOKEN_ENCRYPTION_KEY_V2`, `TURNSTILE_SECRET_KEY` 등 이번에 추가된 값들도 동일한 원칙을 따른다.

## Cloudflare Turnstile — 구현함(서버 측 검증 포함), 프런트 위젯은 사이트 키 등록 후 활성화

"회원가입·문의·분석 요청"의 자동화 남용 방지 요청 중, ProPaid에는 전통적 회원가입 폼(가입은 Google OAuth 전용)과 문의 폼이 아직 없어 실제로 적용 가능한 곳은 **제안 분석 요청**(`POST /api/proposals/preview`)뿐입니다. 여기에 적용했습니다.

- **서버 측 검증**(`worker/src/turnstile.ts`): 브라우저 위젯 통과만으로는 신뢰하지 않고, 반드시 Cloudflare `siteverify` API로 토큰을 재검증합니다. `TURNSTILE_SECRET_KEY`가 설정되지 않은 환경(로컬 개발, 아직 Turnstile 사이트를 만들지 않은 경우)에서는 검증을 건너뛰어 기존 흐름을 막지 않습니다.
- **프런트 위젯**(`frontend/src/components/TurnstileWidget.tsx`): `VITE_TURNSTILE_SITE_KEY`가 설정된 경우에만 렌더링됩니다. 위젯을 통과하기 전에는 "분석 미리보기" 버튼이 비활성화됩니다.
- **활성화 방법**: Cloudflare 대시보드 → Turnstile에서 사이트를 만들고, 사이트 키는 프런트 빌드 환경변수 `VITE_TURNSTILE_SITE_KEY`로, 시크릿 키는 Worker 시크릿 `TURNSTILE_SECRET_KEY`로 등록하면 즉시 적용됩니다(코드 변경 불필요). 등록 전에는 지금처럼 위젯 없이 동작합니다.
