# 데이터 백업과 복구 절차

Cloudflare D1의 Time Travel은 "자동으로 백업된다"는 안심을 주지만, 다음 두 가지 한계가 있습니다.

- **보관 기간이 짧고 고정돼 있다**: 무료 플랜 7일, 유료 플랜 30일. 그 이후 시점으로는 되돌릴 수 없습니다.
- **Cloudflare 시스템 안에서만 유효하다**: 계정 잠김, 리전 장애, Cloudflare 측 사고 등 D1 자체에 접근할 수 없는 상황에서는 쓸모가 없습니다.

그래서 ProPaid는 Time Travel 외에 **매일 자체 백업(R2)**, **마이그레이션 직전 별도 백업**, **월간 복구 훈련**을 추가로 운영합니다. 이 문서는 그 절차와 실제 명령어를 담은 운영 런북입니다.

## 요약

| 계층 | 방식 | 보관 기간 | 자동/수동 |
| --- | --- | --- | --- |
| 1차 방어선 | Cloudflare D1 Time Travel | 무료 7일 / 유료 30일 | 자동(Cloudflare 관리) |
| 2차 방어선 | 매일 D1 → R2 JSON 내보내기 | 90일 | 자동(Cron) |
| 3차 방어선 | 마이그레이션 직전 SQL 내보내기 | 사람이 보관 | 자동 트리거(수동 실행 시) |
| 검증 | 월간 복구 훈련 스크립트 | — | 자동화 가능(권장) |
| 검증 | Time Travel 실복구 훈련 | — | 수동(분기 1회 권장) |

---

## 1. D1 Time Travel 사용법

### 1-1. 현재 시점(또는 과거 시점)의 북마크 확인

```bash
cd worker
npx wrangler d1 time-travel info propaid --remote
# 특정 시점을 지정하려면:
npx wrangler d1 time-travel info propaid --remote --timestamp="2026-08-14T09:00:00Z"
```

북마크는 D1이 특정 시점을 가리키는 결정론적 식별자입니다. 같은 타임스탬프는 항상 같은 북마크를 만들어냅니다.

### 1-2. 특정 시점으로 복구

```bash
npx wrangler d1 time-travel restore propaid --remote --timestamp="2026-08-14T09:00:00Z"
# 또는 북마크로:
npx wrangler d1 time-travel restore propaid --remote --bookmark=<BOOKMARK>
```

**⚠️ 이 명령은 매우 파괴적입니다.**

- 운영 DB를 **그 자리에서(in-place)** 덮어씁니다. 새 DB를 만드는 게 아니라 지금의 `propaid` DB 자체가 과거 상태로 바뀝니다.
- 진행 중인 쿼리·트랜잭션은 즉시 취소됩니다.
- 스키마를 포함한 전체 데이터베이스가 대상입니다(특정 테이블만 복구 불가).
- 되돌리기 전 상태로 다시 복구할 수 있는 "복구 전 북마크"를 응답으로 돌려줍니다 — 실수했다면 그 북마크로 다시 복구하세요.
- Wrangler가 확인 프롬프트를 띄웁니다. 실제 운영 DB에 실행하기 전, 정말 이 시점이 맞는지 다시 확인하세요.

**따라서 이 명령을 정기 자동화 스크립트에 넣지 않습니다.** 사람이 상황을 보고 판단해서 실행하는 비상 절차로만 사용합니다(§5-1).

### 1-3. 참고: 마이그레이션 적용 시 자동 북마크

`wrangler d1 migrations apply propaid --remote`를 실행하면 Wrangler가 적용 직전 시점의 백업(북마크)을 **자동으로** 남깁니다(비대화형 환경에서도 동일). 다만 이건 여전히 Time Travel 보관 기간 안에서만 유효하므로, §3의 별도 백업이 함께 필요합니다.

---

## 2. 매일 D1 → R2 자체 백업 (자동)

`worker/src/backup.ts`의 `runDailyBackup()`이 기존 일일 Cron(`worker/src/cron.ts`, 매일 UTC 18:00 = KST 03:00)에 포함되어 실행됩니다.

