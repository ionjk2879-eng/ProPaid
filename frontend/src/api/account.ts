import { apiClient } from './client';

export interface AccountSummary {
  email: string;
  nickname: string;
  createdAt: string;
  planType: string;
  status: 'active' | 'pending_deletion' | 'dormant';
  deletionScheduledAt: string | null;
  dataScope: { deals: number; expenses: number; subscriptions: number; evidenceFiles: number };
  integrations: { notion: boolean; notionWorkspace: string | null; googleCalendar: boolean; googleCalendarEmail: string | null };
  soleLoginProvider: boolean;
  graceDays: number;
}

export async function fetchAccountSummary(): Promise<AccountSummary> {
  return (await apiClient.get<AccountSummary>('/account/summary')).data;
}

export async function downloadAccountExport(): Promise<void> {
  const response = await apiClient.get('/account/export', { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'propaid-account-data.json';
  link.click();
  URL.revokeObjectURL(url);
}

export async function revokeAllSessions(): Promise<void> {
  await apiClient.post('/account/sessions/revoke', {});
}

export interface DeleteAccountResult {
  status: 'pending_deletion' | 'deleted';
  deletionScheduledAt?: string;
  graceDays?: number;
}

export async function requestAccountDeletion(immediate: boolean): Promise<DeleteAccountResult> {
  return (await apiClient.post<DeleteAccountResult>('/account/delete', { immediate })).data;
}
