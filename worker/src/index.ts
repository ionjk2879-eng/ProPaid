import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { analyzeProposal, type ProposalAnalysis } from './analyze';
import { analyzeWithAdapter } from './llm';
import { body, dealResponse, expenseResponse, getUser, subscriptionResponse, type AppContext } from './helpers';
import { createToken, hashPassword, randomToken, verifyToken } from './security';
import { createNotionState, decryptNotionToken, encryptNotionToken, notionAppOrigin, notionHeaders, notionRedirectUri, verifyNotionState } from './notion';
import { createGoogleLoginState, createGoogleState, decryptGoogleToken, encryptGoogleToken, getGoogleAccessToken, googleAppOrigin, googleLoginRedirectUri, googleRedirectUri, verifyGoogleLoginState, verifyGoogleState, type GoogleConnection } from './google';
import { DELETION_GRACE_DAYS, purgeUser, scheduledDeletionAt } from './account';
import { runAccountMaintenance } from './cron';
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
  if (c.req.path.startsWith('/api/auth/') || c.req.path.startsWith('/api/admin/') || c.req.path === '/api/health' || c.req.path === '/api/webhooks/resend' || c.req.path === '/api/integrations/notion/callback' || c.req.path === '/api/integrations/google/callback' || c.req.method === 'OPTIONS') return next();
  const authorization = c.req.header('Authorization');
  const payload = authorization?.startsWith('Bearer ') ? await verifyToken(authorization.slice(7), c.env.JWT_SECRET) : null;
  if (!payload) return c.json({ message: '로그인이 필요합니다.' }, 401);
  const user = await c.env.DB.prepare('SELECT id, email, nickname, inbox_token, token_version, status, deletion_scheduled_at, last_active_at, created_at FROM users WHERE id = ?').bind(payload.userId).first<UserRow>();
  if (!user) return c.json({ message: '사용자를 찾을 수 없습니다.' }, 401);
  if (user.token_version !== payload.tokenVersion) return c.json({ message: '세션이 만료되었습니다. 다시 로그인해주세요.' }, 401);
  c.set('user', user);
  const lastActiveStale = !user.last_active_at || Date.now() - new Date(user.last_active_at).getTime() > 60 * 60 * 1000;
  if (lastActiveStale) await c.env.DB.prepare('UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run();
  return next();
});

// 관리자 백업 조회 API는 사용자 로그인과 무관하게 별도의 고정 토큰으로만 접근을 허용한다(복구 훈련 스크립트 전용).
app.use('/api/admin/*', async (c, next) => {
  const token = c.req.header('X-Admin-Token');
  if (!c.env.ADMIN_TOKEN || !token || token !== c.env.ADMIN_TOKEN) return c.json({ message: '관리자 인증이 필요합니다.' }, 401);
  return next();
});

