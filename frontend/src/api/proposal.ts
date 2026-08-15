import { apiClient } from './client';

export interface ProposalAnalysis {
  client: string | null;
  dealType: string | null;
  amount: number | null;
  currency: string | null;
  deliverables: string[];
  draftDueDate: string | null;
  publishDueDate: string | null;
  revisionCount: number | null;
  secondaryUsage: string | null;
  paymentCondition: string | null;
  tasks: string[];
  risks: string[];
  startDate: string | null;
  endDate: string | null;
  paymentTerms: string[];
  matchedRules: string[];
  warnings: string[];
}

export async function previewProposal(text: string, turnstileToken?: string): Promise<ProposalAnalysis> {
  const response = await apiClient.post<ProposalAnalysis>('/proposals/preview', { text, turnstileToken });
  return response.data;
}
