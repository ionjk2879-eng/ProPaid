import { useEffect, useState } from 'react';
import type { Deal } from '../api/deals';
import { generateDunningDraft } from '../utils/dunning';

interface OverdueWorkspaceProps {
  deals: Deal[];
}

function overdueDays(dueDate: string | null) {
  if (!dueDate) return 0;
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000));
}

export default function OverdueWorkspace({ deals }: OverdueWorkspaceProps) {
  const [selectedId, setSelectedId] = useState(deals[0]?.id ?? null);
  const [copied, setCopied] = useState(false);
  const selected = deals.find((deal) => deal.id === selectedId) ?? deals[0];
  const draft = selected ? generateDunningDraft(selected) : '';

  useEffect(() => {
    if (!deals.some((deal) => deal.id === selectedId)) setSelectedId(deals[0]?.id ?? null);
  }, [deals, selectedId]);

  const copy = async () => {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (!selected) return null;

  return (
    <section className="overdue-workspace">
      <div className="overdue-banner">
        <div className="overdue-banner-icon" aria-hidden="true">!</div>
        <div><div className="overdue-banner-text">입금이 지연된 거래가 {deals.length}건 있어요</div><div className="overdue-banner-sub">예정일이 지난 거래를 확인하고 거래처에 입금 일정을 요청하세요.</div></div>
        <span className="overdue-total">미수금 {deals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0).toLocaleString('ko-KR')}원</span>
      </div>
      <div className="overdue-grid">
        <div className="card overdue-list-card">
          <div className="card-header"><div><p className="eyebrow">PAYMENT RISK</p><h2 className="card-title">지연된 거래</h2><p className="card-copy">거래를 선택하면 확인 메일 초안이 바뀝니다.</p></div></div>
          <div className="overdue-list">
            {deals.map((deal) => (
              <button key={deal.id} type="button" className={`overdue-item${selected.id === deal.id ? ' active' : ''}`} onClick={() => { setSelectedId(deal.id); setCopied(false); }}>
                <span className="overdue-item-top"><strong>{deal.client ?? '거래처 미확인'}</strong><em>{overdueDays(deal.paymentDueDate)}일 지연</em></span>
                <span className="overdue-item-meta"><span><small>금액</small>{deal.amount == null ? '확인 필요' : `${deal.amount.toLocaleString('ko-KR')}원`}</span><span><small>입금 예정일</small>{deal.paymentDueDate}</span></span>
              </button>
            ))}
          </div>
        </div>
        <div className="card overdue-draft-card">
          <div className="card-header"><div><p className="eyebrow">ACTION DRAFT</p><h2 className="card-title">입금 확인 요청 메일 초안</h2><p className="card-copy">{selected.client ?? '거래처'} · 입금 예정일 {selected.paymentDueDate}</p></div><span className="badge badge-review">확인 후 사용</span></div>
          <div className="overdue-draft-body"><textarea className="dunning-textarea" readOnly value={draft} /><div className="overdue-draft-footer"><p>초안을 그대로 보내지 말고 거래 상황에 맞게 수정한 뒤 사용하세요.</p><button className="btn btn-primary" type="button" onClick={() => void copy()}>{copied ? '✓ 복사됨' : '▣ 초안 복사'}</button></div></div>
        </div>
      </div>
    </section>
  );
}
