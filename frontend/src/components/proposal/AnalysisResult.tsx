import { useState, type ReactNode } from 'react';
import type { ProposalAnalysis } from '../../api/proposal';

interface AnalysisResultProps {
  result: ProposalAnalysis;
  saving: boolean;
  saved: boolean;
  onChange: (result: ProposalAnalysis) => void;
  onSave: () => void;
}

export default function AnalysisResult({ result, saving, saved, onChange, onSave }: AnalysisResultProps) {
  const [editing, setEditing] = useState(false);
  const update = <K extends keyof ProposalAnalysis>(key: K, value: ProposalAnalysis[K]) => onChange({ ...result, [key]: value });
  const missing = [...result.risks, ...result.warnings.map((warning) => warning.replace(/^확인 필요:\s*/, ''))]
    .filter((value, index, values) => value && values.indexOf(value) === index);

  return (
    <section aria-live="polite" className="card card-body proposal-result-card">
      <div className="proposal-panel-heading"><div><p className="eyebrow">ANALYSIS DRAFT</p><h2 className="card-title">분석 결과</h2></div><span className="badge badge-review">확인 필요</span></div>
      <div className="analysis-form">
        <AnalysisField label="거래처" missing={!result.client}>
          <input value={result.client ?? ''} placeholder="확인 필요" disabled={!editing} onChange={(event) => update('client', event.target.value || null)} />
        </AnalysisField>
        <AnalysisField label="제안 금액" missing={result.amount == null}>
          <div className="analysis-input-unit"><input type="number" min="0" value={result.amount ?? ''} placeholder="확인 필요" disabled={!editing} onChange={(event) => update('amount', event.target.value ? Number(event.target.value) : null)} /><span>원</span></div>
        </AnalysisField>
        <AnalysisField label="초안 납기" missing={!result.draftDueDate}>
          <input type="date" value={result.draftDueDate ?? ''} disabled={!editing} onChange={(event) => update('draftDueDate', event.target.value || null)} />
        </AnalysisField>
        <AnalysisField label="게시 납기" missing={!result.publishDueDate}>
          <input type="date" value={result.publishDueDate ?? ''} disabled={!editing} onChange={(event) => update('publishDueDate', event.target.value || null)} />
        </AnalysisField>
        <AnalysisField label="수정 횟수" missing={result.revisionCount == null}>
          <div className="analysis-input-unit"><input type="number" min="0" value={result.revisionCount ?? ''} placeholder="확인 필요" disabled={!editing} onChange={(event) => update('revisionCount', event.target.value ? Number(event.target.value) : null)} /><span>{result.revisionCount == null ? '확인 필요' : '회'}</span></div>
        </AnalysisField>
        <AnalysisField label="지급 조건" missing={!result.paymentCondition}>
          <input value={result.paymentCondition ?? ''} placeholder="확인 필요" disabled={!editing} onChange={(event) => update('paymentCondition', event.target.value || null)} />
        </AnalysisField>
        <AnalysisField label="제안 유형" missing={!result.dealType}>
          <input value={result.dealType ?? ''} placeholder="확인 필요" disabled={!editing} onChange={(event) => update('dealType', event.target.value || null)} />
        </AnalysisField>
        <AnalysisField label="2차 활용" missing={!result.secondaryUsage}>
          <input value={result.secondaryUsage ?? ''} placeholder="확인 필요" disabled={!editing} onChange={(event) => update('secondaryUsage', event.target.value || null)} />
        </AnalysisField>
      </div>

      {missing.length > 0 && <div className="analysis-missing"><h3>⚠ 누락된 조건</h3>{missing.map((item) => <div key={item}>• {item}</div>)}</div>}

      <div className="analysis-detail-grid">
        <EditableList title="작업 범위" values={result.deliverables} editing={editing} empty="작업물을 찾지 못함" onChange={(values) => update('deliverables', values)} />
        <EditableList title="해야 할 일" values={result.tasks} editing={editing} empty="자동 생성된 할 일이 없음" onChange={(values) => update('tasks', values)} />
      </div>

      <div className="proposal-result-actions">
        <button className="btn btn-secondary" type="button" onClick={() => setEditing((value) => !value)}>{editing ? '수정 완료' : '결과 수정'}</button>
        <button className="btn btn-primary" onClick={onSave} disabled={saving || saved}>{saved ? '✓ 거래로 저장됨' : saving ? '저장 중…' : '확인 후 거래로 저장'}</button>
      </div>
    </section>
  );
}

function AnalysisField({ label, missing = false, children }: { label: string; missing?: boolean; children: ReactNode }) {
  return (
    <label className={`analysis-field${missing ? ' analysis-field-missing' : ''}`}>
      <span className="analysis-field-label">{label}</span>
      <span className="analysis-field-control">{children}</span>
      {missing && <span className="analysis-required-badge">확인 필요</span>}
    </label>
  );
}

function EditableList({ title, values, editing, empty, onChange }: { title: string; values: string[]; editing: boolean; empty: string; onChange: (values: string[]) => void }) {
  return (
    <div className="analysis-detail">
      <h3>{title}</h3>
      {editing ? <textarea value={values.join('\n')} placeholder="한 줄에 하나씩 입력하세요" onChange={(event) => onChange(event.target.value.split('\n').map((value) => value.trim()).filter(Boolean))} />
        : values.length ? <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul> : <p>{empty}</p>}
    </div>
  );
}
