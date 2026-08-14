import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { analyzeProposal, type ProposalAnalysis } from './analyze';
import { analyzeWithAdapter } from './llm';
import { body, dealResponse, expenseResponse, getUser, subscriptionResponse, type AppContext } from './helpers';
import { createToken, hashPassword, randomToken, verifyPassword, verifyToken } from './security';
import { createNotionState, decryptNotionToken, encryptNotionToken, notionAppOrigin, notionHeaders, notionRedirectUri, verifyNotionState } from './notion';
import { createGoogleState, decryptGoogleToken, encryptGoogleToken, getGoogleAccessToken, googleAppOrigin, googleRedirectUri, verifyGoogleState, type GoogleConnection } from './google';
import type { Env, UserRow, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const encoder = new TextEncoder();

app.use('*', async (c, next) => cors({
  origin: c.env.APP_ORIGIN.split(',').map((value) => value.trim()),
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['Content-Disposition'],
})(c, next));

app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/') || c.req.path === '/api/health' || c.req.path === '/api/webhooks/resend' || c.req.path === '/api/integrations/notion/callback' || c.req.path === '/api/integrations/google/callback' || c.req.method === 'OPTIONS') return next();
  const authorization = c.req.header('Authorization');
  const userId = authorization?.startsWith('Bearer ') ? await verifyToken(authorization.slice(7), c.env.JWT_SECRET) : null;
  if (!userId) return c.json({ message: '로그인이 필요합니다.' }, 401);
  const user = await c.env.DB.prepare('SELECT id, email, nickname, inbox_token FROM users WHERE id = ?').bind(userId).first<UserRow>();
  if (!user) return c.json({ message: '사용자를 찾을 수 없습니다.' }, 401);
  c.set('user', user);
  return next();
});

app.onError((error, c) => {
  console.error(error);
  const message = error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
  return c.json({ message }, message.includes('찾을 수') ? 404 : 400);
});

app.get('/api/health', (c) => c.json({ status: 'ok', runtime: 'cloudflare-workers' }));

app.get('/api/integrations/notion/status', async (c) => {
  const row = await c.env.DB.prepare('SELECT workspace_id, workspace_name, root_page_id, root_page_url, setup_at, updated_at FROM notion_connections WHERE user_id = ?')
    .bind(getUser(c as AppContext).id).first<{ workspace_id: string; workspace_name: string | null; root_page_id: string | null; root_page_url: string | null; setup_at: string | null; updated_at: string }>();
  if (!row) return c.json({ connected: false, configured: false, workspaceId: null, workspaceName: null, rootPageUrl: null, updatedAt: null });
  const rawUrl = row.root_page_url;
  const rootPageUrl = row.root_page_id && (!rawUrl || !rawUrl.startsWith('https://'))
    ? `https://www.notion.so/${row.root_page_id.replace(/-/g, '')}`
    : rawUrl;
  if (rootPageUrl !== rawUrl) {
    await c.env.DB.prepare('UPDATE notion_connections SET root_page_url = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .bind(rootPageUrl, getUser(c as AppContext).id).run();
  }
  return c.json({ connected: true, configured: Boolean(row.setup_at), workspaceId: row.workspace_id,
    workspaceName: row.workspace_name, rootPageUrl, updatedAt: row.updated_at });
});

app.post('/api/integrations/notion/connect', async (c) => {
  if (!c.env.NOTION_CLIENT_ID || !c.env.NOTION_CLIENT_SECRET) {
    return c.json({ message: 'Notion Public OAuth 설정이 아직 등록되지 않았습니다.' }, 503);
  }
  const state = await createNotionState(getUser(c as AppContext).id, c.env.JWT_SECRET);
  const query = new URLSearchParams({ owner: 'user', client_id: c.env.NOTION_CLIENT_ID,
    redirect_uri: notionRedirectUri(c.env), response_type: 'code', state });
  return c.json({ authorizationUrl: `https://api.notion.com/v1/oauth/authorize?${query}` });
});

app.get('/api/integrations/notion/callback', async (c) => {
  const origin = notionAppOrigin(c.env);
  const state = c.req.query('state') ?? '';
  const userId = await verifyNotionState(state, c.env.JWT_SECRET);
  if (!userId || c.req.query('error')) return c.redirect(`${origin}/deals?notion=denied`);
  const code = c.req.query('code');
  if (!code || !c.env.NOTION_CLIENT_ID || !c.env.NOTION_CLIENT_SECRET) return c.redirect(`${origin}/deals?notion=error`);
  try {
    const response = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${c.env.NOTION_CLIENT_ID}:${c.env.NOTION_CLIENT_SECRET}`)}`,
        Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: notionRedirectUri(c.env) }),
    });
    const token = await response.json<{ access_token?: string; refresh_token?: string; workspace_id?: string;
      workspace_name?: string; bot_id?: string; duplicated_template_id?: string | null; message?: string }>();
    if (!response.ok || !token.access_token || !token.workspace_id || !token.bot_id) throw new Error(token.message || 'Notion 인증에 실패했습니다.');
    await c.env.DB.prepare(`INSERT INTO notion_connections
      (user_id, access_token_encrypted, refresh_token_encrypted, workspace_id, workspace_name, bot_id, root_page_id)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = excluded.refresh_token_encrypted, workspace_id = excluded.workspace_id,
      workspace_name = excluded.workspace_name, bot_id = excluded.bot_id,
      root_page_id = COALESCE(excluded.root_page_id, notion_connections.root_page_id), updated_at = CURRENT_TIMESTAMP`)
      .bind(userId, await encryptNotionToken(token.access_token, c.env.JWT_SECRET),
        token.refresh_token ? await encryptNotionToken(token.refresh_token, c.env.JWT_SECRET) : null,
        token.workspace_id, token.workspace_name ?? null, token.bot_id, token.duplicated_template_id ?? null).run();
    return c.redirect(`${origin}/deals?notion=connected`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Notion OAuth 처리 실패');
    return c.redirect(`${origin}/deals?notion=error`);
  }
});

app.delete('/api/integrations/notion', async (c) => {
  await c.env.DB.prepare('DELETE FROM notion_connections WHERE user_id = ?').bind(getUser(c as AppContext).id).run();
  return c.body(null, 204);
});

