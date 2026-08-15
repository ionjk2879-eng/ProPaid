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

export type Variables = { user: UserRow };