- `sqlite_master`를 조회해 **모든 사용자 테이블을 자동으로 찾아** 내보냅니다. 새 마이그레이션으로 테이블이 추가돼도 코드 수정 없이 함께 백업됩니다.
- 각 테이블을 순수 JSON 배열로 직렬화해 `propaid-backups` R2 버킷에 저장합니다.
  - 날짜별: `d1/YYYY-MM-DD/<table>.json`, `d1/YYYY-MM-DD/manifest.json`
  - 최신본 고정 키: `d1/latest/<table>.json`, `d1/latest/manifest.json` (복구 스크립트가 항상 이 경로를 사용)
- **90일** 지난 날짜별 백업은 자동으로 정리됩니다(`latest/`는 항상 유지).
- Notion·Google 연동 토큰은 D1에 이미 암호화된 상태로 저장돼 있으므로, 백업에도 암호문 그대로 담깁니다(추가 암호화 불필요).
- `propaid-backups` 버킷이 아직 없다면 먼저 만들어야 합니다: `npx wrangler r2 bucket create propaid-backups`

### 백업 목록/내용 확인 (관리자 API)

사용자 로그인과 무관한 별도 토큰(`ADMIN_TOKEN` 시크릿)으로 보호되는 조회 전용 API입니다.

```bash
curl -s https://propaid-api.ionjk2879.workers.dev/api/admin/backups \
  -H "X-Admin-Token: $ADMIN_TOKEN"
# {"dates":["2026-08-15","2026-08-14", ...]}

curl -s https://propaid-api.ionjk2879.workers.dev/api/admin/backups/latest/manifest \
  -H "X-Admin-Token: $ADMIN_TOKEN"
# {"exportedAt":"...", "tables":["deals","expenses", ...]}

curl -s https://propaid-api.ionjk2879.workers.dev/api/admin/backups/latest/deals \
  -H "X-Admin-Token: $ADMIN_TOKEN" -o deals-latest.json
```

`ADMIN_TOKEN`은 운영 환경에 `wrangler secret put ADMIN_TOKEN`으로 등록하는 충분히 긴 무작위 값이어야 합니다. 이 값은 백업을 읽을 수 있는 사실상의 관리자 키이므로 코드나 저장소에 남기지 말고, 비밀번호 관리자 등에만 보관하세요.

---

## 3. 마이그레이션 직전 백업 (자동 트리거)

`worker/package.json`에 `predb:remote` 훅이 있어, `npm run db:remote`(= `wrangler d1 migrations apply propaid --remote`)를 실행하면 **그 전에 자동으로** 아래가 먼저 실행됩니다.

```bash
npm run db:remote
# 내부적으로: predb:remote → node scripts/backup-d1.mjs → db:remote
```

`scripts/backup-d1.mjs`가 하는 일:

1. `wrangler d1 export propaid --remote`로 스키마+데이터 전체를 `worker/backups/propaid-<타임스탬프>.sql`에 저장 (사람이 어디서든 읽을 수 있는 순수 SQL 파일).
2. `wrangler d1 time-travel info propaid --remote`로 지금 이 순간의 북마크를 출력(§1-3의 자동 북마크와 별개로, 실행 로그에 남겨 나중에 참고할 수 있도록).

`worker/backups/`는 `.gitignore`에 포함돼 있어 저장소에 커밋되지 않습니다(개인정보가 담긴 원본 덤프이므로). **내려받은 `.sql` 파일은 로컬 디스크 밖(별도 백업 저장소나 비밀번호 관리자의 파일 첨부 등)에도 최소 1부 보관하는 것을 권장합니다** — 개발 머신 하나가 고장 나면 이 파일도 함께 사라지기 때문입니다.

수동으로 아무 때나 백업만 받고 싶다면:

```bash
npm run backup:remote
```

---

## 4. R2 증빙 파일(비용 영수증 등) 보존 정책

