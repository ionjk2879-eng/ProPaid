import type React from 'react';
import type { ProposalAnalysis } from '../../api/proposal';
import WithholdingBadge from '../WithholdingBadge';

interface AnalysisResultProps {
  result: ProposalAnalysis;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
}

export default function AnalysisResult({ result, saving, saved, onSave }: AnalysisResultProps) {
  return (
    <section aria-live="polite" className="card card-body" style={{ marginTop: 20 }}>
      <div className="card-header" style={{ padding: 0, marginBottom: 18 }}><div><p className="eyebrow">ANALYSIS DRAFT</p><h2 className="card-title">분석 결과</h2></div><span className="badge badge-review">확인 필요</span></div>
      <div className="result-grid">
        <ResultItem label="거래처" value={result.client ?? '확인 필요'} />
        <ResultItem label="제안 유형" value={result.dealType ?? '확인 필요'} />
        <ResultItem label="제안 금액" value={result.amount == null ? '찾지 못함' : `${result.amount.toLocaleString()}원`}>
          {result.amount != null && <WithholdingBadge amount={result.amount} />}
        </ResultItem>
        <ResultItem label="초안 납기" value={result.draftDueDate ?? '확인 필요'} />
        <ResultItem label="게시 납기" value={result.publishDueDate ?? '확인 필요'} />
        <ResultItem label="수정 횟수" value={result.revisionCount == null ? '명시되지 않음' : `${result.revisionCount}회`} />
        <ResultItem label="2차 활용" value={result.secondaryUsage ?? '명시되지 않음'} />
      </div>
      <DetailList title="작업 범위" values={result.deliverables} empty="작업물을 찾지 못함" />
      <div className="result-section"><h3>지급 조건</h3><p>{result.paymentCondition ?? '찾지 못함'}</p></div>
      <DetailList title="해야 할 일" values={result.tasks} empty="자동 생성된 할 일이 없음" ordered />
      {result.risks.length > 0 && <DetailList title="원문에서 확인이 필요한 항목" values={result.risks} empty="" warning />}
      <p className="helper">적용 규칙: {result.matchedRules.join(', ') || '없음'}</p>
      {result.warnings.length > 0 && (
        <div className="alert alert-warning">
          {result.warnings.map((warning) => <div key={warning}>확인 필요: {warning}</div>)}
        </div>
      )}
      <div className="alert alert-info" style={{ marginTop: 12, marginBottom: 0 }}>
        메일 원문 기준 정보 표시이며 법률·계약 자문이 아닙니다. 계약 전 원문을 직접 확인하고 필요 시 전문가와 상담하세요.
      </div>
      <div className="action-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-primary" onClick={onSave} disabled={saving || saved}>{saved ? '✓ 거래로 저장됨' : saving ? '저장 중…' : '확인 후 거래로 저장'}</button>
      </div>
    </section>
  );
}

function DetailList({ title, values, empty, ordered = false, warning = false }: { title: string; values: string[]; empty: string; ordered?: boolean; warning?: boolean }) {
  const List = ordered ? 'ol' : 'ul';
  return (
    <div className={`result-section${warning ? ' alert alert-warning' : ''}`}>
      <h3>{title}</h3>
      {values.length ? <List>{values.map((value) => <li key={value}>{value}</li>)}</List> : <p>{empty}</p>}
    </div>
  );
}

function ResultItem({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="result-item">
      <div className="result-label">{label}</div>
      <strong>{value}</strong>
      {children}
    </div>
  );
}
