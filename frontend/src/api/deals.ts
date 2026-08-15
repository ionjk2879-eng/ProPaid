import { apiClient } from './client';
import type { ProposalAnalysis } from './proposal';

export type DealStatus = 'REVIEW' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'PAID';

export interface Deal {
  id: number;
  client: string | null;
  dealType: string | null;
  amount: number | null;
  deliverables: string[];
  draftDueDate: string | null;
  publishDueDate: string | null;
  revisionCount: number | null;
  secondaryUsage: string | null;
  paymentCondition: string | null;
  paymentDueDate: string | null;
  tasks: string[];
  risks: string[];
  status: DealStatus;
  paidAt: string | null;
  notionPageId: string | null;
  notionPageUrl: string | null;
  notionExportedAt: string | null;
  calendarSyncedAt: string | null;
  rawText: string;
  createdAt: string;
  updatedAt: string;
}

export type DealDetailsInput = Pick<Deal, 'client' | 'dealType' | 'amount' | 'deliverables' | 'draftDueDate' |
  'publishDueDate' | 'paymentDueDate' | 'revisionCount' | 'secondaryUsage' | 'paymentCondition' | 'tasks' | 'risks'>;

export async function fetchDeals(): Promise<Deal[]> {
  return (await apiClient.get<Deal[]>('/deals')).data;
}

export async function createDeal(analysis: ProposalAnalysis, rawText: string, keepRawText: boolean): Promise<Deal> {
  const { client, dealType, amount, deliverables, draftDueDate, publishDueDate, revisionCount,
    secondaryUsage, paymentCondition, tasks, risks } = analysis;
  return (await apiClient.post<Deal>('/deals', { client, dealType, amount, deliverables, draftDueDate,
    publishDueDate, revisionCount, secondaryUsage, paymentCondition, tasks, risks, rawText, keepRawText })).data;
}

export async function updateDealStatus(id: number, status: DealStatus): Promise<Deal> {
  return (await apiClient.patch<Deal>(`/deals/${id}/status`, { status })).data;
}

export async function updateDeal(id: number, input: DealDetailsInput): Promise<Deal> {
  return (await apiClient.patch<Deal>(`/deals/${id}`, input)).data;
}

export async function deleteDeal(id: number): Promise<void> {
  await apiClient.delete(`/deals/${id}`);
}