- 증빙 파일(`propaid-evidence` 버킷)은 **자동 만료를 두지 않습니다.** 세무 신고·소명 자료로 장기간 필요할 수 있는 사용자 데이터이기 때문에, 임의로 지우면 오히려 사고입니다.
- 삭제되는 시점은 명확히 두 가지뿐입니다:
  1. 사용자가 해당 비용 내역을 삭제할 때(`DELETE /api/expenses/:id`가 연결된 R2 객체도 함께 삭제)
  2. 회원 탈퇴가 완료될 때(유예 기간 포함, `purgeUserEvidence()` — `docs/PRIVACY_POLICY.md` §4 참고)
- 접근은 항상 로그인한 본인만 인증된 API로만 가능하며, 공개 URL을 생성하지 않습니다(`Cache-Control: private, no-store`).
- 증빙 파일 자체는 §2의 일일 D1 백업 대상이 아닙니다(바이너리라 JSON 스냅샷에 포함되지 않음). R2 버킷 자체의 재해 복구가 필요하다면 Cloudflare의 R2 버킷 간 복제(inter-bucket replication)나 정기적인 `wrangler r2 object get`을 통한 별도 아카이빙을 검토하세요. 현재 규모(소규모 개인 서비스)에서는 우선순위를 낮게 둡니다.

---

## 5. 복구 절차

### 5-1. Time Travel로 되돌리기 (최근 7~30일 이내, 비상 상황)

DB 손상, 잘못된 마이그레이션, 대량 오삭제 등 **최근** 사고에 가장 빠른 대응입니다.

```bash
cd worker
# 1. 되돌릴 시점을 정하고 북마크 확인
npx wrangler d1 time-travel info propaid --remote --timestamp="2026-08-14T09:00:00Z"

# 2. 복구 실행 (파괴적 — §1-2의 경고를 반드시 읽을 것)
npx wrangler d1 time-travel restore propaid --remote --timestamp="2026-08-14T09:00:00Z"

# 3. 서비스 정상 동작 확인
curl -s https://propaid-api.ionjk2879.workers.dev/api/health
```

### 5-2. SQL 백업 파일로 새 DB 복원 (Time Travel 기간이 지났거나, 별도 환경에서 확인하고 싶을 때)

```bash
cd worker
# 새 D1(또는 로컬)에 스키마부터 생성
npx wrangler d1 migrations apply propaid --local --persist-to=.wrangler-restore
# 백업 SQL 적용
npx wrangler d1 execute propaid --local --persist-to=.wrangler-restore --file=backups/propaid-<타임스탬프>.sql
```

운영 DB 자체를 이 파일로 되돌려야 하는 극단적 상황(D1 자체가 사라진 경우 등)이라면, 새 D1 데이터베이스를 만들고(`wrangler d1 create propaid-restored`) 위와 같이 복원한 뒤 `wrangler.jsonc`의 `database_id`를 교체하고 재배포합니다.

### 5-3. 일일 R2 백업(JSON)으로 복원

§6의 복구 훈련 스크립트가 바로 이 절차를 자동으로 수행합니다. 수동으로 특정 테이블만 살펴보고 싶다면 §2의 관리자 API로 JSON을 내려받아 직접 확인하세요.

---

## 6. 월간 복구 훈련

"백업이 있다"와 "복구가 실제로 된다"는 다른 문제입니다. `worker/scripts/restore-drill.mjs`는 **운영 DB를 전혀 건드리지 않고** 다음을 자동으로 검증합니다.

1. 관리자 API로 최신 R2 백업(`d1/latest/*`)을 내려받는다.
2. 완전히 격리된 로컬 D1(`.wrangler-restore-drill/`, 이 저장소의 개발용 DB와도 별개)에 현재 마이그레이션으로 스키마를 새로 만든다.
3. 백업 데이터를 외래키 순서(부모 → 자식)에 맞춰 삽입한다.
4. 테이블별 행 수가 백업과 일치하는지, `PRAGMA foreign_key_check`에 위반이 없는지 확인한다.
5. 성공하면 스크래치 디렉터리를 정리하고 종료 코드 0, 실패하면 디렉터리를 남겨두고 종료 코드 1을 반환한다.

