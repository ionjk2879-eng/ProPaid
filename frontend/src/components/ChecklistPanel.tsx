import { useState } from 'react';
import type { Deal } from '../api/deals';
import { updateDealChecklist } from '../api/deals';
import { CHECKLIST_ITEMS } from '../utils/checklist';

interface ChecklistPanelProps {
  deal: Deal;
  onUpdate: (deal: Deal) => void;
}

export default function ChecklistPanel({ deal, onUpdate }: ChecklistPanelProps) {
  const [pending, setPending] = useState<string | null>(null);
  const confirmed = new Set(deal.checklistConfirmed);

  const toggle = async (key: string) => {
    const next = confirmed.has(key) ? deal.checklistConfirmed.filter((item) => item !== key) : [...deal.checklistConfirmed, key];
    setPending(key);
    try { onUpdate(await updateDealChecklist(deal.id, next)); }
    finally { setPending(null); }
  };

  return (
    <div className="checklist-panel">
      <div className="checklist-panel-head">
        <div><p className="eyebrow">CONDITION CHECKLIST</p><h3 className="card-title">조건 확인 체크리스트</h3><p className="card-copy">메일 원문에서 아래 조건을 직접 찾아 확인하세요. 계약 검토나 법률 자문이 아닙니다.</p></div>
        <span className="badge badge-free">{confirmed.size}/{CHECKLIST_ITEMS.length} 확인됨</span>
      </div>
      <div className="checklist-items">
        {CHECKLIST_ITEMS.map((item) => {
          const found = item.foundValue(deal);
          const checked = confirmed.has(item.key);
          return (
            <label key={item.key} className={`checklist-item${checked ? ' checked' : ''}`}>
              <input type="checkbox" checked={checked} disabled={pending === item.key} onChange={() => void toggle(item.key)} />
              <span className="checklist-item-body">
                <span className="checklist-item-title">{item.label}</span>
                <span className="checklist-item-hint">{item.hint}</span>
                {found && <span className="checklist-item-found">원문 추정값: {found}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
