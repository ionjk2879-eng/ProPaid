import type { Context } from 'hono';
import type { Env, UserRow, Variables } from './types';

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export function jsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export function dealResponse(row: Record<string, unknown>) {
  return {
    id: row.id, client: row.client, dealType: row.deal_type, amount: row.amount,
    deliverables: jsonArray(row.deliverables), draftDueDate: row.draft_due_date,
    publishDueDate: row.publish_due_date, revisionCount: row.revision_count,
    secondaryUsage: row.secondary_usage, paymentCondition: row.payment_condition,
    paymentDueDate: row.payment_due_date,
    tasks: jsonArray(row.tasks), risks: jsonArray(row.risks), status: row.status,
    rawText: row.raw_text, paidAt: row.paid_at, notionPageId: row.notion_page_id,
    notionPageUrl: row.notion_page_url, notionExportedAt: row.notion_exported_at,
    notionExportStatus: row.notion_export_status ?? 'IDLE', notionExportError: row.notion_export_error,
    notionExportAttempts: row.notion_export_attempts ?? 0,
    calendarSyncedAt: row.calendar_synced_at,
    calendarSyncStatus: row.calendar_sync_status ?? 'IDLE', calendarSyncError: row.calendar_sync_error,
    calendarSyncAttempts: row.calendar_sync_attempts ?? 0,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function expenseResponse(row: Record<string, unknown>) {
  return { id: row.id, dealId: row.deal_id, dealClient: row.deal_client, title: row.title,
    amount: row.amount, expenseDate: row.expense_date, category: row.category,
    usageType: row.usage_type, businessRatio: row.business_ratio, paymentMethod: row.payment_method,
    evidenceType: row.evidence_type, evidenceUrl: row.evidence_url,
    evidenceFileName: row.evidence_file_name, evidenceContentType: row.evidence_content_type,
    evidenceSize: row.evidence_size, hasEvidenceFile: Boolean(row.evidence_object_key),
    deductionStatus: row.deduction_status, note: row.note, createdAt: row.created_at };
}

export function subscriptionResponse(row: Record<string, unknown>) {
  return { id: row.id, serviceName: row.service_name, amount: row.amount, billingCycle: row.billing_cycle,
    usageType: row.usage_type, accountingCategory: row.accounting_category, createdAt: row.created_at };
}

export function getUser(c: AppContext): UserRow { return c.get('user'); }

export async function body<T>(c: AppContext): Promise<T> {
  try { return await c.req.json<T>(); } catch { throw new Error('요청 본문이 올바른 JSON이 아닙니다.'); }
}