```bash
cd worker
PROPAID_ADMIN_BASE_URL=https://propaid-api.ionjk2879.workers.dev \
PROPAID_ADMIN_TOKEN=$ADMIN_TOKEN \
npm run restore:drill
```

**월 1회 이상 실행하는 것을 권장합니다.** 이 저장소 안에서 실행하는 한 잊어버리기 쉬우므로, `/schedule` 스킬로 매월 자동 실행되는 클라우드 루틴을 만들어 결과를 보고받도록 설정할 수 있습니다(관리자 토큰을 클라우드 실행 환경의 시크릿으로 등록해야 함 — 원하시면 별도로 설정해드립니다).

### 6-1. Time Travel 실복구 훈련 (분기 1회 권장, 수동)

§5-1 절차를 실제로 한 번 실행해보는 훈련입니다. **운영 DB를 그 자리에서 덮어쓰는 파괴적 작업이므로 자동화하지 않고, 트래픽이 적은 시간에 사람이 직접 수행합니다.**

1. 복구 직전 시점의 북마크를 기록해둔다(`time-travel info`, 되돌리기용).
2. "5분 전" 정도의 아주 가까운 과거 시점으로 실제 `restore`를 실행해본다(데이터 손실을 최소화하면서 메커니즘 자체를 검증).
3. 서비스가 정상 응답하는지, 데이터가 기대한 시점 상태인지 확인한다.
4. 필요하면 1번에서 기록한 북마크로 즉시 되돌린다.

---

## 7. 운영 DB와 개발 DB 분리

- **로컬 개발(`wrangler dev`, `npm run db:local`)은 이미 운영 DB와 완전히 분리돼 있습니다.** `--local` 플래그(또는 플래그 없는 기본 `wrangler dev`)는 `.wrangler/state`에 있는 로컬 SQLite 파일을 사용하며, `--remote`를 명시하지 않는 한 운영 D1에는 어떤 요청도 가지 않습니다. 이 문서의 모든 테스트도 로컬 DB에서만 수행했습니다.
- 다만 지금은 "로컬 ↔ 운영" 2단계뿐이고, 마이그레이션을 운영에 적용하기 전에 운영과 동일한 조건(진짜 원격 D1, 진짜 네트워크 지연)에서 미리 검증할 **별도의 원격 스테이징 DB는 없습니다.**
- 필요하다면 다음으로 스테이징 환경을 추가할 수 있습니다(운영 DB와 별개의 새 Cloudflare 리소스를 만드는 작업이라 실행 전 확인이 필요합니다):
  ```bash
  npx wrangler d1 create propaid-staging
  ```
  이후 `wrangler.jsonc`에 `env.staging` 블록을 추가해 `database_id`만 스테이징 DB로 바꾼 바인딩을 구성하고, `wrangler d1 migrations apply propaid-staging --remote --env=staging`으로 운영에 적용하기 전 먼저 검증합니다.
- 현재는 1인 운영 규모상 로컬 분리만으로도 충분하다고 보지만, 팀이 커지거나 마이그레이션 위험도가 올라가면 스테이징 DB 도입을 권장합니다.

---

## 8. 필요한 시크릿/설정 정리

| 이름 | 위치 | 용도 |
| --- | --- | --- |
| `ADMIN_TOKEN` | `wrangler secret put ADMIN_TOKEN` (운영) / `worker/.dev.vars` (로컬) | `/api/admin/backups/*` 조회 인증, 복구 훈련 스크립트가 사용 |
| `propaid-backups` R2 버킷 | `wrangler r2 bucket create propaid-backups` | 일일 D1 백업 저장 위치 |
| `worker/backups/*.sql` | 로컬 디스크(gitignore됨) | 마이그레이션 직전 수동 백업 산출물 — 로컬 밖에도 1부 보관 권장 |
