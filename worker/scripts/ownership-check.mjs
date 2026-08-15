// 다른 사용자의 리소스 ID를 넣어도 접근할 수 없는지(IDOR) 확인하는 회귀 테스트.
// 로컬 D1에 두 가짜 사용자(A, B)와 A 소유의 거래·비용·구독·수신 메일을 직접 심어 넣고,
// B의 JWT로 A의 리소스 ID를 대상으로 각 API를 호출해 전부 404(찾을 수 없음)인지 검사한다.
// 로컬 개발 DB만 건드리며, 끝나면(성공·실패 상관없이) 가짜 사용자 두 명을 삭제해 정리한다.
//
// 사용법:
//   1) 별도 터미널에서 로컬 서버 실행: cd worker && npm run dev
//   2) node scripts/ownership-check.mjs
//
// 참고: Calendar 동기화(/api/deals/:id/calendar)와 수신 메일 재시도(/api/inbox/messages/:id/retry)는
// 각각 Google 연결·RESEND_API_KEY가 먼저 확인되어 거래/메일 소유권 검사까지 도달하지 못하고
// 조건부로 끝나버리므로(가짜로 통과시키려면 실제 암호화된 연결을 만들어야 해 신뢰도가 낮음)
// 이 스크립트에서는 제외했다 — 코드 리뷰로 두 라우트 모두 `WHERE ... AND user_id = ?` 패턴을
// 동일하게 쓰는 것을 확인했다.
import { execSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const DB_NAME = 'propaid';
const BASE_URL = process.env.PROPAID_BASE_URL || 'http://localhost:8787';
const TMP_SQL_FILE = '.ownership-check-tmp.sql';

function readJwtSecret() {
  const text = readFileSync('.dev.vars', 'utf8');
  const line = text.split(/\r?\n/).find((l) => /^\s*JWT_SECRET\s*=/.test(l));
  if (!line) throw new Error('.dev.vars에서 JWT_SECRET을 찾을 수 없습니다. worker/.dev.vars.example을 복사해 설정했는지 확인하세요.');
  return line.split('=').slice(1).join('=').trim();
}

function execD1(sql) {
  writeFileSync(TMP_SQL_FILE, sql, 'utf8');
  try {
    const output = execSync(`npx wrangler d1 execute ${DB_NAME} --local --json --file=${TMP_SQL_FILE}`, { encoding: 'utf8' });
    return JSON.parse(output);
  } finally {
    rmSync(TMP_SQL_FILE, { force: true });
  }
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function createToken(userId, secret, tokenVersion = 1) {
  const enc = new TextEncoder();
  const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64url(enc.encode(JSON.stringify({ sub: String(userId), tv: tokenVersion, exp: Math.floor(Date.now() / 1000) + 3600 })));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

async function call(token, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

async function main() {
  const jwtSecret = readJwtSecret();
  console.log(`\n[1/4] 로컬 D1(${DB_NAME})에 테스트용 사용자 A·B와 A 소유 리소스를 생성합니다...`);

  const stamp = Date.now();
  const insert = execD1(`
    INSERT INTO users (email, password_hash, nickname, inbox_token) VALUES
      (${sqlLiteral(`ownership-a-${stamp}@example.invalid`)}, 'x', '오너십테스트A', ${sqlLiteral(`ownatest-a-${stamp}`)}),
      (${sqlLiteral(`ownership-b-${stamp}@example.invalid`)}, 'x', '오너십테스트B', ${sqlLiteral(`ownatest-b-${stamp}`)});
  `);
  // AUTOINCREMENT id를 직접 지정하지 않았으므로, 방금 만든 이메일로 다시 조회해 ID를 확실히 가져온다.
  const users = execD1(`SELECT id, email FROM users WHERE email LIKE ${sqlLiteral(`ownership-%-${stamp}@example.invalid`)} ORDER BY email;`)[0].results;
  const userA = users.find((u) => u.email.startsWith('ownership-a-'));
  const userB = users.find((u) => u.email.startsWith('ownership-b-'));
  if (!userA || !userB) throw new Error('테스트용 사용자 생성에 실패했습니다.');

  execD1(`
    INSERT INTO deals (user_id, client, raw_text, status) VALUES
      (${userA.id}, '오너십테스트 거래', '테스트', 'CONFIRMED'),
      (${userA.id}, '오너십테스트 삭제용 거래', '테스트', 'CONFIRMED');
    INSERT INTO expenses (user_id, title, amount, expense_date, category, usage_type) VALUES
      (${userA.id}, '오너십테스트 비용', 1000, '2026-01-01', '기타', 'BUSINESS'),
      (${userA.id}, '오너십테스트 삭제용 비용', 1000, '2026-01-01', '기타', 'BUSINESS');
    INSERT INTO subscriptions (user_id, service_name, amount, billing_cycle, usage_type) VALUES
      (${userA.id}, '오너십테스트 구독', 10000, 'MONTHLY', 'BUSINESS'),
      (${userA.id}, '오너십테스트 삭제용 구독', 10000, 'MONTHLY', 'BUSINESS');
    INSERT INTO inbound_emails (user_id, resend_email_id, svix_id, recipient, text_body, analysis) VALUES
      (${userA.id}, ${sqlLiteral(`ownership-email-${stamp}`)}, ${sqlLiteral(`ownership-svix-${stamp}`)}, 'inbox-a@zenuuxdoeu.resend.app', '테스트', '{"client":null,"dealType":null,"amount":null,"currency":null,"deliverables":[],"draftDueDate":null,"publishDueDate":null,"revisionCount":null,"secondaryUsage":null,"paymentCondition":null,"tasks":[],"risks":[],"startDate":null,"endDate":null,"paymentTerms":[],"matchedRules":[],"warnings":[]}');
  `);
  const dealRows = execD1(`SELECT id FROM deals WHERE user_id = ${userA.id} ORDER BY id;`)[0].results;
  const expenseRows = execD1(`SELECT id FROM expenses WHERE user_id = ${userA.id} ORDER BY id;`)[0].results;
  const subscriptionRows = execD1(`SELECT id FROM subscriptions WHERE user_id = ${userA.id} ORDER BY id;`)[0].results;
  const inboundRows = execD1(`SELECT id FROM inbound_emails WHERE user_id = ${userA.id} ORDER BY id;`)[0].results;
  const [dealId, deleteDealId] = dealRows.map((r) => r.id);
  const [expenseId, deleteExpenseId] = expenseRows.map((r) => r.id);
  const [subscriptionId, deleteSubscriptionId] = subscriptionRows.map((r) => r.id);
  const [inboundEmailId] = inboundRows.map((r) => r.id);

  console.log('[2/4] 사용자 B의 JWT를 발급합니다 (유효한 로그인 상태를 흉내냅니다)...');
  const tokenB = await createToken(userB.id, jwtSecret);

  console.log('[3/4] B의 토큰이 실제로 유효한지 먼저 확인합니다(그래야 아래 404 결과를 신뢰할 수 있습니다)...');
  const sanityStatus = await call(tokenB, 'GET', '/api/account/summary');
  if (sanityStatus !== 200) {
    throw new Error(`B 토큰으로 /api/account/summary 호출이 실패했습니다(HTTP ${sanityStatus}). ${BASE_URL}에서 wrangler dev가 실행 중인지, JWT_SECRET이 .dev.vars와 일치하는지 확인하세요.`);
  }

  console.log('\n[4/4] B의 토큰으로 A의 리소스 ID에 접근을 시도합니다 (전부 404가 나와야 안전합니다)...\n');
  const checks = [
    { name: '거래 상태 변경', method: 'PATCH', path: `/api/deals/${dealId}/status`, body: { status: 'PAID' } },
    { name: '거래 상세 수정', method: 'PATCH', path: `/api/deals/${dealId}`, body: {
      client: 'hacked', dealType: null, amount: null, deliverables: [], draftDueDate: null, publishDueDate: null,
      paymentDueDate: null, revisionCount: null, secondaryUsage: null, paymentCondition: null, tasks: [], risks: [] } },
    { name: '거래 Notion 내보내기', method: 'POST', path: `/api/deals/${dealId}/notion` },
    { name: '거래 삭제', method: 'DELETE', path: `/api/deals/${deleteDealId}` },
    { name: '비용 내역 수정', method: 'PUT', path: `/api/expenses/${expenseId}`, body: {
      title: 'hacked', amount: 1, expenseDate: '2026-01-01', category: '기타', usageType: 'BUSINESS',
      businessRatio: 100, evidenceType: 'NONE', deductionStatus: 'REVIEW' } },
    { name: '비용 증빙 다운로드', method: 'GET', path: `/api/expenses/${expenseId}/evidence` },
    { name: '비용 삭제', method: 'DELETE', path: `/api/expenses/${deleteExpenseId}` },
    { name: '구독 수정', method: 'PUT', path: `/api/subscriptions/${subscriptionId}`, body: {
      serviceName: 'hacked', amount: 1, billingCycle: 'MONTHLY', usageType: 'BUSINESS' } },
    { name: '구독 삭제', method: 'DELETE', path: `/api/subscriptions/${deleteSubscriptionId}` },
    { name: '수신 메일 분석 수정', method: 'PATCH', path: `/api/inbox/messages/${inboundEmailId}/analysis`, body: { client: 'hacked' } },
    { name: '수신 메일 거래로 저장', method: 'POST', path: `/api/inbox/messages/${inboundEmailId}/save`, body: {} },
  ];

  let failed = false;
  for (const check of checks) {
    const status = await call(tokenB, check.method, check.path, check.body);
    const ok = status === 404;
    if (!ok) failed = true;
    console.log(`  ${ok ? '✓' : '✗'} ${check.name} (${check.method} ${check.path}) → HTTP ${status}${ok ? '' : ' — 소유권 검사가 없거나 뚫렸을 수 있습니다!'}`);
  }

  console.log('\n정리: 테스트용 사용자 A·B와 그에 딸린 데이터를 삭제합니다 (외래키 CASCADE)...');
  execD1(`DELETE FROM users WHERE id IN (${userA.id}, ${userB.id});`);

  if (failed) {
    console.error('\n❌ 소유권 검사 실패 — 위에서 ✗로 표시된 API를 점검하세요.');
    process.exit(1);
  }
  console.log('\n✅ 모든 API가 다른 사용자의 리소스 ID를 404로 거부했습니다.');
}

main().catch((error) => {
  console.error('\n❌ 오너십 검사 중 오류:', error.message);
  process.exit(1);
});
