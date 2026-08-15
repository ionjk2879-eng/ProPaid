// 월간 복구 훈련: 매일 R2에 쌓이는 최신 백업(backup.ts)을 실제로 내려받아, 이 저장소를 건드리지
// 않는 완전히 별도의 로컬 D1(scratch persist 디렉터리)에 복원한 뒤 정합성을 검증한다.
// 운영 DB에는 어떤 영향도 주지 않는다 — Time Travel 자체를 훈련하려면 docs/BACKUP_AND_RECOVERY.md의
// "Time Travel 복구 훈련(수동)" 절차를 사람이 직접 수행해야 한다(운영 DB를 되돌리는 파괴적 작업이라 자동화하지 않음).
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const DB_NAME = 'propaid';
const PERSIST_DIR = '.wrangler-restore-drill';
const DATA_FILE = '.wrangler-restore-drill-data.sql';
// 외래키 제약을 지키려면 부모 테이블(users)부터 자식 테이블 순으로 삽입해야 한다.
const TABLE_ORDER = ['users', 'user_plans', 'auth_identities', 'notion_connections', 'google_connections', 'deals', 'expenses', 'subscriptions', 'inbound_emails'];
const tableSortIndex = (table) => { const i = TABLE_ORDER.indexOf(table); return i === -1 ? TABLE_ORDER.length : i; };

const baseUrl = process.env.PROPAID_ADMIN_BASE_URL;
const adminToken = process.env.PROPAID_ADMIN_TOKEN;

if (!baseUrl || !adminToken) {
  console.error('PROPAID_ADMIN_BASE_URL과 PROPAID_ADMIN_TOKEN 환경변수가 필요합니다.');
  console.error('예: PROPAID_ADMIN_BASE_URL=https://propaid-api.ionjk2879.workers.dev PROPAID_ADMIN_TOKEN=xxxx node scripts/restore-drill.mjs');
  process.exit(2);
}

async function fetchJson(path) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { 'X-Admin-Token': adminToken } });
  if (!res.ok) throw new Error(`백업을 가져오지 못했습니다 (${path}): HTTP ${res.status}`);
  return res.json();
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function run(command, options = {}) {
  console.log(`$ ${command}`);
  return execSync(command, { stdio: options.silent ? 'pipe' : 'inherit', encoding: 'utf8' });
}

function runJson(command) {
  const output = execSync(command, { encoding: 'utf8' });
  return JSON.parse(output);
}

async function main() {
  console.log(`\n[1/5] 최신 백업 목록 확인 (${baseUrl})`);
  const { dates } = await fetchJson('/api/admin/backups');
  if (!dates?.length) throw new Error('아직 저장된 백업이 없습니다. 최소 하루가 지난 뒤 다시 시도하세요.');
  console.log(`사용 가능한 백업 날짜: ${dates.slice(0, 5).join(', ')}${dates.length > 5 ? ' ...' : ''}`);

  console.log('\n[2/5] 최신 백업 내려받기 (latest/)');
  const manifest = await fetchJson('/api/admin/backups/latest/manifest');
  console.log(`백업 시각: ${manifest.exportedAt} / 테이블 ${manifest.tables.length}개`);
  const tableRows = {};
  for (const table of manifest.tables) {
    tableRows[table] = await fetchJson(`/api/admin/backups/latest/${table}`);
    console.log(`  - ${table}: ${tableRows[table].length}행`);
  }

  console.log(`\n[3/5] 격리된 로컬 D1(${PERSIST_DIR})에 스키마 생성`);
  rmSync(PERSIST_DIR, { recursive: true, force: true });
  mkdirSync(PERSIST_DIR, { recursive: true });
  run(`npx wrangler d1 migrations apply ${DB_NAME} --local --persist-to=${PERSIST_DIR}`);

  console.log('\n[4/5] 백업 데이터 삽입');
  const statements = [];
  const orderedTables = Object.entries(tableRows).sort(([a], [b]) => tableSortIndex(a) - tableSortIndex(b));
  for (const [table, rows] of orderedTables) {
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    const columnList = columns.map((c) => `"${c}"`).join(', ');
    for (const row of rows) {
      const values = columns.map((c) => sqlLiteral(row[c])).join(', ');
      statements.push(`INSERT INTO "${table}" (${columnList}) VALUES (${values});`);
    }
  }
  writeFileSync(DATA_FILE, statements.join('\n'), 'utf8');
  run(`npx wrangler d1 execute ${DB_NAME} --local --persist-to=${PERSIST_DIR} --file=${DATA_FILE}`);

  console.log('\n[5/5] 정합성 검증');
  let failed = false;

  for (const [table, rows] of Object.entries(tableRows)) {
    const result = runJson(`npx wrangler d1 execute ${DB_NAME} --local --persist-to=${PERSIST_DIR} --command="SELECT COUNT(*) as n FROM \\"${table}\\";" --json`);
    const actual = result[0]?.results?.[0]?.n ?? -1;
    const expected = rows.length;
    const ok = actual === expected;
    if (!ok) failed = true;
    console.log(`  ${ok ? '✓' : '✗'} ${table}: 기대 ${expected}행 / 실제 ${actual}행`);
  }

  const fkResult = runJson(`npx wrangler d1 execute ${DB_NAME} --local --persist-to=${PERSIST_DIR} --command="PRAGMA foreign_key_check;" --json`);
  const fkViolations = fkResult[0]?.results ?? [];
  if (fkViolations.length) {
    failed = true;
    console.log(`  ✗ 외래키 정합성: 위반 ${fkViolations.length}건`);
  } else {
    console.log('  ✓ 외래키 정합성: 위반 없음');
  }

  if (failed) {
    console.error(`\n❌ 복구 훈련 실패 — 백업 데이터나 복원 절차를 점검하세요. (검사용 DB는 ${PERSIST_DIR}에 남겨두었습니다.)`);
    process.exit(1);
  }

  rmSync(PERSIST_DIR, { recursive: true, force: true });
  rmSync(DATA_FILE, { force: true });
  console.log('\n✅ 복구 훈련 성공 — 최신 백업으로부터 전체 복원과 정합성 검증을 마쳤습니다.');
}

main().catch((error) => {
  console.error('\n❌ 복구 훈련 중 오류:', error.message);
  process.exit(1);
});
