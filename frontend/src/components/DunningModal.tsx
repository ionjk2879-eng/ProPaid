import { useState } from 'react';
import type { Deal } from '../api/deals';
import { generateDunningDraft } from '../utils/dunning';

interface DunningModalProps {
  deal: Deal;
  onClose: () => void;
}

export default function DunningModal({ deal, onClose }: DunningModalProps) {
  const [copied, setCopied] = useState(false);
  const draft = generateDunningDraft(deal);

  const copy = async () => {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">OVERDUE PAYMENT</p>
            <h2 className="card-title">입금 확인 요청 메일 초안</h2>
            <p className="card-copy">{deal.client ?? '거래처'} · 입금 예정일 {deal.paymentDueDate}</p>
          </div>
          <button className="btn-icon" aria-label="닫기" onClick={onClose}>✕</button>
        </div>
        <textarea className="dunning-textarea" readOnly value={draft} />
        <div className="alert alert-info" style={{ marginBottom: 0, marginTop: 12 }}>
          초안을 그대로 보내지 말고 상황에 맞게 수정한 뒤 사용하세요.
        </div>
        <div className="action-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose}>닫기</button>
          <button className="btn btn-primary" onClick={() => void copy()}>
            {copied ? '✓ 복사됨' : '초안 복사'}
          </button>
        </div>
      </div>
    </div>
  );
}
