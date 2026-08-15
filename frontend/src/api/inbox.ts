import { apiClient } from './client';
import type { ProposalAnalysis } from './proposal';

export interface InboxMessage {
  id: number;
  sender: string | null;
  recipient: string;
  subject: string | null;
  analysis: ProposalAnalysis;
  status: 'REVIEW' | 'SAVED' | 'FAILED';
  errorMessage: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  createdAt: string;
}

export async function fetchInboxAddress(): Promise<string> {
  return (await apiClient.get<{ address: string }>('/inbox')).data.address;
}

export async function fetchInboxMessages(): Promise<InboxMessage[]> {
  return (await apiClient.get<InboxMessage[]>('/inbox/messages')).data;
}

export async function saveInboxMessage(id: number, keepRawText: boolean): Promise<void> {
  await apiClient.post(`/inbox/messages/${id}/save`, { keepRawText });
}

export async function updateInboxAnalysis(id: number, analysis: ProposalAnalysis): Promise<ProposalAnalysis> {
  return (await apiClient.patch<ProposalAnalysis>(`/inbox/messages/${id}/analysis`, analysis)).data;
}

export async function retryInboxMessage(id: number): Promise<void> {
  await apiClient.post(`/inbox/messages/${id}/retry`);
}