app.post('/api/integrations/notion/setup', async (c) => {
  const user = getUser(c as AppContext);
  const connection = await c.env.DB.prepare('SELECT access_token_encrypted, root_page_id, root_page_url, database_id, data_source_id, setup_at FROM notion_connections WHERE user_id = ?')
    .bind(user.id).first<{ access_token_encrypted: string; root_page_id: string | null; root_page_url: string | null;
      database_id: string | null; data_source_id: string | null; setup_at: string | null }>();
  if (!connection) return c.json({ message: '먼저 Notion을 연결해주세요.' }, 409);
  if (connection.setup_at) {
    const rootPageUrl = connection.root_page_id && (!connection.root_page_url || !connection.root_page_url.startsWith('https://'))
      ? `https://www.notion.so/${connection.root_page_id.replace(/-/g, '')}`
      : connection.root_page_url;
    if (rootPageUrl !== connection.root_page_url && connection.root_page_id) {
      await c.env.DB.prepare('UPDATE notion_connections SET root_page_url = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
        .bind(rootPageUrl, user.id).run();
    }
    return c.json({ configured: true, rootPageUrl });
  }
  const accessToken = await decryptNotionToken(connection.access_token_encrypted, c.env.JWT_SECRET);
  const rich = (content: string, bold = false) => [{ type: 'text', text: { content }, annotations: { bold } }];
  const request = async (path: string, bodyValue?: unknown, method = 'POST') => {
    const response = await fetch(`https://api.notion.com/v1/${path}`, { method, headers: notionHeaders(accessToken),
      body: bodyValue === undefined ? undefined : JSON.stringify(bodyValue) });
    const result = await response.json<Record<string, unknown>>();
    if (!response.ok) throw new Error(String(result.message || 'Notion 공간을 만들지 못했습니다.'));
    return result;
  };
  const search = async (query: string) => {
    const result = await request('search', { query, filter: { property: 'object', value: 'page' }, page_size: 20 });
    return (result.results as Array<Record<string, unknown>> | undefined) ?? [];
  };
  const notionPageUrl = (id: string) => `https://www.notion.so/${id.replace(/-/g, '')}`;
  const plainTitle = (item: Record<string, unknown>) => {
    const title = item.title as Array<{ plain_text?: string }> | undefined;
    if (title) return title.map((part) => part.plain_text || '').join('');
    const properties = item.properties as Record<string, { type?: string; title?: Array<{ plain_text?: string }> }> | undefined;
    return Object.values(properties ?? {}).find((property) => property.type === 'title')?.title?.map((part) => part.plain_text || '').join('') || '';
  };
  let rootId = connection.root_page_id; let rootUrl = connection.root_page_url; let createdRoot = false;
  if (rootId && !rootUrl) rootUrl = notionPageUrl(rootId);
  if (!rootId) {
    const existingRoot = (await search('Propaid 홈')).find((item) => plainTitle(item) === 'Propaid 홈');
    if (existingRoot) { rootId = String(existingRoot.id); rootUrl = notionPageUrl(rootId); }
  }
  if (!rootId) {
    const root = await request('pages', {
    parent: { type: 'workspace', workspace: true }, icon: { type: 'emoji', emoji: '🎯' },
    properties: { title: { type: 'title', title: rich('Propaid 홈') } },
    children: [
      { object: 'block', type: 'heading_1', heading_1: { rich_text: rich('제안부터 입금까지, 놓치지 않게') } },
      { object: 'block', type: 'callout', callout: { icon: { type: 'emoji', emoji: '👋' }, rich_text: rich('Propaid에서 확인한 거래를 이 공간에 모아 작업과 입금 일정을 관리하세요.') } },
      { object: 'block', type: 'heading_2', heading_2: { rich_text: rich('빠른 시작') } },
      { object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: rich('Propaid에서 제안 메일을 분석하고 내용을 확인합니다.') } },
      { object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: rich('확정된 거래에서 Notion으로 보내기를 누릅니다.') } },
      { object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: rich('아래 거래 관리에서 상태·마감일·입금 예정일을 확인합니다.') } },
      { object: 'block', type: 'divider', divider: {} },
    ],
    });
    rootId = String(root.id); rootUrl = notionPageUrl(rootId); createdRoot = true;
    await c.env.DB.prepare('UPDATE notion_connections SET root_page_id = ?, root_page_url = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .bind(rootId, rootUrl, user.id).run();
  }
  if (createdRoot) await request('pages', { parent: { type: 'page_id', page_id: rootId }, icon: { type: 'emoji', emoji: '📘' },
    properties: { title: { type: 'title', title: rich('Propaid 사용 방법') } }, children: [
      { object: 'block', type: 'heading_2', heading_2: { rich_text: rich('기본 원칙') } },
      { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich('AI 분석 결과는 원문과 비교해 확인한 뒤 저장하세요.') } },
      { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich('명시되지 않은 계약 조건은 추측하지 말고 확인 필요 상태로 유지하세요.') } },
      { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich('거래 상태와 입금 완료 처리는 Propaid를 기준으로 관리하세요.') } },
    ] });
  let databaseId = connection.database_id;
  if (!databaseId) {
    const database = await request('databases', {
      parent: { type: 'page_id', page_id: rootId }, title: rich('거래 관리'), is_inline: true,
      properties: {
        '거래명': { title: {} }, '거래처': { rich_text: {} }, '유형': { rich_text: {} },
        '상태': { select: { options: [{ name: '확정', color: 'blue' }, { name: '진행 중', color: 'purple' }, { name: '작업 완료', color: 'green' }, { name: '입금 완료', color: 'gray' }] } },
        '금액': { number: { format: 'won' } }, '초안 기한': { date: {} }, '게시 기한': { date: {} }, '입금 예정일': { date: {} },
        '지급 조건': { rich_text: {} }, '작업물': { rich_text: {} }, '확인 항목': { rich_text: {} }, 'Propaid ID': { number: {} },
      },
    });
    databaseId = String(database.id);
  }
  if (!databaseId) throw new Error('Notion 거래 데이터베이스 정보를 확인하지 못했습니다.');
  await c.env.DB.prepare(`UPDATE notion_connections SET root_page_id = ?, root_page_url = ?, database_id = ?, setup_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`)
    .bind(rootId, rootUrl, databaseId, user.id).run();
  return c.json({ configured: true, rootPageUrl: rootUrl });
});

app.get('/api/integrations/google/status', async (c) => {
  const row = await c.env.DB.prepare('SELECT google_email, updated_at FROM google_connections WHERE user_id = ?')
    .bind(getUser(c as AppContext).id).first<{ google_email: string | null; updated_at: string }>();
  return c.json(row ? { connected: true, email: row.google_email, updatedAt: row.updated_at }
    : { connected: false, email: null, updatedAt: null });
});

