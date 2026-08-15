import type { Deal } from '../api/deals';
import { CHECKLIST_ITEMS } from '../utils/checklist';

interface ChecklistWarningModalProps {
  deal: Deal;
  onCancel: () => void;
  onProceed: () => void;
}

export default function ChecklistWarningModal({ deal, onCancel, onProceed }: ChecklistWarningModalProps) {
  const confirmed = new Set(deal.checklistConfirmed);
  const unconfirmed = CHECKLIST_ITEMS.filter((item) => !confirmed.has(item.key));

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">BEFORE CONFIRMING</p>
            <h2 className="card-title">아직 확인하지 않은 조건이 있어요</h2>
            <p className="card-copy">{deal.client ?? '거래처'} · 확정 전 메일 원문에서 아래 항목을 확인해보세요.</p>
          </div>
          <button className="btn-icon" aria-label="닫기" onClick={onCancel}>✕</button>
        </div>
        <ul className="checklist-warning-list">
          {unconfirmed.map((item) => <li key={item.key}>{item.label}</li>)}
        </ul>
        <div className="alert alert-warning" style={{ marginBottom: 0, marginTop: 12 }}>
          그래도 진행할 수 있습니다. 계약 검토나 법률 자문이 아니라, 원문 확인을 놓치지 않기 위한 안내입니다.
        </div>
        <div className="action-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onCancel}>돌아가서 확인하기</button>
          <button className="btn btn-primary" onClick={onProceed}>그래도 확정하기</button>
        </div>
      </div>
    </div>
  );
}
