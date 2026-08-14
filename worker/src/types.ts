export interface Env {
  DB: D1Database;
  EVIDENCE_BUCKET?: R2Bucket;
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
}

export type Variables = { user: UserRow };
