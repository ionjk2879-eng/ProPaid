import { apiClient } from './client';

export type EvidenceType = 'NONE' | 'RECEIPT' | 'TAX_INVOICE' | 'CASH_RECEIPT' | 'CARD_SLIP' | 'OTHER';
export type DeductionStatus = 'REVIEW' | 'CANDIDATE' | 'EXCLUDED';

export interface Expense {
  id: number; dealId: number | null; dealClient: string | null; title: string; amount: number;
  expenseDate: string; category: string; usageType: 'BUSINESS' | 'PERSONAL'; businessRatio: number;
  paymentMethod: string | null; evidenceType: EvidenceType; evidenceUrl: string | null;
  evidenceFileName: string | null; evidenceContentType: string | null; evidenceSize: number | null; hasEvidenceFile: boolean;
  deductionStatus: DeductionStatus; note: string | null; createdAt: string;
}

export interface ExpenseInput {
  dealId?: number | null; title: string; amount: number; expenseDate: string; category: string;
  usageType: 'BUSINESS' | 'PERSONAL'; businessRatio: number; paymentMethod?: string;
  evidenceType: EvidenceType; evidenceUrl?: string; deductionStatus: DeductionStatus; note?: string;
}

export interface FinanceSummary {
  realizedIncome: number; realizedBusinessExpense: number; netProfit: number; deductionCandidate: number;
  monthlyRecurringExpense: number; reviewCount: number;
  months: Array<{ month: string; income: number; expense: number; profit: number }>;
}

export async function fetchExpenses() { return (await apiClient.get<Expense[]>('/expenses')).data; }
export async function createExpense(input: ExpenseInput) { return (await apiClient.post<Expense>('/expenses', input)).data; }
export async function deleteExpense(id: number) { await apiClient.delete(`/expenses/${id}`); }
export async function uploadExpenseEvidence(id: number, file: File) {
  const form = new FormData(); form.append('file', file);
  return (await apiClient.put<Expense>(`/expenses/${id}/evidence`, form)).data;
}
export async function downloadExpenseEvidence(expense: Expense) {
  const response = await apiClient.get(`/expenses/${expense.id}/evidence`, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a'); link.href = url; link.download = expense.evidenceFileName || 'evidence'; link.click();
  URL.revokeObjectURL(url);
}
export async function fetchFinanceSummary() { return (await apiClient.get<FinanceSummary>('/finance/summary')).data; }

export async function downloadFinanceCsv() {
  const response = await apiClient.get('/reports/finance/csv', { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a'); link.href = url; link.download = 'propaid-finance-report.csv'; link.click();
  URL.revokeObjectURL(url);
}
