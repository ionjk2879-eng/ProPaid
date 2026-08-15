import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { isAxiosError } from 'axios';
import { fetchDeals, type Deal } from '../api/deals';
import { createExpense, deleteExpense, downloadExpenseEvidence, downloadFinanceCsv, fetchExpenses, fetchFinanceSummary, uploadExpenseEvidence, type DeductionStatus, type EvidenceType, type Expense, type FinanceSummary } from '../api/finance';
import { createSubscription, deleteSubscription, fetchSubscriptions } from '../api/subscriptions';
import { suggestCategory } from '../api/suggestion';
import type { BillingCycle, Subscription, UsageType } from '../types';
import SubscriptionForm from '../components/dashboard/SubscriptionForm';
import SubscriptionTable from '../components/dashboard/SubscriptionTable';

const today = new Date().toISOString().slice(0, 10);
const evidenceLabels: Record<EvidenceType, string> = { NONE: '없음', RECEIPT: '영수증', TAX_INVOICE: '세금계산서', CASH_RECEIPT: '현금영수증', CARD_SLIP: '카드전표', OTHER: '기타' };
const deductionLabels: Record<DeductionStatus, string> = { REVIEW: '검토 필요', CANDIDATE: '공제 후보', EXCLUDED: '공제 제외' };

function errorText(error: unknown, fallback: string) {
  return isAxiosError(error) ? error.response?.data?.message ?? fallback : fallback;
}

function formatWon(value: number) {
  return `${value.toLocaleString('ko-KR')}원`;
}