app.post('/api/integrations/google/connect', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.json({ message: 'Google OAuth 설정이 아직 등록되지 않았습니다.' }, 503);
  const state = await createGoogleState(getUser(c as AppContext).id, c.env.JWT_SECRET);
  const query = new URLSearchParams({ client_id: c.env.GOOGLE_CLIENT_ID, redirect_uri: googleRedirectUri(c.env),
    response_type: 'code', scope: 'https://www.googleapis.com/auth/calendar.events email',
    access_type: 'offline', prompt: 'consent', state });
  return c.json({ authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${query}` });
});

app.get('/api/integrations/google/callback', async (c) => {
  const origin = googleAppOrigin(c.env);
  const userId = await verifyGoogleState(c.req.query('state') ?? '', c.env.JWT_SECRET);
  if (!userId || c.req.query('error')) return c.redirect(`${origin}/deals?google=denied`);
  const code = c.req.query('code');
  if (!code || !c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return c.redirect(`${origin}/deals?google=error`);
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: c.env.GOOGLE_CLIENT_ID, client_secret: c.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(c.env), grant_type: 'authorization_code' }),
    });
    const tokens = await tokenRes.json<{ access_token?: string; refresh_token?: string; expires_in?: number }>();
    if (!tokenRes.ok || !tokens.access_token) throw new Error('Google 인증에 실패했습니다.');
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const userInfo = await userRes.json<{ email?: string }>();
    const expiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
    await c.env.DB.prepare(`INSERT INTO google_connections (user_id, access_token_encrypted, refresh_token_encrypted, token_expiry, google_email)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = COALESCE(excluded.refresh_token_encrypted, google_connections.refresh_token_encrypted),
      token_expiry = excluded.token_expiry, google_email = excluded.google_email, updated_at = CURRENT_TIMESTAMP`)
      .bind(userId, await encryptGoogleToken(tokens.access_token, c.env.JWT_SECRET),
        tokens.refresh_token ? await encryptGoogleToken(tokens.refresh_token, c.env.JWT_SECRET) : null,
        expiry, userInfo.email ?? null).run();
    return c.redirect(`${origin}/deals?google=connected`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Google OAuth 처리 실패');
    return c.redirect(`${origin}/deals?google=error`);
  }
});

app.delete('/api/integrations/google', async (c) => {
  await c.env.DB.prepare('DELETE FROM google_connections WHERE user_id = ?').bind(getUser(c as AppContext).id).run();
  return c.body(null, 204);
});

app.post('/api/deals/:id/calendar', async (c) => {
  const user = getUser(c as AppContext);
  const dealId = Number(c.req.param('id'));
  const connection = await c.env.DB.prepare('SELECT access_token_encrypted, refresh_token_encrypted, token_expiry FROM google_connections WHERE user_id = ?')
    .bind(user.id).first<GoogleConnection>();
  if (!connection) return c.json({ message: 'Google Calendar가 연결되지 않았습니다.' }, 409);
  const deal = await c.env.DB.prepare('SELECT client, deal_type, amount, draft_due_date, publish_due_date, payment_due_date FROM deals WHERE id = ? AND user_id = ?')
    .bind(dealId, user.id).first<{ client: string | null; deal_type: string | null; amount: number | null; draft_due_date: string | null; publish_due_date: string | null; payment_due_date: string | null }>();
  if (!deal) return c.json({ message: '거래를 찾을 수 없습니다.' }, 404);
  if (!deal.draft_due_date && !deal.publish_due_date && !deal.payment_due_date)
    return c.json({ message: '등록된 날짜가 없습니다. 거래 상세에서 날짜를 먼저 입력해주세요.' }, 400);
  const accessToken = await getGoogleAccessToken(connection, c.env, async (encrypted, expiry) => {
    await c.env.DB.prepare('UPDATE google_connections SET access_token_encrypted = ?, token_expiry = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .bind(encrypted, expiry, user.id).run();
  });
  const clientName = deal.client ?? '거래처 미정';
  const description = `Propaid 거래\n거래처: ${clientName}${deal.deal_type ? `\n유형: ${deal.deal_type}` : ''}${deal.amount != null ? `\n금액: ${deal.amount.toLocaleString()}원` : ''}`;
  const createEvent = async (date: string, summary: string, colorId: string) => {
    const end = new Date(date); end.setDate(end.getDate() + 1);
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary, description, colorId, start: { date }, end: { date: end.toISOString().slice(0, 10) } }),
    });
    if (!res.ok) { const e = await res.json<{ error?: { message?: string } }>(); throw new Error(e.error?.message || 'Calendar 일정 생성 실패'); }
  };
  let count = 0;
  if (deal.draft_due_date) { await createEvent(deal.draft_due_date, `[${clientName}] 초안 마감`, '5'); count++; }
  if (deal.publish_due_date) { await createEvent(deal.publish_due_date, `[${clientName}] 게시 마감`, '6'); count++; }
  if (deal.payment_due_date) { await createEvent(deal.payment_due_date, `[${clientName}] 입금 예정`, '2'); count++; }
  await c.env.DB.prepare('UPDATE deals SET calendar_synced_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').bind(dealId, user.id).run();
  return c.json({ count });
});

app.post('/api/auth/signup', async (c) => {
  const input = await body<{ email?: string; password?: string; nickname?: string }>(c as AppContext);
  const email = input.email?.trim().toLowerCase();
  const nickname = input.nickname?.trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return c.json({ message: '올바른 이메일을 입력해주세요.' }, 400);
  if (!input.password || input.password.length < 8) return c.json({ message: '비밀번호는 8자 이상이어야 합니다.' }, 400);
  if (!nickname) return c.json({ message: '닉네임을 입력해주세요.' }, 400);
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ message: '이미 가입된 이메일입니다.' }, 409);
  const result = await c.env.DB.prepare(
    'INSERT INTO users (email, password_hash, nickname, inbox_token) VALUES (?, ?, ?, ?)'
  ).bind(email, await hashPassword(input.password), nickname, randomToken()).run();
  const userId = Number(result.meta.last_row_id);
  await c.env.DB.prepare('INSERT INTO user_plans (user_id) VALUES (?)').bind(userId).run();
  return c.json({ accessToken: await createToken(userId, c.env.JWT_SECRET), nickname });
});

app.post('/api/auth/login', async (c) => {
  const input = await body<{ email?: string; password?: string }>(c as AppContext);
  const row = await c.env.DB.prepare(
    'SELECT id, nickname, password_hash FROM users WHERE email = ?'
  ).bind(input.email?.trim().toLowerCase()).first<{ id: number; nickname: string; password_hash: string }>();
  if (!row || !input.password || !await verifyPassword(input.password, row.password_hash)) {
    return c.json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 400);
  }
  return c.json({ accessToken: await createToken(row.id, c.env.JWT_SECRET), nickname: row.nickname });
});

app.get('/api/subscriptions', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC').bind(getUser(c as AppContext).id).all();
  return c.json(rows.results.map(subscriptionResponse));
});

app.post('/api/subscriptions', async (c) => saveSubscription(c as AppContext));
app.put('/api/subscriptions/:id', async (c) => saveSubscription(c as AppContext, Number(c.req.param('id'))));

app.delete('/api/subscriptions/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM subscriptions WHERE id = ? AND user_id = ?')
    .bind(Number(c.req.param('id')), getUser(c as AppContext).id).run();
  if (!result.meta.changes) return c.json({ message: '구독 정보를 찾을 수 없습니다.' }, 404);
  return c.body(null, 204);
});

app.get('/api/subscriptions/summary', async (c) => {
  const rows = (await c.env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ?').bind(getUser(c as AppContext).id).all()).results as Record<string, unknown>[];
  const monthly = (row: Record<string, unknown>) => Math.round(Number(row.amount) / (row.billing_cycle === 'YEARLY' ? 12 : 1));
  const total = (usage: string) => rows.filter((row) => row.usage_type === usage).reduce((sum, row) => sum + monthly(row), 0);
  const categories = new Map<string, number>();
  rows.filter((row) => row.usage_type === 'BUSINESS').forEach((row) => {
    const category = String(row.accounting_category || '미분류');
    categories.set(category, (categories.get(category) ?? 0) + monthly(row));
  });
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, offset) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + offset, 1));
    return date.toISOString().slice(0, 7);
  });
  return c.json({ businessMonthlyTotal: total('BUSINESS'), personalMonthlyTotal: total('PERSONAL'),
    byAccountingCategory: [...categories].map(([category, monthlyTotal]) => ({ category, monthlyTotal })).sort((a, b) => b.monthlyTotal - a.monthlyTotal),
    registrationTrend: months.map((month) => ({ month, count: rows.filter((row) => String(row.created_at).startsWith(month)).length })) });
});

app.get('/api/subscriptions/suggest', (c) => {
  const name = (c.req.query('serviceName') ?? '').toLowerCase();
  const dictionary: Array<[string, string, string]> = [
    ['notion', 'BUSINESS', '지급수수료'], ['노션', 'BUSINESS', '지급수수료'], ['canva', 'BUSINESS', '광고선전비'],
    ['adobe', 'BUSINESS', '지급수수료'], ['chatgpt', 'BUSINESS', '지급수수료'], ['netflix', 'PERSONAL', '개인사용'],
  ];
  const found = dictionary.filter(([keyword]) => name.includes(keyword)).sort((a, b) => b[0].length - a[0].length)[0];
  return c.json(found ? { matched: true, suggestedUsageType: found[1], suggestedAccountingCategory: found[2], note: '일반적인 분류 사례를 참고해 추천했습니다. 실제 용도에 맞게 최종 확인해주세요.' }
    : { matched: false, suggestedUsageType: null, suggestedAccountingCategory: null, note: '등록된 사전에 없는 서비스입니다. 업무용·개인용 여부를 직접 선택해주세요.' });
});

app.post('/api/proposals/preview', async (c) => {
  const input = await body<{ text?: string }>(c as AppContext);
  if (!input.text?.trim()) return c.json({ message: '제안 내용을 입력해주세요.' }, 400);
  if (input.text.length > 20_000) return c.json({ message: '제안 내용은 20,000자 이하여야 합니다.' }, 400);
  return c.json(await analyzeWithAdapter(input.text, c.env));
});

app.get('/api/deals', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM deals WHERE user_id = ? ORDER BY created_at DESC').bind(getUser(c as AppContext).id).all();
  return c.json(rows.results.map((row) => dealResponse(row as Record<string, unknown>)));
});

app.post('/api/deals', async (c) => {
  const input = await body<Record<string, unknown>>(c as AppContext);
  if (!String(input.rawText ?? '').trim()) return c.json({ message: '원문이 필요합니다.' }, 400);
  const result = await c.env.DB.prepare(`INSERT INTO deals
    (user_id, client, deal_type, amount, deliverables, draft_due_date, publish_due_date, revision_count,
     secondary_usage, payment_condition, tasks, risks, raw_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(getUser(c as AppContext).id, input.client ?? null, input.dealType ?? null, input.amount ?? null,
      JSON.stringify(input.deliverables ?? []), input.draftDueDate ?? null, input.publishDueDate ?? null,
      input.revisionCount ?? null, input.secondaryUsage ?? null, input.paymentCondition ?? null,
      JSON.stringify(input.tasks ?? []), JSON.stringify(input.risks ?? []), input.rawText).run();
  const row = await c.env.DB.prepare('SELECT * FROM deals WHERE id = ?').bind(result.meta.last_row_id).first<Record<string, unknown>>();
  return c.json(dealResponse(row!), 201);
});

app.patch('/api/deals/:id/status', async (c) => {
  const input = await body<{ status?: string }>(c as AppContext);
  if (!['REVIEW', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'PAID'].includes(input.status ?? '')) return c.json({ message: '올바르지 않은 거래 상태입니다.' }, 400);
  const result = await c.env.DB.prepare("UPDATE deals SET status = ?, paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
    .bind(input.status, input.status, Number(c.req.param('id')), getUser(c as AppContext).id).run();
  if (!result.meta.changes) return c.json({ message: '거래를 찾을 수 없습니다.' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM deals WHERE id = ?').bind(Number(c.req.param('id'))).first<Record<string, unknown>>();
  return c.json(dealResponse(row!));
});

app.delete('/api/deals/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM deals WHERE id = ? AND user_id = ?').bind(Number(c.req.param('id')), getUser(c as AppContext).id).run();
  if (!result.meta.changes) return c.json({ message: '거래를 찾을 수 없습니다.' }, 404);
  return c.body(null, 204);
});

app.get('/api/expenses', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT e.*, d.client AS deal_client FROM expenses e LEFT JOIN deals d ON d.id = e.deal_id
    WHERE e.user_id = ? ORDER BY e.expense_date DESC, e.id DESC`).bind(getUser(c as AppContext).id).all();
  return c.json(rows.results.map((row) => expenseResponse(row as Record<string, unknown>)));
});

app.post('/api/expenses', async (c) => saveExpense(c as AppContext));
app.put('/api/expenses/:id', async (c) => saveExpense(c as AppContext, Number(c.req.param('id'))));

app.delete('/api/expenses/:id', async (c) => {
  const expense = await c.env.DB.prepare('SELECT evidence_object_key FROM expenses WHERE id = ? AND user_id = ?')
    .bind(Number(c.req.param('id')), getUser(c as AppContext).id).first<{ evidence_object_key: string | null }>();
  const result = await c.env.DB.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?')
    .bind(Number(c.req.param('id')), getUser(c as AppContext).id).run();
  if (!result.meta.changes) return c.json({ message: '비용 내역을 찾을 수 없습니다.' }, 404);
  if (expense?.evidence_object_key && c.env.EVIDENCE_BUCKET) {
    try { await c.env.EVIDENCE_BUCKET.delete(expense.evidence_object_key); }
    catch { console.error('삭제된 비용의 R2 증빙 정리에 실패했습니다.'); }
  }
  return c.body(null, 204);
});

app.patch('/api/deals/:id', async (c) => {
  const user = getUser(c as AppContext);
  const id = Number(c.req.param('id'));
  const existing = await c.env.DB.prepare('SELECT id FROM deals WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!existing) return c.json({ message: '거래를 찾을 수 없습니다.' }, 404);
  const input = await body<Record<string, unknown>>(c as AppContext);
  const text = (value: unknown, max = 300) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
  const number = (value: unknown) => value === null || value === '' ? null : Number(value);
  const date = (value: unknown) => {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? undefined : value;
  };
  const list = (value: unknown) => Array.isArray(value) && value.length <= 50 && value.every((item) => typeof item === 'string' && item.length <= 300)
    ? value.map((item) => item.trim()).filter(Boolean) : null;
  const amount = number(input.amount); const revisionCount = number(input.revisionCount);
  const draftDueDate = date(input.draftDueDate); const publishDueDate = date(input.publishDueDate); const paymentDueDate = date(input.paymentDueDate);
  const deliverables = list(input.deliverables); const tasks = list(input.tasks); const risks = list(input.risks);
  if ((amount !== null && (!Number.isFinite(amount) || amount < 0)) || (revisionCount !== null && (!Number.isInteger(revisionCount) || revisionCount < 0))) return c.json({ message: '금액 또는 수정 횟수가 올바르지 않습니다.' }, 400);
  if (draftDueDate === undefined || publishDueDate === undefined || paymentDueDate === undefined) return c.json({ message: '일정 날짜가 올바르지 않습니다.' }, 400);
  if (!deliverables || !tasks || !risks) return c.json({ message: '작업물·체크리스트·위험 항목을 확인해주세요.' }, 400);
  await c.env.DB.prepare(`UPDATE deals SET client = ?, deal_type = ?, amount = ?, deliverables = ?, draft_due_date = ?, publish_due_date = ?, payment_due_date = ?, revision_count = ?, secondary_usage = ?, payment_condition = ?, tasks = ?, risks = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
    .bind(text(input.client), text(input.dealType), amount, JSON.stringify(deliverables), draftDueDate, publishDueDate, paymentDueDate,
      revisionCount, text(input.secondaryUsage), text(input.paymentCondition), JSON.stringify(tasks), JSON.stringify(risks), id, user.id).run();
  const row = await c.env.DB.prepare('SELECT * FROM deals WHERE id = ? AND user_id = ?').bind(id, user.id).first<Record<string, unknown>>();
  return c.json(dealResponse(row!));
});

app.post('/api/deals/:id/notion', async (c) => {
  const user = getUser(c as AppContext);
  const id = Number(c.req.param('id'));
  const deal = await c.env.DB.prepare('SELECT * FROM deals WHERE id = ? AND user_id = ?').bind(id, user.id)
    .first<Record<string, unknown>>();
  if (!deal) return c.json({ message: '거래를 찾을 수 없습니다.' }, 404);
  if (deal.status === 'REVIEW') return c.json({ message: '사용자가 확인한 거래만 Notion으로 내보낼 수 있습니다.' }, 400);
  const connection = await c.env.DB.prepare('SELECT access_token_encrypted, refresh_token_encrypted, database_id FROM notion_connections WHERE user_id = ?')
    .bind(user.id).first<{ access_token_encrypted: string; refresh_token_encrypted: string | null; database_id: string | null }>();
  if (!connection) return c.json({ message: '먼저 Notion을 연결해주세요.' }, 409);
  if (!connection.database_id) return c.json({ message: '먼저 Propaid Notion 공간을 만들어주세요.' }, 409);

  const text = (content: unknown) => [{ type: 'text', text: { content: String(content ?? '').slice(0, 2000) } }];
  const paragraph = (label: string, value: unknown) => ({ object: 'block', type: 'paragraph',
    paragraph: { rich_text: text(`${label}: ${value || '-'}`) } });
  const list = (label: string, value: unknown) => {
    let items: string[] = [];
    try { items = Array.isArray(value) ? value.map(String) : JSON.parse(String(value || '[]')); } catch { items = []; }
    return { object: 'block', type: 'paragraph', paragraph: { rich_text: text(`${label}: ${items.length ? items.join(' · ') : '-'}`) } };
  };
  const statusLabels: Record<string, string> = { CONFIRMED: '확정', IN_PROGRESS: '진행 중', COMPLETED: '작업 완료', PAID: '입금 완료' };
  const title = `${String(deal.client || '거래처 확인 필요')} · ${String(deal.deal_type || '협찬·외주')}`.slice(0, 2000);
  const children = [
    paragraph('상태', statusLabels[String(deal.status)] || String(deal.status)), paragraph('금액', deal.amount == null ? '-' : `${Number(deal.amount).toLocaleString()}원`),
    paragraph('초안 기한', deal.draft_due_date), paragraph('게시 기한', deal.publish_due_date), paragraph('입금 예정일', deal.payment_due_date),
    paragraph('수정 횟수', deal.revision_count), paragraph('2차 활용', deal.secondary_usage), paragraph('지급 조건', deal.payment_condition),
    list('작업물', deal.deliverables), list('체크리스트', deal.tasks), list('확인 위험', deal.risks),
    { object: 'block', type: 'divider', divider: {} }, paragraph('원문', String(deal.raw_text || '').slice(0, 1900)),
  ];
  const dateProperty = (value: unknown) => value ? { date: { start: String(value) } } : undefined;
  let accessToken = await decryptNotionToken(connection.access_token_encrypted, c.env.JWT_SECRET);
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${connection.database_id}`, { headers: notionHeaders(accessToken) });
  const dbSchema = await dbRes.json<{ properties?: Record<string, { type: string }> }>();
  const schema = dbSchema.properties ?? {};
  const has = (name: string) => name in schema;
  const titleProp = Object.entries(schema).find(([, v]) => v.type === 'title')?.[0] ?? 'Name';
  const properties: Record<string, unknown> = { [titleProp]: { title: text(title) } };
  if (has('거래처')) properties['거래처'] = { rich_text: text(deal.client || '') };
  if (has('유형')) properties['유형'] = { rich_text: text(deal.deal_type || '') };
  if (has('상태')) properties['상태'] = { select: { name: statusLabels[String(deal.status)] || String(deal.status) } };
  if (has('금액')) properties['금액'] = { number: deal.amount == null ? null : Number(deal.amount) };
  if (has('지급 조건')) properties['지급 조건'] = { rich_text: text(deal.payment_condition || '') };
  if (has('작업물')) properties['작업물'] = { rich_text: text((JSON.parse(String(deal.deliverables || '[]')) as string[]).join(' · ')) };
  if (has('확인 항목')) properties['확인 항목'] = { rich_text: text((JSON.parse(String(deal.risks || '[]')) as string[]).join(' · ')) };
  if (has('Propaid ID')) properties['Propaid ID'] = { number: Number(deal.id) };
  const dates = { '초안 기한': dateProperty(deal.draft_due_date), '게시 기한': dateProperty(deal.publish_due_date), '입금 예정일': dateProperty(deal.payment_due_date) };
  Object.entries(dates).forEach(([key, value]) => { if (value && has(key)) properties[key] = value; });
  const pageBody = JSON.stringify({ parent: { database_id: connection.database_id }, properties, children });
  const createPage = () => fetch('https://api.notion.com/v1/pages', {
    method: 'POST', headers: notionHeaders(accessToken), body: pageBody,
  });
  let response = await createPage();
  if (response.status === 401 && connection.refresh_token_encrypted && c.env.NOTION_CLIENT_ID && c.env.NOTION_CLIENT_SECRET) {
    const refreshToken = await decryptNotionToken(connection.refresh_token_encrypted, c.env.JWT_SECRET);
    const refreshed = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST', headers: { Authorization: `Basic ${btoa(`${c.env.NOTION_CLIENT_ID}:${c.env.NOTION_CLIENT_SECRET}`)}`,
        Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const tokens = await refreshed.json<{ access_token?: string; refresh_token?: string }>();
    if (refreshed.ok && tokens.access_token) {
      accessToken = tokens.access_token;
      await c.env.DB.prepare('UPDATE notion_connections SET access_token_encrypted = ?, refresh_token_encrypted = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
        .bind(await encryptNotionToken(tokens.access_token, c.env.JWT_SECRET),
          tokens.refresh_token ? await encryptNotionToken(tokens.refresh_token, c.env.JWT_SECRET) : connection.refresh_token_encrypted, user.id).run();
      response = await createPage();
    }
  }
  const page = await response.json<Record<string, unknown>>();
  if (!response.ok || !page.id) {
    const detail = [page.message, page.code].filter(Boolean).join(' / ');
    return c.json({ message: String(detail || `Notion 페이지 생성 실패 (${response.status})`) }, 400);
  }
  const pageId = String(page.id);
  const pageUrl = String(page.url ?? `https://www.notion.so/${pageId.replace(/-/g, '')}`);
  await c.env.DB.prepare('UPDATE deals SET notion_page_id = ?, notion_page_url = ?, notion_exported_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .bind(pageId, pageUrl, id, user.id).run();
  const updated = await c.env.DB.prepare('SELECT * FROM deals WHERE id = ? AND user_id = ?').bind(id, user.id).first<Record<string, unknown>>();
  return c.json(dealResponse(updated!));
});

app.put('/api/expenses/:id/evidence', async (c) => {
  if (!c.env.EVIDENCE_BUCKET) return c.json({ message: 'R2 증빙 저장소가 설정되지 않았습니다.' }, 503);
  const user = getUser(c as AppContext);
  const expenseId = Number(c.req.param('id'));
  const expense = await c.env.DB.prepare('SELECT evidence_object_key FROM expenses WHERE id = ? AND user_id = ?')
    .bind(expenseId, user.id).first<{ evidence_object_key: string | null }>();
  if (!expense) return c.json({ message: '비용 내역을 찾을 수 없습니다.' }, 404);
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ message: '업로드할 증빙 파일이 필요합니다.' }, 400);
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) return c.json({ message: 'PDF, JPG, PNG, WEBP 증빙만 업로드할 수 있습니다.' }, 400);
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) return c.json({ message: '증빙 파일은 10MB 이하여야 합니다.' }, 400);
  const objectKey = `users/${user.id}/expenses/${expenseId}/${crypto.randomUUID()}`;
  await c.env.EVIDENCE_BUCKET.put(objectKey, file.stream(), {
    httpMetadata: { contentType: file.type }, customMetadata: { userId: String(user.id), expenseId: String(expenseId) },
  });
  await c.env.DB.prepare(`UPDATE expenses SET evidence_object_key = ?, evidence_file_name = ?, evidence_content_type = ?, evidence_size = ?, evidence_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
    .bind(objectKey, file.name.slice(0, 240), file.type, file.size, expenseId, user.id).run();
  if (expense.evidence_object_key) {
    try { await c.env.EVIDENCE_BUCKET.delete(expense.evidence_object_key); }
    catch { console.error('교체된 이전 R2 증빙 정리에 실패했습니다.'); }
  }
  const row = await c.env.DB.prepare(`SELECT e.*, d.client AS deal_client FROM expenses e LEFT JOIN deals d ON d.id = e.deal_id WHERE e.id = ? AND e.user_id = ?`).bind(expenseId, user.id).first<Record<string, unknown>>();
  return c.json(expenseResponse(row!));
});

app.get('/api/expenses/:id/evidence', async (c) => {
  if (!c.env.EVIDENCE_BUCKET) return c.json({ message: 'R2 증빙 저장소가 설정되지 않았습니다.' }, 503);
  const row = await c.env.DB.prepare('SELECT evidence_object_key, evidence_file_name, evidence_content_type FROM expenses WHERE id = ? AND user_id = ?')
    .bind(Number(c.req.param('id')), getUser(c as AppContext).id)
    .first<{ evidence_object_key: string | null; evidence_file_name: string | null; evidence_content_type: string | null }>();
  if (!row?.evidence_object_key) return c.json({ message: '증빙 파일을 찾을 수 없습니다.' }, 404);
  const object = await c.env.EVIDENCE_BUCKET.get(row.evidence_object_key);
  if (!object) return c.json({ message: '증빙 파일을 찾을 수 없습니다.' }, 404);
  const fileName = (row.evidence_file_name || 'evidence').replace(/[\r\n]/g, '');
  return new Response(object.body, { headers: {
    'Content-Type': row.evidence_content_type || object.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Length': String(object.size), 'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  } });
});

app.get('/api/finance/summary', async (c) => {
  const userId = getUser(c as AppContext).id;
  const incomeRows = (await c.env.DB.prepare("SELECT amount, paid_at FROM deals WHERE user_id = ? AND status = 'PAID' AND amount IS NOT NULL").bind(userId).all()).results as Record<string, unknown>[];
  const expenseRows = (await c.env.DB.prepare('SELECT amount, expense_date, usage_type, business_ratio, deduction_status FROM expenses WHERE user_id = ?').bind(userId).all()).results as Record<string, unknown>[];
  const subscriptionRows = (await c.env.DB.prepare("SELECT amount, billing_cycle FROM subscriptions WHERE user_id = ? AND usage_type = 'BUSINESS'").bind(userId).all()).results as Record<string, unknown>[];
  const realizedIncome = incomeRows.reduce((sum, row) => sum + Number(row.amount), 0);
  const realizedBusinessExpense = expenseRows.filter((row) => row.usage_type === 'BUSINESS').reduce((sum, row) => sum + Number(row.amount) * Number(row.business_ratio) / 100, 0);
  const deductionCandidate = expenseRows.filter((row) => row.deduction_status === 'CANDIDATE').reduce((sum, row) => sum + Number(row.amount) * Number(row.business_ratio) / 100, 0);
  const monthlyRecurringExpense = subscriptionRows.reduce((sum, row) => sum + Number(row.amount) / (row.billing_cycle === 'YEARLY' ? 12 : 1), 0);
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, offset) => {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + offset, 1)).toISOString().slice(0, 7);
    const income = incomeRows.filter((row) => String(row.paid_at ?? '').startsWith(month)).reduce((sum, row) => sum + Number(row.amount), 0);
    const expense = expenseRows.filter((row) => String(row.expense_date).startsWith(month) && row.usage_type === 'BUSINESS').reduce((sum, row) => sum + Number(row.amount) * Number(row.business_ratio) / 100, 0);
    return { month, income, expense, profit: income - expense };
  });
  return c.json({ realizedIncome, realizedBusinessExpense, netProfit: realizedIncome - realizedBusinessExpense,
    deductionCandidate, monthlyRecurringExpense: Math.round(monthlyRecurringExpense), reviewCount: expenseRows.filter((row) => row.deduction_status === 'REVIEW').length, months });
});

app.get('/api/plans/me', async (c) => {
  const plan = await c.env.DB.prepare('SELECT plan_type, expires_at FROM user_plans WHERE user_id = ?').bind(getUser(c as AppContext).id).first<{ plan_type: string; expires_at: string | null }>();
  const isPro = plan?.plan_type === 'PRO' && (!plan.expires_at || new Date(plan.expires_at) > new Date());
  return c.json({ planType: isPro ? 'PRO' : 'FREE', isPro, expiresAt: plan?.expires_at ?? null });
});

app.post('/api/plans/upgrade', async (c) => {
  const expires = new Date(); expires.setUTCMonth(expires.getUTCMonth() + 1);
  await c.env.DB.prepare("INSERT INTO user_plans (user_id, plan_type, expires_at) VALUES (?, 'PRO', ?) ON CONFLICT(user_id) DO UPDATE SET plan_type = 'PRO', expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP")
    .bind(getUser(c as AppContext).id, expires.toISOString()).run();
  return c.json({ planType: 'PRO', isPro: true, expiresAt: expires.toISOString() });
});

app.get('/api/inbox', async (c) => c.json({ address: `inbox-${getUser(c as AppContext).inbox_token}@${c.env.RESEND_RECEIVING_DOMAIN}` }));

app.get('/api/inbox/messages', async (c) => {
  const rows = await c.env.DB.prepare('SELECT id, sender, recipient, subject, analysis, status, error_message, attempt_count, last_attempt_at, created_at FROM inbound_emails WHERE user_id = ? ORDER BY created_at DESC')
    .bind(getUser(c as AppContext).id).all();
  return c.json(rows.results.map((row) => ({ id: row.id, sender: row.sender, recipient: row.recipient,
    subject: row.subject, analysis: JSON.parse(String(row.analysis)), status: row.status,
    errorMessage: row.error_message, attemptCount: row.attempt_count, lastAttemptAt: row.last_attempt_at, createdAt: row.created_at })));
});

app.post('/api/inbox/messages/:id/retry', async (c) => {
  if (!c.env.RESEND_API_KEY) return c.json({ message: 'Resend API 키가 설정되지 않았습니다.' }, 503);
  const user = getUser(c as AppContext);
  const row = await c.env.DB.prepare('SELECT id, resend_email_id, status FROM inbound_emails WHERE id = ? AND user_id = ?')
    .bind(Number(c.req.param('id')), user.id).first<{ id: number; resend_email_id: string; status: string }>();
  if (!row) return c.json({ message: '수신 메일을 찾을 수 없습니다.' }, 404);
  if (row.status !== 'FAILED') return c.json({ message: '실패 상태의 메일만 재시도할 수 있습니다.' }, 409);
  try {
    const processed = await receiveEmail(row.resend_email_id, c.env);
    await c.env.DB.prepare(`UPDATE inbound_emails SET sender = ?, subject = ?, text_body = ?, analysis = ?, status = 'REVIEW', error_message = NULL, attempt_count = attempt_count + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
      .bind(processed.sender, processed.subject, processed.text, JSON.stringify(processed.analysis), row.id, user.id).run();
    return c.json({ received: true });
  } catch (error) {
    await c.env.DB.prepare(`UPDATE inbound_emails SET error_message = ?, attempt_count = attempt_count + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
      .bind(safeInboundError(error), row.id, user.id).run();
    return c.json({ message: '메일 재처리에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 502);
  }
});

app.patch('/api/inbox/messages/:id/analysis', async (c) => {
  const user = getUser(c as AppContext);
  const message = await c.env.DB.prepare('SELECT analysis, status FROM inbound_emails WHERE id = ? AND user_id = ?')
    .bind(Number(c.req.param('id')), user.id).first<{ analysis: string; status: string }>();
  if (!message) return c.json({ message: '수신 메일을 찾을 수 없습니다.' }, 404);
  if (message.status === 'SAVED') return c.json({ message: '이미 거래로 저장된 메일은 수정할 수 없습니다.' }, 409);
  const input = await body<Record<string, unknown>>(c as AppContext);
  const current = JSON.parse(message.analysis) as ProposalAnalysis;
  const nullableText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
  const nullableNumber = (value: unknown) => value === null || value === '' ? null : Number(value);
  const stringList = (value: unknown): string[] | null => Array.isArray(value) && value.length <= 50 && value.every((item) => typeof item === 'string' && item.length <= 300)
    ? value.map((item) => item.trim()).filter(Boolean) : null;
  const deliverables = input.deliverables === undefined ? current.deliverables : stringList(input.deliverables);
  const tasks = input.tasks === undefined ? current.tasks : stringList(input.tasks);
  const risks = input.risks === undefined ? current.risks : stringList(input.risks);
  if (!deliverables || !tasks || !risks) return c.json({ message: '작업물·체크리스트·위험 항목은 각각 50개, 항목당 300자 이하여야 합니다.' }, 400);
  const updated: ProposalAnalysis = {
    ...current,
    client: input.client === undefined ? current.client : nullableText(input.client),
    dealType: input.dealType === undefined ? current.dealType : nullableText(input.dealType),
    amount: input.amount === undefined ? current.amount : nullableNumber(input.amount),
    draftDueDate: input.draftDueDate === undefined ? current.draftDueDate : nullableText(input.draftDueDate),
    publishDueDate: input.publishDueDate === undefined ? current.publishDueDate : nullableText(input.publishDueDate),
    revisionCount: input.revisionCount === undefined ? current.revisionCount : nullableNumber(input.revisionCount),
    secondaryUsage: input.secondaryUsage === undefined ? current.secondaryUsage : nullableText(input.secondaryUsage),
    paymentCondition: input.paymentCondition === undefined ? current.paymentCondition : nullableText(input.paymentCondition),
    deliverables, tasks, risks,
  };
  if ((updated.amount !== null && (!Number.isFinite(updated.amount) || updated.amount < 0)) ||
      (updated.revisionCount !== null && (!Number.isInteger(updated.revisionCount) || updated.revisionCount < 0))) {
    return c.json({ message: '금액 또는 수정 횟수가 올바르지 않습니다.' }, 400);
  }
  await c.env.DB.prepare('UPDATE inbound_emails SET analysis = ? WHERE id = ? AND user_id = ?')
    .bind(JSON.stringify(updated), Number(c.req.param('id')), user.id).run();
  return c.json(updated);
});

app.post('/api/inbox/messages/:id/save', async (c) => {
  const user = getUser(c as AppContext);
  const message = await c.env.DB.prepare(
    'SELECT id, resend_email_id, text_body, analysis, status FROM inbound_emails WHERE id = ? AND user_id = ?'
  ).bind(Number(c.req.param('id')), user.id).first<{ id: number; resend_email_id: string; text_body: string; analysis: string; status: string }>();
  if (!message) return c.json({ message: '수신 메일을 찾을 수 없습니다.' }, 404);
  const existing = await c.env.DB.prepare('SELECT * FROM deals WHERE source_email_id = ? AND user_id = ?')
    .bind(message.resend_email_id, user.id).first<Record<string, unknown>>();
  if (existing) return c.json(dealResponse(existing));
  const analysis = JSON.parse(message.analysis) as ProposalAnalysis;
  const insert = await c.env.DB.prepare(`INSERT INTO deals
    (user_id, client, deal_type, amount, deliverables, draft_due_date, publish_due_date, revision_count,
     secondary_usage, payment_condition, tasks, risks, raw_text, source_email_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(user.id, analysis.client, analysis.dealType, analysis.amount, JSON.stringify(analysis.deliverables),
      analysis.draftDueDate, analysis.publishDueDate, analysis.revisionCount, analysis.secondaryUsage,
      analysis.paymentCondition, JSON.stringify(analysis.tasks), JSON.stringify(analysis.risks),
      message.text_body, message.resend_email_id);
  const update = c.env.DB.prepare("UPDATE inbound_emails SET status = 'SAVED' WHERE id = ? AND user_id = ?")
    .bind(message.id, user.id);
  const [created] = await c.env.DB.batch([insert, update]);
  const row = await c.env.DB.prepare('SELECT * FROM deals WHERE id = ?').bind(created.meta.last_row_id).first<Record<string, unknown>>();
  return c.json(dealResponse(row!), 201);
});

app.post('/api/webhooks/resend', async (c) => {
  if (!c.env.RESEND_WEBHOOK_SECRET || !c.env.RESEND_API_KEY) return c.json({ message: 'Resend 환경변수가 설정되지 않았습니다.' }, 503);
  const payload = await c.req.text();
  if (!await verifyWebhook(payload, c.req.raw.headers, c.env.RESEND_WEBHOOK_SECRET)) return c.json({ message: '서명이 올바르지 않습니다.' }, 400);
  const event = JSON.parse(payload) as { type: string; data: { email_id: string; from?: string; to?: string[]; subject?: string } };
  if (event.type !== 'email.received') return c.json({ received: true });
  const svixId = c.req.header('svix-id')!;
  const duplicate = await c.env.DB.prepare('SELECT id FROM inbound_emails WHERE svix_id = ? OR resend_email_id = ?').bind(svixId, event.data.email_id).first();
  if (duplicate) return c.json({ received: true, duplicate: true });
  const recipient = event.data.to?.find((value) => value.toLowerCase().endsWith(`@${c.env.RESEND_RECEIVING_DOMAIN.toLowerCase()}`));
  const token = recipient?.split('@')[0].replace(/^inbox-/, '');
  const user = token ? await c.env.DB.prepare('SELECT id FROM users WHERE inbox_token = ?').bind(token).first<{ id: number }>() : null;
  if (!user || !recipient) return c.json({ received: true, ignored: 'unknown_recipient' });
  try {
    const processed = await receiveEmail(event.data.email_id, c.env);
    await c.env.DB.prepare(`INSERT INTO inbound_emails
      (user_id, resend_email_id, svix_id, sender, recipient, subject, text_body, analysis, last_attempt_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
      .bind(user.id, event.data.email_id, svixId, processed.sender ?? event.data.from ?? null, recipient,
        processed.subject ?? event.data.subject ?? null, processed.text, JSON.stringify(processed.analysis)).run();
    return c.json({ received: true });
  } catch (error) {
    await c.env.DB.prepare(`INSERT INTO inbound_emails
      (user_id, resend_email_id, svix_id, sender, recipient, subject, text_body, analysis, status, error_message, last_attempt_at)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, 'FAILED', ?, CURRENT_TIMESTAMP)`)
      .bind(user.id, event.data.email_id, svixId, event.data.from ?? null, recipient, event.data.subject ?? null,
        JSON.stringify(analyzeProposal('')), safeInboundError(error)).run();
    return c.json({ received: true, status: 'FAILED' }, 202);
  }
});

app.get('/api/reports/subscriptions/csv', async (c) => {
  const rows = (await c.env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC').bind(getUser(c as AppContext).id).all()).results as Record<string, unknown>[];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = ['서비스명,금액,결제주기,사용구분,계정과목,등록일', ...rows.map((row) => [row.service_name, row.amount, row.billing_cycle, row.usage_type, row.accounting_category, row.created_at].map(escape).join(','))].join('\r\n');
  return new Response(`\uFEFF${csv}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="subscriptions-report.csv"' } });
});

app.get('/api/reports/finance/csv', async (c) => {
  const userId = getUser(c as AppContext).id;
  const incomes = (await c.env.DB.prepare("SELECT client, deal_type, amount, paid_at, payment_condition FROM deals WHERE user_id = ? AND status = 'PAID' ORDER BY paid_at DESC").bind(userId).all()).results as Record<string, unknown>[];
  const expenses = (await c.env.DB.prepare(`SELECT e.*, d.client AS deal_client FROM expenses e LEFT JOIN deals d ON d.id = e.deal_id WHERE e.user_id = ? ORDER BY e.expense_date DESC`).bind(userId).all()).results as Record<string, unknown>[];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = ['구분,일자,거래처/항목,금액,계정과목,업무사용비율,공제검토,증빙,연결거래,메모'];
  incomes.forEach((row) => lines.push(['수입', row.paid_at, row.client, row.amount, row.deal_type, '100', '', '', '', row.payment_condition].map(escape).join(',')));
  expenses.forEach((row) => lines.push(['비용', row.expense_date, row.title, row.amount, row.category, row.business_ratio, row.deduction_status, row.evidence_type, row.deal_client, row.note].map(escape).join(',')));
  return new Response(`\uFEFF${lines.join('\r\n')}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="propaid-finance-report.csv"' } });
});

app.get('/api/reports/subscriptions/pdf', (c) => c.json({ message: 'PDF 보고서는 Cloudflare 전환 후 다시 제공할 예정입니다. CSV를 이용해주세요.' }, 501));

async function saveSubscription(c: AppContext, id?: number) {
  const input = await body<{ serviceName?: string; amount?: number; billingCycle?: string; usageType?: string; accountingCategory?: string }>(c);
  if (!input.serviceName?.trim() || !Number.isFinite(input.amount) || Number(input.amount) < 0) return c.json({ message: '서비스명과 올바른 금액을 입력해주세요.' }, 400);
  if (!['MONTHLY', 'YEARLY'].includes(input.billingCycle ?? '') || !['BUSINESS', 'PERSONAL'].includes(input.usageType ?? '')) return c.json({ message: '결제 주기 또는 사용 구분이 올바르지 않습니다.' }, 400);
  if (id) {
    const result = await c.env.DB.prepare(`UPDATE subscriptions SET service_name = ?, amount = ?, billing_cycle = ?, usage_type = ?, accounting_category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
      .bind(input.serviceName.trim(), input.amount, input.billingCycle, input.usageType, input.accountingCategory?.trim() || null, id, getUser(c).id).run();
    if (!result.meta.changes) return c.json({ message: '구독 정보를 찾을 수 없습니다.' }, 404);
  } else {
    const result = await c.env.DB.prepare('INSERT INTO subscriptions (user_id, service_name, amount, billing_cycle, usage_type, accounting_category) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(getUser(c).id, input.serviceName.trim(), input.amount, input.billingCycle, input.usageType, input.accountingCategory?.trim() || null).run();
    id = Number(result.meta.last_row_id);
  }
  const row = await c.env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return c.json(subscriptionResponse(row!));
}

async function saveExpense(c: AppContext, id?: number) {
  const input = await body<Record<string, unknown>>(c);
  const title = String(input.title ?? '').trim();
  const amount = Number(input.amount);
  const expenseDate = String(input.expenseDate ?? '');
  const category = String(input.category ?? '').trim();
  const usageType = String(input.usageType ?? '');
  const businessRatio = Number(input.businessRatio);
  const evidenceType = String(input.evidenceType ?? 'NONE');
  const deductionStatus = String(input.deductionStatus ?? 'REVIEW');
  const evidenceUrl = String(input.evidenceUrl ?? '').trim();
  const dealId = input.dealId === null || input.dealId === '' || input.dealId === undefined ? null : Number(input.dealId);
  if (!title || !Number.isFinite(amount) || amount < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate) || !category) return c.json({ message: '비용명, 금액, 사용일, 계정과목을 확인해주세요.' }, 400);
  if (!['BUSINESS', 'PERSONAL'].includes(usageType) || !Number.isInteger(businessRatio) || businessRatio < 0 || businessRatio > 100) return c.json({ message: '사용 구분 또는 업무 사용 비율이 올바르지 않습니다.' }, 400);
  if (!['NONE', 'RECEIPT', 'TAX_INVOICE', 'CASH_RECEIPT', 'CARD_SLIP', 'OTHER'].includes(evidenceType) || !['REVIEW', 'CANDIDATE', 'EXCLUDED'].includes(deductionStatus)) return c.json({ message: '증빙 또는 공제 검토 상태가 올바르지 않습니다.' }, 400);
  if (evidenceUrl && !/^https:\/\//i.test(evidenceUrl)) return c.json({ message: '증빙 링크는 https:// 주소를 입력해주세요.' }, 400);
  if (dealId) {
    const deal = await c.env.DB.prepare('SELECT id FROM deals WHERE id = ? AND user_id = ?').bind(dealId, getUser(c).id).first();
    if (!deal) return c.json({ message: '연결할 거래를 찾을 수 없습니다.' }, 404);
  }
  const values = [dealId, title, amount, expenseDate, category, usageType, businessRatio,
    String(input.paymentMethod ?? '').trim() || null, evidenceType, evidenceUrl || null,
    deductionStatus, String(input.note ?? '').trim() || null];
  if (id) {
    const result = await c.env.DB.prepare(`UPDATE expenses SET deal_id = ?, title = ?, amount = ?, expense_date = ?, category = ?, usage_type = ?, business_ratio = ?, payment_method = ?, evidence_type = ?, evidence_url = ?, deduction_status = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
      .bind(...values, id, getUser(c).id).run();
    if (!result.meta.changes) return c.json({ message: '비용 내역을 찾을 수 없습니다.' }, 404);
  } else {
    const result = await c.env.DB.prepare(`INSERT INTO expenses (user_id, deal_id, title, amount, expense_date, category, usage_type, business_ratio, payment_method, evidence_type, evidence_url, deduction_status, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(getUser(c).id, ...values).run();
    id = Number(result.meta.last_row_id);
  }
  const row = await c.env.DB.prepare(`SELECT e.*, d.client AS deal_client FROM expenses e LEFT JOIN deals d ON d.id = e.deal_id WHERE e.id = ? AND e.user_id = ?`).bind(id, getUser(c).id).first<Record<string, unknown>>();
  return c.json(expenseResponse(row!), id ? 200 : 201);
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function receiveEmail(emailId: string, env: Env) {
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'User-Agent': 'propaid-worker/1.0' },
  });
  if (!response.ok) throw new Error(`Resend 본문 조회 실패 (${response.status})`);
  const email = await response.json<{ text?: string | null; html?: string | null; from?: string; subject?: string }>();
  const text = email.text?.trim() || stripHtml(email.html ?? '');
  if (!text) throw new Error('메일 본문이 비어 있습니다.');
  return { sender: email.from ?? null, subject: email.subject ?? null, text, analysis: await analyzeWithAdapter(text, env) };
}

function safeInboundError(error: unknown): string {
  const message = error instanceof Error ? error.message : '알 수 없는 수신 오류';
  return message.replace(/[\r\n]/g, ' ').slice(0, 300);
}

async function verifyWebhook(payload: string, headers: Headers, secret: string): Promise<boolean> {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatures = headers.get('svix-signature');
  if (!id || !timestamp || !signatures || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  try {
    const secretBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (char) => char.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}.${timestamp}.${payload}`)));
    let binary = ''; for (const byte of signed) binary += String.fromCharCode(byte);
    const expected = btoa(binary);
    return signatures.split(' ').some((item) => item.replace(/^v1,/, '') === expected);
  } catch { return false; }
}

export default app;
