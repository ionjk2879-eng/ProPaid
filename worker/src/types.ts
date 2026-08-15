export interface Env {
  DB: D1Database;
  EVIDENCE_BUCKET?: R2Bucket;
  BACKUP_BUCKET?: R2Bucket;
  ADMIN_TOKEN?: string;
  JWT_SECRET: string;
  APP_ORIGIN: string;
  RESEND_RECEIVING_DOMAIN: string;
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  NOTION_CLIENT_ID?: string;
  NOTION_CLIENT_SECRET?: string;
  NOTION_REDIRECT_URI?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_LOGIN_REDIRECT_URI?: string;
  METRICS?: AnalyticsEngineDataset;
  ALERT_WEBHOOK_URL?: string;
  // 암호화 키 버전 관리(token-crypto.ts). 등록하지 않으면 JWT_SECRET으로 대체 동작하되 회전 효과는 없다.
  TOKEN_ENCRYPTION_KEY_V2?: string;
  // 로그인 시도 제한(IP 기준), 제안 분석·재시도 제한(사용자 기준), 수신 메일 처리 제한(수신자 기준).
  // 바인딩이 없는 환경(로컬 개발 등)에서는 검사를 건너뛰고 항상 허용한다.
  LOGIN_LIMITER?: RateLimit;
  ANALYSIS_LIMITER?: RateLimit;
  MAIL_LIMITER?: RateLimit;
  TURNSTILE_SECRET_KEY?: string;
}

export interface UserRow {
  id: number;
  email: string;
  nickname: string;
  inbox_token: string;
  token_version: number;
  status: 'active' | 'pending_deletion' | 'dormant';
  deletion_scheduled_at: string | null;
  last_active_at: string | null;
  created_at: string;
}

export type Variables = { user: UserRow; requestId: string };