function FinanceTrend({ months }: { months: FinanceSummary['months'] }) {
  const maxValue = Math.max(1, ...months.flatMap((month) => [month.income, month.expense, Math.max(0, month.profit)]));

  return (
    <div className="finance-trend" role="img" aria-label="최근 6개월 수입, 업무 비용, 순수익 차트">
      <div className="finance-chart-legend" aria-hidden="true">
        <span><i className="legend-income" />수입</span>
        <span><i className="legend-expense" />업무 비용</span>
        <span><i className="legend-profit" />순수익</span>
      </div>
      <div className="finance-chart-plot">
        <div className="finance-chart-grid" aria-hidden="true"><span /><span /><span /><span /></div>
        {months.map((month) => {
          const incomeHeight = Math.max(2, (month.income / maxValue) * 100);
          const expenseHeight = Math.max(2, (month.expense / maxValue) * 100);
          const profitHeight = Math.max(2, (Math.max(0, month.profit) / maxValue) * 100);
          return (
            <div className="finance-chart-month" key={month.month}>
              <div className="finance-chart-bars">
                <span className="finance-bar finance-bar-income" style={{ height: `${incomeHeight}%` }} title={`수입 ${formatWon(month.income)}`} />
                <span className="finance-bar finance-bar-expense" style={{ height: `${expenseHeight}%` }} title={`업무 비용 ${formatWon(month.expense)}`} />
                <span className="finance-profit-dot" style={{ bottom: `${profitHeight}%` }} title={`순수익 ${formatWon(month.profit)}`} />
              </div>
              <strong>{month.month}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [title, setTitle] = useState(''); const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(today); const [category, setCategory] = useState('');
  const [expenseUsage, setExpenseUsage] = useState<UsageType>('BUSINESS'); const [businessRatio, setBusinessRatio] = useState('100');
  const [dealId, setDealId] = useState(''); const [paymentMethod, setPaymentMethod] = useState('');
  const [evidenceType, setEvidenceType] = useState<EvidenceType>('NONE'); const [evidenceUrl, setEvidenceUrl] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [deductionStatus, setDeductionStatus] = useState<DeductionStatus>('REVIEW'); const [note, setNote] = useState('');

  const [serviceName, setServiceName] = useState(''); const [subscriptionAmount, setSubscriptionAmount] = useState('');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('MONTHLY'); const [subscriptionUsage, setSubscriptionUsage] = useState<UsageType>('BUSINESS');
  const [accountingCategory, setAccountingCategory] = useState(''); const [suggestionNote, setSuggestionNote] = useState<string | null>(null);
  const [suggestionMatched, setSuggestionMatched] = useState(false);

  const reload = async () => {
    const [nextSummary, nextExpenses, nextDeals, nextSubscriptions] = await Promise.all([fetchFinanceSummary(), fetchExpenses(), fetchDeals(), fetchSubscriptions()]);
    setSummary(nextSummary); setExpenses(nextExpenses); setDeals(nextDeals); setSubscriptions(nextSubscriptions);
  };

  useEffect(() => { reload().catch((caught) => setError(errorText(caught, '재무 정보를 불러오지 못했습니다.'))); }, []);
  useEffect(() => {
    if (!serviceName.trim()) { setSuggestionNote(null); setSuggestionMatched(false); return; }
    const timer = setTimeout(() => suggestCategory(serviceName.trim()).then((result) => {
      setSuggestionMatched(result.matched); setSuggestionNote(result.note);
      if (result.matched) { if (result.suggestedUsageType) setSubscriptionUsage(result.suggestedUsageType); setAccountingCategory(result.suggestedAccountingCategory ?? ''); }
    }).catch(() => setSuggestionNote(null)), 500);
    return () => clearTimeout(timer);
  }, [serviceName]);

  const addExpense = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setSaving(true);
    try {
      const created = await createExpense({ title, amount: Number(expenseAmount), expenseDate, category, usageType: expenseUsage,
        businessRatio: expenseUsage === 'BUSINESS' ? Number(businessRatio) : 0, dealId: dealId ? Number(dealId) : null,
        paymentMethod, evidenceType, evidenceUrl, deductionStatus, note });
      if (evidenceFile) {
        try { await uploadExpenseEvidence(created.id, evidenceFile); }
        catch (caught) { setError(`${errorText(caught, '증빙 파일 업로드에 실패했습니다.')} 비용 내역은 저장되었습니다.`); }
      }
      setTitle(''); setExpenseAmount(''); setCategory(''); setDealId(''); setPaymentMethod(''); setEvidenceType('NONE'); setEvidenceUrl(''); setEvidenceFile(null); setDeductionStatus('REVIEW'); setNote('');
      await reload();
    } catch (caught) { setError(errorText(caught, '비용 등록에 실패했습니다.')); } finally { setSaving(false); }
  };

  const addSubscription = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    try {
      await createSubscription({ serviceName, amount: Number(subscriptionAmount), billingCycle, usageType: subscriptionUsage, accountingCategory: accountingCategory || undefined });
      setServiceName(''); setSubscriptionAmount(''); setAccountingCategory(''); setSuggestionNote(null); await reload();
    } catch (caught) { setError(errorText(caught, '구독 등록에 실패했습니다.')); }
  };

  const removeExpense = async (id: number) => { if (!confirm('이 비용 내역을 삭제할까요?')) return; await deleteExpense(id); await reload(); };
  const replaceEvidence = async (id: number, file: File | undefined) => {
    if (!file) return; setError(null);
    try { await uploadExpenseEvidence(id, file); await reload(); }
    catch (caught) { setError(errorText(caught, '증빙 파일 업로드에 실패했습니다.')); }
  };
  const downloadEvidence = async (expense: Expense) => {
    setError(null);
    try { await downloadExpenseEvidence(expense); }
    catch (caught) { setError(errorText(caught, '증빙 파일을 내려받지 못했습니다.')); }
  };
  const removeSubscription = async (id: number) => { if (!confirm('이 구독을 삭제할까요?')) return; await deleteSubscription(id); await reload(); };
  const exportCsv = async () => { setDownloading(true); try { await downloadFinanceCsv(); } finally { setDownloading(false); } };

  return (
    <>
      <header className="page-header"><div><p className="eyebrow">FINANCE WORKSPACE</p><h1 className="page-title">입금부터 비용까지, 실제 수익을 한눈에</h1><p className="page-description">입금된 거래 수입과 업무 비용을 연결해 실제 손익과 증빙 준비 상태를 확인하세요.</p></div><button className="btn btn-secondary" onClick={exportCsv} disabled={downloading}>⇩ {downloading ? '생성 중…' : '통합 CSV 내보내기'}</button></header>
      <div className="alert alert-info">공제 상태는 신고 준비를 위한 분류입니다. 실제 공제 가능 여부는 증빙과 업무 관련성을 기준으로 최종 확인하세요.</div>
      {error && <div className="alert alert-error">{error}</div>}

      <section className="finance-metrics">
        <div className="card metric-card"><div className="metric-label">입금 완료 수입</div><div className="metric-value">{formatWon(summary?.realizedIncome ?? 0)}</div><div className="metric-note">거래 관리의 입금 완료 기준</div></div>
        <div className="card metric-card"><div className="metric-label">업무 비용</div><div className="metric-value">{formatWon(summary?.realizedBusinessExpense ?? 0)}</div><div className="metric-note">업무 사용 비율 반영</div></div>
        <div className="card metric-card metric-highlight"><div className="metric-label">현재 순수익</div><div className="metric-value">{formatWon(summary?.netProfit ?? 0)}</div><div className="metric-note">입금 수입 − 등록 비용</div></div>
        <div className="card metric-card"><div className="metric-label">월 반복 비용</div><div className="metric-value">{formatWon(summary?.monthlyRecurringExpense ?? 0)}</div><div className="metric-note">업무용 구독의 월 환산 금액</div></div>
      </section>

      <section className="finance-overview">
        <div className="card finance-chart-card">
          <div className="card-header"><div><h2 className="card-title">최근 6개월 손익</h2><p className="card-copy">입금일과 비용 사용일을 기준으로 집계합니다.</p></div></div>
          <div className="card-body">{summary?.months.length ? <FinanceTrend months={summary.months} /> : <p className="helper table-empty">표시할 손익 데이터가 없습니다.</p>}</div>
        </div>
        <div className="card finance-summary-card">
          <div className="card-header"><div><h2 className="card-title">수입·지출 요약</h2><p className="card-copy">현재까지 확정된 금액입니다.</p></div></div>
          <div className="finance-summary-body">
            <dl className="finance-summary-list">
              <div><dt>총 수입</dt><dd className="finance-summary-income">{formatWon(summary?.realizedIncome ?? 0)}</dd></div>
              <div><dt>총 지출</dt><dd className="finance-summary-expense">{formatWon(summary?.realizedBusinessExpense ?? 0)}</dd></div>
              <div><dt>순수익</dt><dd className="finance-summary-profit">{formatWon(summary?.netProfit ?? 0)}</dd></div>
            </dl>
            <div className="finance-profit-ring" style={{ '--profit-percent': `${summary?.realizedIncome ? Math.max(0, Math.min(100, (summary.netProfit / summary.realizedIncome) * 100)) : 0}%` } as CSSProperties}>
              <span>순수익 비율<strong>{summary?.realizedIncome ? `${Math.max(0, (summary.netProfit / summary.realizedIncome) * 100).toFixed(1)}%` : '0%'}</strong></span>
            </div>
          </div>
        </div>
      </section>

      <section className="card card-body" style={{ marginTop: 20 }}><div className="card-header flush-header"><div><h2 className="card-title">일회성 비용 등록</h2><p className="card-copy">장비·교통·외주·광고비 등을 거래와 연결하고 증빙 상태를 기록합니다.</p></div></div>
        <form className="stack" onSubmit={addExpense}>
          <div className="form-grid"><label className="field"><span className="field-label">비용명</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 촬영 소품" required /></label><label className="field"><span className="field-label">금액</span><input type="number" min="0" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} required /></label></div>
          <div className="expense-form-grid"><label className="field"><span className="field-label">사용일</span><input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} required /></label><label className="field"><span className="field-label">계정과목</span><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="예: 소모품비" required /></label><label className="field"><span className="field-label">사용 구분</span><select value={expenseUsage} onChange={(e) => setExpenseUsage(e.target.value as UsageType)}><option value="BUSINESS">업무용</option><option value="PERSONAL">개인용</option></select></label><label className="field"><span className="field-label">업무 사용 비율</span><input type="number" min="0" max="100" value={businessRatio} disabled={expenseUsage === 'PERSONAL'} onChange={(e) => setBusinessRatio(e.target.value)} /></label></div>
          <div className="form-grid"><label className="field"><span className="field-label">관련 거래</span><select value={dealId} onChange={(e) => setDealId(e.target.value)}><option value="">공통 비용 / 연결 안 함</option>{deals.map((deal) => <option key={deal.id} value={deal.id}>{deal.client ?? '거래처 미정'} · {(deal.amount ?? 0).toLocaleString()}원</option>)}</select></label><label className="field"><span className="field-label">결제수단</span><input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="예: 사업용 카드" /></label></div>
          <div className="expense-form-grid"><label className="field"><span className="field-label">증빙</span><select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value as EvidenceType)}>{Object.entries(evidenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field expense-url"><span className="field-label">증빙 파일</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)} /><small className="helper">PDF·JPG·PNG·WEBP, 최대 10MB</small></label><label className="field"><span className="field-label">외부 증빙 링크 (선택)</span><input type="url" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="https://" disabled={Boolean(evidenceFile)} /></label><label className="field"><span className="field-label">공제 검토</span><select value={deductionStatus} onChange={(e) => setDeductionStatus(e.target.value as DeductionStatus)}>{Object.entries(deductionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          <label className="field"><span className="field-label">메모</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="업무 관련성과 사용 목적을 기록하세요" /></label><div className="action-row"><button className="btn btn-primary" disabled={saving}>{saving ? '저장 중…' : '비용 저장'}</button></div>
        </form>
      </section>

      <section className="card" style={{ marginTop: 20 }}><div className="card-header"><div><h2 className="card-title">비용 장부</h2><p className="card-copy">업무 사용 비율이 손익과 공제 후보 금액에 반영됩니다.</p></div></div><div className="card-body"><div className="table-wrap"><table className="data-table"><thead><tr><th>사용일</th><th>항목</th><th>금액</th><th>분류</th><th>연결 거래</th><th>증빙</th><th>공제 검토</th><th></th></tr></thead><tbody>{expenses.map((expense) => <tr key={expense.id}><td>{expense.expenseDate}</td><td>{expense.title}</td><td>{expense.amount.toLocaleString()}원 <small>({expense.businessRatio}%)</small></td><td>{expense.category}</td><td>{expense.dealClient ?? '공통 비용'}</td><td><div className="action-row">{expense.hasEvidenceFile ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => void downloadEvidence(expense)}>{expense.evidenceFileName || evidenceLabels[expense.evidenceType]}</button> : expense.evidenceUrl ? <a href={expense.evidenceUrl} target="_blank" rel="noreferrer">{evidenceLabels[expense.evidenceType]}</a> : <span>{evidenceLabels[expense.evidenceType]}</span>}<label className="btn btn-secondary btn-sm">{expense.hasEvidenceFile ? '교체' : '업로드'}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={(e) => void replaceEvidence(expense.id, e.target.files?.[0])} /></label></div></td><td><span className={`badge badge-${expense.deductionStatus.toLowerCase()}`}>{deductionLabels[expense.deductionStatus]}</span></td><td><button className="btn btn-danger btn-sm" onClick={() => removeExpense(expense.id)}>삭제</button></td></tr>)}</tbody></table>{!expenses.length && <p className="helper table-empty">아직 등록된 일반 비용이 없습니다.</p>}</div></div></section>

      <section className="card card-body" style={{ marginTop: 20 }}><div className="card-header flush-header"><div><h2 className="card-title">반복 구독 비용</h2><p className="card-copy">기존 핀포인트 구독 데이터입니다. 실제 결제 장부와 구분해 월 예상 비용으로 표시합니다.</p></div></div><SubscriptionForm serviceName={serviceName} amount={subscriptionAmount} billingCycle={billingCycle} usageType={subscriptionUsage} accountingCategory={accountingCategory} suggestionNote={suggestionNote} suggestionMatched={suggestionMatched} onServiceNameChange={setServiceName} onAmountChange={setSubscriptionAmount} onBillingCycleChange={setBillingCycle} onUsageTypeChange={setSubscriptionUsage} onAccountingCategoryChange={setAccountingCategory} onSubmit={addSubscription} /></section>
      <section className="card" style={{ marginTop: 20 }}><div className="card-header"><div><h2 className="card-title">구독 목록</h2><p className="card-copy">업무용과 개인용 반복 비용을 함께 관리합니다.</p></div></div><div className="card-body"><SubscriptionTable subscriptions={subscriptions} onDelete={removeSubscription} /></div></section>
    </>
  );
}