app.get('/api/admin/backups', async (c) => {
  if (!c.env.BACKUP_BUCKET) return c.json({ message: '백업 저장소가 설정되지 않았습니다.' }, 503);
  const listed = await c.env.BACKUP_BUCKET.list({ prefix: 'd1/', delimiter: '/' });
  const dates = (listed.delimitedPrefixes ?? [])
    .map((prefix) => prefix.replace(/^d1\//, '').replace(/\/$/, ''))
    .filter((value) => value !== 'latest')
    .sort().reverse();
  return c.json({ dates });
});

app.get('/api/admin/backups/:date/:table', async (c) => {
  if (!c.env.BACKUP_BUCKET) return c.json({ message: '백업 저장소가 설정되지 않았습니다.' }, 503);
  const { date, table } = c.req.param();
  if (!/^(latest|\d{4}-\d{2}-\d{2})$/.test(date) || !/^[a-z_]+$/.test(table)) return c.json({ message: '잘못된 요청입니다.' }, 400);
  const object = await c.env.BACKUP_BUCKET.get(`d1/${date}/${table}.json`);
  if (!object) return c.json({ message: '백업을 찾을 수 없습니다.' }, 404);
  return new Response(object.body, { headers: { 'Content-Type': 'application/json' } });
});

app.onError((error, c) => {
  console.error(error);
  const message = error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
  return c.json({ message }, message.includes('찾을 수') ? 404 : 400);
});

app.get('/api/health', (c) => c.json({ status: 'ok', runtime: 'cloudflare-workers' }));

app.get('/api/auth/google', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.json({ message: 'Google 로그인 설정이 아직 등록되지 않았습니다.' }, 503);
  }
  const query = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleLoginRedirectUri(c.env),
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state: await createGoogleLoginState(c.env.JWT_SECRET),
  });
  return c.json({ authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${query}` });
});

app.get('/api/auth/google/callback', async (c) => {
  const origin = googleAppOrigin(c.env);
  const loginError = (reason: string) => c.redirect(`${origin}/auth/google/callback?error=${reason}`);
  if (c.req.query('error')) return loginError('denied');
  if (!await verifyGoogleLoginState(c.req.query('state') ?? '', c.env.JWT_SECRET)) return loginError('invalid_state');
  const code = c.req.query('code');
  if (!code || !c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return loginError('not_configured');
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: googleLoginRedirectUri(c.env),
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenResponse.json<{ access_token?: string; error_description?: string }>();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error(tokens.error_description || 'Google 토큰 교환에 실패했습니다.');
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileResponse.json<{ sub?: string; email?: string; email_verified?: boolean; name?: string }>();
    const email = profile.email?.trim().toLowerCase();
    if (!profileResponse.ok || !profile.sub || !email || profile.email_verified !== true) {
      throw new Error('검증된 Google 이메일을 확인하지 못했습니다.');
    }

    let user = await c.env.DB.prepare(`SELECT u.id, u.nickname, u.token_version, u.status FROM auth_identities i
      JOIN users u ON u.id = i.user_id WHERE i.provider = 'google' AND i.provider_user_id = ?`)
      .bind(profile.sub).first<{ id: number; nickname: string; token_version: number; status: string }>();
    if (!user) {
      user = await c.env.DB.prepare('SELECT id, nickname, token_version, status FROM users WHERE email = ?')
        .bind(email).first<{ id: number; nickname: string; token_version: number; status: string }>();
      if (!user) {
        const nickname = profile.name?.trim().slice(0, 40) || email.split('@')[0];
        const result = await c.env.DB.prepare(
          'INSERT INTO users (email, password_hash, nickname, inbox_token) VALUES (?, ?, ?, ?)'
        ).bind(email, await hashPassword(randomToken(32)), nickname, randomToken()).run();
        user = { id: Number(result.meta.last_row_id), nickname, token_version: 1, status: 'active' };
        await c.env.DB.prepare('INSERT INTO user_plans (user_id) VALUES (?)').bind(user.id).run();
      }
      await c.env.DB.prepare(`INSERT INTO auth_identities (user_id, provider, provider_user_id, provider_email)
        VALUES (?, 'google', ?, ?) ON CONFLICT(provider, provider_user_id) DO UPDATE SET
        provider_email = excluded.provider_email, updated_at = CURRENT_TIMESTAMP`)
        .bind(user.id, profile.sub, email).run();
    } else {
      await c.env.DB.prepare(`UPDATE auth_identities SET provider_email = ?, updated_at = CURRENT_TIMESTAMP
        WHERE provider = 'google' AND provider_user_id = ?`).bind(email, profile.sub).run();
    }

    // 탈퇴 유예 기간 중 재로그인하면 삭제를 취소하고 계정을 복구한다. 휴면 계정은 다시 활성 상태로 되돌린다.
    let restored = false;
    if (user.status === 'pending_deletion') {
      await c.env.DB.prepare("UPDATE users SET status = 'active', deletion_scheduled_at = NULL WHERE id = ?").bind(user.id).run();
      restored = true;
    } else if (user.status === 'dormant') {
      await c.env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(user.id).run();
    }

    const accessToken = await createToken(user.id, c.env.JWT_SECRET, user.token_version);
    return c.redirect(`${origin}/auth/google/callback#access_token=${encodeURIComponent(accessToken)}&nickname=${encodeURIComponent(user.nickname)}${restored ? '&restored=1' : ''}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Google 로그인 처리 실패');
    return loginError('error');
  }
});

