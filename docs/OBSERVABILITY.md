# 운영 로그와 장애 알림

`wrangler tail`을 계속 지켜보지 않아도 API 오류율, 응답 시간, 외부 연동 실패, AI 분석 비용을 확인하고
급증한 실패를 자동으로 알림받을 수 있도록 구성했습니다.

## 자동 수집 항목 (Cloudflare Analytics Engine)

`METRICS` 바인딩(`propaid_metrics` 데이터셋)에 아래 이벤트를 기록합니다. Analytics Engine 데이터셋은
바인딩을 등록해두면 첫 기록 시 자동 생성되며, 별도 프로비저닝은 필요 없습니다.

| 이벤트(`blob1`) | 기록 위치 | 담긴 내용 |
| --- | --- | --- |
| `api_request` | 전역 미들웨어(`index.ts`) | 경로, 메서드, 상태 코드, 응답 시간(ms), 오류 여부, 사용자 ID |
| `webhook_resend` | `/api/webhooks/resend` | `received`/`duplicate`/`ignored_unknown_recipient`/`failed` |
| `llm_analysis` | `llm.ts` `analyzeWithAdapter` | `claude`/`fallback`, 입력·출력 토큰 수, 추정 비용(USD), 사용자 ID |
| `notion_export` | `/api/deals/:id/notion` | `success`/`failed`, 사용자 ID |
| `calendar_sync` | `/api/deals/:id/calendar` | `success`/`failed`, 성공·실패 건수, 사용자 ID |
| `r2_upload` | `/api/expenses/:id/evidence` | `success`/`failed`, 사용자 ID |
| `d1_error` | `app.onError`(SQLite 오류 패턴 감지) | 경로, 오류 메시지 앞부분 |

이 표가 요청했던 10개 항목과 매핑되는 방식:

- **API 오류율 / 응답 시간** → `api_request`의 상태 코드와 `doubles[0]`(ms)
- **Resend 웹훅 실패** → `webhook_resend`의 `failed` 비율
- **Claude 분석 실패율 / 규칙 기반 폴백 비율** → `llm_analysis`의 `claude` 대 `fallback` 비율
- **Notion·Calendar 연동 실패** → `notion_export`/`calendar_sync`의 `failed` 비율
- **D1 쿼리 오류** → `d1_error`
- **R2 업로드 실패** → `r2_upload`의 `failed` 비율
- **사용자별 분석 건수와 비용** → `llm_analysis`를 사용자 ID(`index1`)로 묶어 `doubles[3]`(추정 USD) 합산

### 조회 방법

Cloudflare 대시보드 **Analytics Engine → propaid_metrics**에서 SQL로 직접 조회합니다(예시):

```sql
-- 최근 24시간 API 오류율
SELECT blob1 AS path, SUM(double2) AS errors, COUNT(*) AS total
FROM propaid_metrics
WHERE blob1 = 'api_request' AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY blob1 ORDER BY errors DESC;

-- 사용자별 Claude 분석 비용(최근 7일)
SELECT index1 AS user_id, SUM(double4) AS cost_usd, COUNT(*) AS calls
FROM propaid_metrics
WHERE blob1 = 'llm_analysis' AND blob2 = 'claude' AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY index1 ORDER BY cost_usd DESC;
```

대시보드에서 계정 API 토큰으로 직접 쿼리하는 방식이며, Worker 코드 안에서는 조회할 수 없습니다(Analytics
Engine은 쓰기 전용 바인딩 + 별도 조회용 REST API 구조입니다).

Claude 분석 비용은 `ANTHROPIC_MODEL` 기본값(Claude Haiku 4.5, 입력 $1/M·출력 $5/M 토큰)을 기준으로
추정한 값입니다. 다른 모델로 바꾸면 `worker/src/llm.ts`의 단가 상수도 함께 바꿔야 정확합니다.

## 자동 장애 알림 (`ALERT_WEBHOOK_URL`)

Slack 또는 Discord Incoming Webhook URL을 `ALERT_WEBHOOK_URL` 시크릿으로 등록하면 아래 두 경우에
자동으로 알림이 전송됩니다. 등록하지 않으면 알림은 조용히 건너뜁니다(수집 자체는 계속됩니다).

1. **Notion·Calendar 연동 반복 실패** — 즉시 알림. 같은 거래의 내보내기/동기화가 3회 연속 실패한
   순간(`notion_export_attempts`/`calendar_sync_attempts`가 정확히 3이 되는 시점) 한 번만 보냅니다.
   그 이후 계속 실패해도 매번 다시 알리지는 않습니다.
2. **Resend 수신 메일 처리 실패 급증** — 매시간(`0 * * * *` cron) 최근 1시간 동안 새로 실패한
   건수가 3건 이상이면 알림을 보냅니다. 새 실패가 없으면 자동으로 조용해집니다(별도 해제 절차 없음).

### 자동 알림이 없는 항목

Claude 분석 실패율, D1 쿼리 오류, R2 업로드 실패, 전체 API 오류율은 위 표대로 **자동 수집**되지만
현재는 자동 알림이 걸려 있지 않습니다. Analytics Engine에 쌓인 데이터를 Worker의 `scheduled` 핸들러가
직접 집계하려면 별도의 Cloudflare API 토큰(Analytics Engine 조회 권한)이 필요해서, 이번 1차 구현에서는
D1에 이미 저장되는 신호(수신 메일 실패, Notion/Calendar 실패)만으로 알림을 구성했습니다. 나머지 항목은
위 대시보드 SQL로 필요할 때 확인하거나, 이후 요청 시 API 토큰을 추가해 알림 범위를 넓힐 수 있습니다.

### 요청 항목 중 해당 없음: 입금 알림 작업 실패

"입금 알림 작업 실패"는 이번 구현에서 다루지 않았습니다. 현재 ProPaid에는 입금 알림을 **자동으로 발송하는
서버 작업이 없습니다** — `OverdueWorkspace`가 밀린 거래를 보여주고 `DunningModal`이 안내 문구 초안을
만들어주지만, 실제 발송은 사용자가 직접 복사해 보내는 수동 절차입니다. 실패할 수 있는 자동 작업 자체가
없으므로 감시 대상도 없습니다. 만약 이 항목이 다른 기능(예: 자동 이메일 발송)을 의미했던 것이라면 알려주시면
그 기능부터 구현한 뒤 동일한 방식으로 감시를 추가하겠습니다.

## 새 환경 변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `ALERT_WEBHOOK_URL` | 아니오 | Slack/Discord Incoming Webhook URL. 없으면 알림 전송을 건너뜀 |

로컬 개발: `worker/.dev.vars`에 추가. 운영: `wrangler secret put ALERT_WEBHOOK_URL`.

Analytics Engine `METRICS` 바인딩은 시크릿이 아니라 `wrangler.jsonc`의 `analytics_engine_datasets`에
바인딩으로 등록되어 있으므로 별도 설정이 필요 없습니다.
