// 운영 D1 마이그레이션을 적용하기 전에 실행되는 독립 백업.
// wrangler는 `d1 migrations apply --remote` 실행 시 Time Travel 북마크를 자동으로 남기지만,
// 그건 Cloudflare 시스템 안(무료 7일/유료 30일)에서만 유효하다. 여기서는 그와 별개로
// 사람이 내려받아 어디서든 복원할 수 있는 SQL 백업 파일을 남기고, 참고용으로 현재
// Time Travel 북마크도 함께 기록한다.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const DB_NAME = 'propaid';

function run(command) {
  console.log(`$ ${command}`);
  execSync(command, { stdio: 'inherit' });
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync('backups', { recursive: true });
const output = `backups/propaid-${stamp}.sql`;

console.log(`\n[1/2] 운영 D1(${DB_NAME})을 ${output} 로 내보냅니다...`);
run(`npx wrangler d1 export ${DB_NAME} --remote --output=${output}`);

console.log('\n[2/2] 현재 시점의 Time Travel 북마크를 기록합니다 (문제가 생기면 이 시점으로 되돌릴 수 있습니다)...');
run(`npx wrangler d1 time-travel info ${DB_NAME}`);

console.log(`\n백업 완료: ${output}`);
console.log('이 파일을 안전한 곳(로컬 밖)에도 보관하는 것을 권장합니다. backups/ 디렉터리는 git에 커밋되지 않습니다.');