app.get('/api/account/summary', async (c) => {
  const user = getUser(c as AppContext);
  const db = c.env.DB;
  const [deals, expenses, subscriptions, evidenceFiles, notion, google, plan, identities] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM deals WHERE user_id = ?').bind(user.id).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM expenses WHERE user_id = ?').bind(user.id).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?').bind(user.id).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND evidence_object_key IS NOT NULL').bind(user.id).first<{ n: number }>(),
    db.prepare('SELECT workspace_name FROM notion_connections WHERE user_id = ?').bind(user.id).first<{ workspace_name: string | null }>(),
    db.prepare('SELECT google_email FROM google_connections WHERE user_id = ?').bind(user.id).first<{ google_email: string | null }>(),
    db.prepare('SELECT plan_type FROM user_plans WHERE user_id = ?').bind(user.id).first<{ plan_type: string }>(),
    db.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE user_id = ?").bind(user.id).first<{ n: number }>(),
  ]);
  return c.json({
    email: user.email, nickname: user.nickname, createdAt: user.created_at,
    planType: plan?.plan_type ?? 'FREE', status: user.status, deletionScheduledAt: user.deletion_scheduled_at,
    dataScope: { deals: deals?.n ?? 0, expenses: expenses?.n ?? 0, subscriptions: subscriptions?.n ?? 0, evidenceFiles: evidenceFiles?.n ?? 0 },
    integrations: { notion: Boolean(notion), notionWorkspace: notion?.workspace_name ?? null, googleCalendar: Boolean(google), googleCalendarEmail: google?.google_email ?? null },
    // Google 로그인은 유일한 인증 수단이라 단독 해제를 허용하지 않는다. 해제하려면 회원 탈퇴가 필요하다.
    soleLoginProvider: (identities?.n ?? 0) <= 1,
    graceDays: DELETION_GRACE_DAYS,
  });
});

app.get('/api/account/export', async (c) => {
  const user = getUser(c as AppContext);
  const db = c.env.DB;
  const [dealRows, expenseRows, subscriptionRows, inboundRows, notion, google, plan] = await Promise.all([
    db.prepare('SELECT * FROM deals WHERE user_id = ? ORDER BY created_at').bind(user.id).all(),
    db.prepare('SELECT e.*, d.client AS deal_client FROM expenses e LEFT JOIN deals d ON d.id = e.deal_id WHERE e.user_id = ? ORDER BY e.created_at').bind(user.id).all(),
    db.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at').bind(user.id).all(),
    db.prepare('SELECT resend_email_id, sender, recipient, subject, text_body, analysis, status, created_at FROM inbound_emails WHERE user_id = ? ORDER BY created_at').bind(user.id).all(),
    db.prepare('SELECT workspace_name, root_page_url, setup_at, updated_at FROM notion_connections WHERE user_id = ?').bind(user.id).first<Record<string, unknown>>(),
    db.prepare('SELECT google_email, updated_at FROM google_connections WHERE user_id = ?').bind(user.id).first<Record<string, unknown>>(),
    db.prepare('SELECT plan_type, expires_at FROM user_plans WHERE user_id = ?').bind(user.id).first<Record<string, unknown>>(),
  ]);
  const payload = {
    exportedAt: new Date().toISOString(),
    account: { email: user.email, nickname: user.nickname, createdAt: user.created_at, planType: plan?.plan_type ?? 'FREE', planExpiresAt: plan?.expires_at ?? null },
    integrations: {
      notion: notion ? { workspaceName: notion.workspace_name, rootPageUrl: notion.root_page_url, connectedAt: notion.setup_at ?? notion.updated_at } : null,
      googleCalendar: google ? { email: google.google_email, connectedAt: google.updated_at } : null,
    },
    deals: dealRows.results.map((row) => dealResponse(row as Record<string, unknown>)),
    expenses: expenseRows.results.map((row) => expenseResponse(row as Record<string, unknown>)),
    subscriptions: subscriptionRows.results.map((row) => subscriptionResponse(row as Record<string, unknown>)),
    receivedProposalEmails: inboundRows.results.map((row) => {
      const record = row as Record<string, unknown>;
      let analysis: unknown = null;
      try { analysis = JSON.parse(String(record.analysis ?? 'null')); } catch { analysis = null; }
      return { resendEmailId: record.resend_email_id, sender: record.sender, recipient: record.recipient,
        subject: record.subject, textBody: record.text_body, analysis, status: record.status, createdAt: record.created_at };
    }),
  };
  return new Response(JSON.stringify(payload, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="propaid-account-data.json"' },
  });
});

app.post('/api/account/sessions/revoke', async (c) => {
  await c.env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').bind(getUser(c as AppContext).id).run();
  return c.json({ status: 'revoked' });
});

app.post('/api/account/delete', async (c) => {
  const user = getUser(c as AppContext);
  const input = await body<{ immediate?: boolean }>(c as AppContext).catch(() => ({ immediate: false }));
  if (input.immediate) {
    await purgeUser(c.env, user.id);
    return c.json({ status: 'deleted' });
  }
  const scheduledAt = scheduledDeletionAt();
  await c.env.DB.prepare("UPDATE users SET status = 'pending_deletion', deletion_scheduled_at = ?, token_version = token_version + 1 WHERE id = ?")
    .bind(scheduledAt, user.id).run();
  return c.json({ status: 'pending_deletion', deletionScheduledAt: scheduledAt, graceDays: DELETION_GRACE_DAYS });
});

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
  const deal = await c.env.DB.prepare(`SELECT client, deal_type, amount, draft_due_date, publish_due_date, payment_due_date,
      calendar_draft_event_id, calendar_publish_event_id, calendar_payment_event_id FROM deals WHERE id = ? AND user_id = ?`)
    .bind(dealId, user.id).first<{ client: string | null; deal_type: string | null; amount: number | null;
      draft_due_date: string | null; publish_due_date: string | null; payment_due_date: string | null;
      calendar_draft_event_id: string | null; calendar_publish_event_id: string | null; calendar_payment_event_id: string | null }>();
  if (!deal) return c.json({ message: '거래를 찾을 수 없습니다.' }, 404);
  if (!deal.draft_due_date && !deal.publish_due_date && !deal.payment_due_date)
    return c.json({ message: '등록된 날짜가 없습니다. 거래 상세에서 날짜를 먼저 입력해주세요.' }, 400);
  const accessToken = await getGoogleAccessToken(connection, c.env, async (encrypted, expiry) => {
    await c.env.DB.prepare('UPDATE google_connections SET access_token_encrypted = ?, token_expiry = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .bind(encrypted, expiry, user.id).run();
  });
  const clientName = deal.client ?? '거래처 미정';
  const description = `Propaid 거래\n거래처: ${clientName}${deal.deal_type ? `\n유형: ${deal.deal_type}` : ''}${deal.amount != null ? `\n금액: ${deal.amount.toLocaleString()}원` : ''}`;
  // 이미 만든 일정이 있으면 새로 만들지 않고 같은 이벤트를 갱신해 중복 생성을 막는다.
  const upsertEvent = async (date: string, summary: string, colorId: string, existingEventId: string | null): Promise<string> => {
    const end = new Date(date); end.setDate(end.getDate() + 1);
    const body = JSON.stringify({ summary, description, colorId, start: { date }, end: { date: end.toISOString().slice(0, 10) } });
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const create = () => fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers, body });
    let res = existingEventId
      ? await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingEventId}`, { method: 'PATCH', headers, body })
      : await create();
    if (!res.ok && existingEventId && (res.status === 404 || res.status === 410)) res = await create();
    if (!res.ok) { const e = await res.json<{ error?: { message?: string } }>(); throw new Error(e.error?.message || 'Calendar 일정 생성 실패'); }
    const saved = await res.json<{ id: string }>();
    return saved.id;
  };
  const tasks: Array<['draft' | 'publish' | 'payment', string | null, string, string]> = [
    ['draft', deal.draft_due_date, `[${clientName}] 초안 마감`, '5'],
    ['publish', deal.publish_due_date, `[${clientName}] 게시 마감`, '6'],
    ['payment', deal.payment_due_date, `[${clientName}] 입금 예정`, '2'],
  ];
  const eventIds = { draft: deal.calendar_draft_event_id, publish: deal.calendar_publish_event_id, payment: deal.calendar_payment_event_id };
  const failures: string[] = [];
  let succeeded = 0;
  for (const [type, date, summary, colorId] of tasks) {
    if (!date) continue;
    try { eventIds[type] = await upsertEvent(date, summary, colorId, eventIds[type]); succeeded++; }
    catch (error) { failures.push(`${summary}: ${error instanceof Error ? error.message : '일정 생성 실패'}`); }
  }
  const status = failures.length ? 'FAILED' : 'IDLE';
  const errorSummary = failures.length ? failures.join(' / ').slice(0, 500) : null;
  await c.env.DB.prepare(`UPDATE deals SET calendar_draft_event_id = ?, calendar_publish_event_id = ?, calendar_payment_event_id = ?,
      calendar_synced_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE calendar_synced_at END,
      calendar_sync_status = ?, calendar_sync_error = ?, calendar_sync_attempts = calendar_sync_attempts + 1
      WHERE id = ? AND user_id = ?`)
    .bind(eventIds.draft, eventIds.publish, eventIds.payment, succeeded, status, errorSummary, dealId, user.id).run();
  const updated = await c.env.DB.prepare('SELECT * FROM deals WHERE id = ? AND user_id = ?').bind(dealId, user.id).first<Record<string, unknown>>();
  if (failures.length && !succeeded) return c.json({ message: errorSummary || 'Calendar 일정 등록에 실패했습니다.', deal: dealResponse(updated!) }, 502);
  return c.json({ count: succeeded, failed: failures.length, deal: dealResponse(updated!) });
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
  // 원문은 사용자가 명시적으로 보관을 선택한 경우에만 저장하고, 그 외에는 구조화된 필드만 남긴다.
  const keepRawText = input.keepRawText === true;
  const result = await c.env.DB.prepare(`INSERT INTO deals
    (user_id, client, deal_type, amount, deliverables, draft_due_date, publish_due_date, revision_count,
     secondary_usage, payment_condition, tasks, risks, raw_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(getUser(c as AppContext).id, input.client ?? null, input.dealType ?? null, input.amount ?? null,
      JSON.stringify(input.deliverables ?? []), input.draftDueDate ?? null, input.publishDueDate ?? null,
      input.revisionCount ?? null, input.secondaryUsage ?? null, input.paymentCondition ?? null,
      JSON.stringify(input.tasks ?? []), JSON.stringify(input.risks ?? []), keepRawText ? input.rawText : '').run();
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
  // 이미 내보낸 거래는 새 페이지를 만들지 않고 같은 페이지의 속성만 갱신해 중복 생성을 막는다.
  const existingPageId = deal.notion_page_id ? String(deal.notion_page_id) : null;
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
    ...(deal.raw_text ? [{ object: 'block', type: 'divider', divider: {} }, paragraph('원문', String(deal.raw_text).slice(0, 1900))] : []),
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
  // 이미 내보낸 거래는 페이지를 새로 만들지 않고 같은 페이지의 속성만 갱신한다(본문 블록은 최초 생성 시에만 기록).
  const pageBody = JSON.stringify(existingPageId ? { properties } : { parent: { database_id: connection.database_id }, properties, children });
  const sendPage = () => fetch(existingPageId ? `https://api.notion.com/v1/pages/${existingPageId}` : 'https://api.notion.com/v1/pages', {
    method: existingPageId ? 'PATCH' : 'POST', headers: notionHeaders(accessToken), body: pageBody,
  });
  let response = await sendPage();
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
      response = await sendPage();
    }
  }
  const page = await response.json<Record<string, unknown>>();
  if (!response.ok || !page.id) {
    const detail = String([page.message, page.code].filter(Boolean).join(' / ') || `Notion 페이지 ${existingPageId ? '갱신' : '생성'} 실패 (${response.status})`);
    await c.env.DB.prepare(`UPDATE deals SET notion_export_status = 'FAILED', notion_export_error = ?, notion_export_attempts = notion_export_attempts + 1 WHERE id = ? AND user_id = ?`)
      .bind(detail.slice(0, 500), id, user.id).run();
    return c.json({ message: detail }, 400);
  }
  const pageId = String(page.id);
  const pageUrl = existingPageId ? String(deal.notion_page_url ?? page.url ?? '') : String(page.url ?? `https://www.notion.so/${pageId.replace(/-/g, '')}`);
  await c.env.DB.prepare(`UPDATE deals SET notion_page_id = ?, notion_page_url = ?, notion_exported_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
      notion_export_status = 'IDLE', notion_export_error = NULL, notion_export_attempts = notion_export_attempts + 1 WHERE id = ? AND user_id = ?`)
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
  const input = await body<{ keepRawText?: boolean }>(c as AppContext).catch(() => ({ keepRawText: false }));
  const message = await c.env.DB.prepare(
    'SELECT id, resend_email_id, text_body, analysis, status FROM inbound_emails WHERE id = ? AND user_id = ?'
  ).bind(Number(c.req.param('id')), user.id).first<{ id: number; resend_email_id: string; text_body: string; analysis: string; status: string }>();
  if (!message) return c.json({ message: '수신 메일을 찾을 수 없습니다.' }, 404);
  const existing = await c.env.DB.prepare('SELECT * FROM deals WHERE source_email_id = ? AND user_id = ?')
    .bind(message.resend_email_id, user.id).first<Record<string, unknown>>();
  if (existing) return c.json(dealResponse(existing));
  const analysis = JSON.parse(message.analysis) as ProposalAnalysis;
  // 원문은 사용자가 명시적으로 보관을 선택한 경우에만 거래로 옮겨 담고, 받은 메일함의 원문은 결정이 끝났으므로 항상 비운다.
  const keepRawText = input.keepRawText === true;
  const insert = c.env.DB.prepare(`INSERT INTO deals
    (user_id, client, deal_type, amount, deliverables, draft_due_date, publish_due_date, revision_count,
     secondary_usage, payment_condition, tasks, risks, raw_text, source_email_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(user.id, analysis.client, analysis.dealType, analysis.amount, JSON.stringify(analysis.deliverables),
      analysis.draftDueDate, analysis.publishDueDate, analysis.revisionCount, analysis.secondaryUsage,
      analysis.paymentCondition, JSON.stringify(analysis.tasks), JSON.stringify(analysis.risks),
      keepRawText ? message.text_body : '', message.resend_email_id);
  const update = c.env.DB.prepare("UPDATE inbound_emails SET status = 'SAVED', text_body = '' WHERE id = ? AND user_id = ?")
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
  const isUniqueViolation = (error: unknown) => error instanceof Error && /unique/i.test(error.message);
  try {
    const processed = await receiveEmail(event.data.email_id, c.env);
    await c.env.DB.prepare(`INSERT INTO inbound_emails
      (user_id, resend_email_id, svix_id, sender, recipient, subject, text_body, analysis, last_attempt_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
      .bind(user.id, event.data.email_id, svixId, processed.sender ?? event.data.from ?? null, recipient,
        processed.subject ?? event.data.subject ?? null, processed.text, JSON.stringify(processed.analysis)).run();
    return c.json({ received: true });
  } catch (error) {
    // 거의 동시에 도착한 같은 웹훅이 중복 검사를 함께 통과했을 수 있으므로, 삽입 단계의 유니크 제약 위반도 중복으로 처리한다.
    if (isUniqueViolation(error)) return c.json({ received: true, duplicate: true });
    try {
      await c.env.DB.prepare(`INSERT INTO inbound_emails
        (user_id, resend_email_id, svix_id, sender, recipient, subject, text_body, analysis, status, error_message, last_attempt_at)
        VALUES (?, ?, ?, ?, ?, ?, '', ?, 'FAILED', ?, CURRENT_TIMESTAMP)`)
        .bind(user.id, event.data.email_id, svixId, event.data.from ?? null, recipient, event.data.subject ?? null,
          JSON.stringify(analyzeProposal('')), safeInboundError(error)).run();
      return c.json({ received: true, status: 'FAILED' }, 202);
    } catch (insertError) {
      if (isUniqueViolation(insertError)) return c.json({ received: true, duplicate: true });
      throw insertError;
    }
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

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runAccountMaintenance(env));
  },
};
