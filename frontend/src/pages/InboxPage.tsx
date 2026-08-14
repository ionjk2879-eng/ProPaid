import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchInboxAddress, fetchInboxMessages, retryInboxMessage, saveInboxMessage, updateInboxAnalysis, type InboxMessage } from '../api/inbox';
import type { ProposalAnalysis } from '../api/proposal';
import WithholdingBadge from '../components/WithholdingBadge';

const splitLines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);

export default function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [address, setAddress] = useState('');
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ProposalAnalysis | null>(null);

  const load = async () => {
    try {
      const [nextAddress, nextMessages] = await Promise.all([fetchInboxAddress(), fetchInboxMessages()]);
      setAddress(nextAddress);
      setMessages(nextMessages);
    } catch {
      setError('받은 메일함을 불러오지 못했습니다.');
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const editId = Number(searchParams.get('edit'));
    if (!editId) {
      setEditingId(null);
      setDraft(null);
      return;
    }
    const message = messages.find((item) => item.id === editId);
    if (message && editingId !== editId) {
      setEditingId(editId);
      setDraft({ ...message.analysis });
    }
  }, [searchParams, messages, editingId]);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const saveAsDeal = async (id: number) => {
    setSavingId(id);
    setError(null);
    try {
      await saveInboxMessage(id);
      setMessages((items) => items.map((item) => item.id === id ? { ...item, status: 'SAVED' } : item));
    } catch {
      setError('거래 저장에 실패했습니다.');
    } finally {
      setSavingId(null);
    }
  };

  const retry = async (id: number) => {
    setSavingId(id); setError(null);
    try { await retryInboxMessage(id); await load(); }
    catch { setError('메일 재처리에 실패했습니다. 잠시 후 다시 시도해주세요.'); }
    finally { setSavingId(null); }
  };

  const startEditing = (message: InboxMessage) => {
    setEditingId(message.id);
    setDraft({ ...message.analysis });
    const next = new URLSearchParams(searchParams);
    next.set('edit', String(message.id));
    setSearchParams(next);
  };

  const closeEditing = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    setSearchParams(next, { replace: true });
    setEditingId(null);
    setDraft(null);
  };

  const updateDraft = <K extends keyof ProposalAnalysis>(key: K, value: ProposalAnalysis[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const saveDraft = async () => {
    if (editingId === null || !draft) return;
    setSavingId(editingId);
    setError(null);
    try {
      const updated = await updateInboxAnalysis(editingId, draft);
      setMessages((items) => items.map((item) => item.id === editingId ? { ...item, analysis: updated } : item));
      closeEditing();
    } catch {
      setError('분석 초안 수정에 실패했습니다.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <>
      <header className="page-header"><div><p className="eyebrow">INBOUND MAIL</p><h1 className="page-title">받은 제안</h1><p className="page-description">협찬·외주 메일을 전용 주소로 전달하면 확인 가능한 거래 초안으로 정리합니다.</p></div><div className="page-actions"><button className="btn btn-secondary" onClick={() => void load()}>↻ 새로고침</button></div></header>

      <section className="card card-body" style={{ marginBottom: 22 }}>
        <div className="card-header" style={{ padding: 0, marginBottom: 14 }}><div><h2 className="card-title">내 전용 전달 주소</h2><p className="card-copy">필요한 메일만 이 주소로 전달하세요. 받은편지함 전체 권한은 사용하지 않습니다.</p></div><span className="badge badge-confirmed">활성</span></div>
        <div className="address-box">
          <input className="address-input" value={address} readOnly aria-label="내 Propaid 전달 주소" />
          <button className="btn btn-primary" onClick={copyAddress} disabled={!address}>{copied ? '✓ 복사됨' : '주소 복사'}</button>
        </div>
        <div className="alert alert-info" style={{ marginBottom: 0 }}>메일이 도착하면 거래로 자동 확정하지 않고 아래의 확인 대기 목록에 저장합니다. 분석 결과는 메일 원문 기준 정보 표시이며 법률·계약 자문이 아닙니다.</div>
      </section>

      {error && <div className="alert alert-error">{error}</div>}
      <div className="page-header" style={{ margin: '28px 0 14px' }}><div><h2 className="card-title">확인 대기</h2><p className="card-copy">{messages.filter((message) => message.status !== 'SAVED').length}개의 제안을 확인해주세요.</p></div></div>
      {!messages.length && <div className="empty-state"><div className="empty-icon">✉</div><h3>아직 도착한 메일이 없어요</h3><p>전용 주소로 테스트 메일을 전달하면 이곳에 분석 초안이 나타납니다.</p></div>}
      <div className="stack">
        {messages.map((message) => (
          <article key={message.id} className="card message-card"><div className="message-summary">
            <div className="message-top"><div><div className="message-subject">{message.subject || '제목 없음'}</div><p className="message-sender">{message.sender || '발신자 정보 없음'} · {new Date(message.createdAt).toLocaleDateString('ko-KR')}</p></div><span className={`badge ${message.status === 'SAVED' ? 'badge-saved' : message.status === 'FAILED' ? 'badge-review' : 'badge-review'}`}>{message.status === 'SAVED' ? '거래 저장됨' : message.status === 'FAILED' ? '처리 실패' : '확인 필요'}</span></div>
            {message.status === 'FAILED' && <div className="alert alert-error">메일을 분석하지 못했습니다. {message.errorMessage || '잠시 후 다시 시도해주세요.'} · 시도 {message.attemptCount}회</div>}
            {editingId === message.id && draft ? (
              <div className="edit-panel" style={{ margin: '18px -22px -20px' }}><div className="form-grid">
                <label className="field"><span className="field-label">거래처</span><input value={draft.client ?? ''} onChange={(event) => updateDraft('client', event.target.value || null)} /></label>
                <label className="field"><span className="field-label">거래 유형</span><input value={draft.dealType ?? ''} onChange={(event) => updateDraft('dealType', event.target.value || null)} /></label>
                <label className="field"><span className="field-label">금액</span><input type="number" min="0" value={draft.amount ?? ''} onChange={(event) => updateDraft('amount', event.target.value === '' ? null : Number(event.target.value))} /></label>
                <label className="field"><span className="field-label">수정 횟수</span><input type="number" min="0" value={draft.revisionCount ?? ''} onChange={(event) => updateDraft('revisionCount', event.target.value === '' ? null : Number(event.target.value))} /></label>
                <label className="field"><span className="field-label">초안 기한</span><input type="date" value={draft.draftDueDate ?? ''} onChange={(event) => updateDraft('draftDueDate', event.target.value || null)} /></label>
                <label className="field"><span className="field-label">게시 기한</span><input type="date" value={draft.publishDueDate ?? ''} onChange={(event) => updateDraft('publishDueDate', event.target.value || null)} /></label>
                <label className="field"><span className="field-label">2차 사용</span><input value={draft.secondaryUsage ?? ''} onChange={(event) => updateDraft('secondaryUsage', event.target.value || null)} /></label>
                <label className="field"><span className="field-label">지급 조건</span><input value={draft.paymentCondition ?? ''} onChange={(event) => updateDraft('paymentCondition', event.target.value || null)} /></label>
              </div><div className="stack" style={{ marginTop: 14 }}>
                <label className="field"><span className="field-label">작업물</span><textarea rows={3} maxLength={5000} value={draft.deliverables.join('\n')} onChange={(event) => updateDraft('deliverables', splitLines(event.target.value))} placeholder="한 줄에 하나씩 입력하세요" /></label>
                <label className="field"><span className="field-label">작업 체크리스트</span><textarea rows={4} maxLength={5000} value={draft.tasks.join('\n')} onChange={(event) => updateDraft('tasks', splitLines(event.target.value))} placeholder="한 줄에 하나씩 입력하세요" /></label>
                <label className="field"><span className="field-label">위험·확인 항목</span><textarea rows={4} maxLength={5000} value={draft.risks.join('\n')} onChange={(event) => updateDraft('risks', splitLines(event.target.value))} placeholder="한 줄에 하나씩 입력하세요" /></label>
              </div><div className="action-row" style={{ marginTop: 14 }}><button className="btn btn-primary" onClick={() => void saveDraft()} disabled={savingId === message.id}>수정 저장</button><button className="btn btn-secondary" onClick={closeEditing}>취소</button></div></div>
            ) : (
              <><div className="message-analysis"><div className="analysis-value"><small>거래처</small><strong>{message.analysis.client || '확인 필요'}</strong></div><div className="analysis-value"><small>제안 금액</small><strong>{message.analysis.amount == null ? '확인 필요' : `${message.analysis.amount.toLocaleString()}원`}</strong>{message.analysis.amount != null && <WithholdingBadge amount={message.analysis.amount} />}</div></div>{!!message.analysis.risks.length && <div className="alert alert-warning">확인 항목 · {message.analysis.risks.join(' · ')}</div>}</>
            )}
            {message.status === 'FAILED' ? <div className="action-row"><button className="btn btn-primary" onClick={() => void retry(message.id)} disabled={savingId === message.id}>{savingId === message.id ? '재처리 중…' : '메일 재처리'}</button></div> : <div className="action-row">
              <button className="btn btn-secondary" onClick={() => startEditing(message)} disabled={message.status === 'SAVED' || editingId === message.id}>분석 수정</button>
              <button className="btn btn-primary" onClick={() => void saveAsDeal(message.id)} disabled={message.status === 'SAVED' || savingId === message.id || editingId === message.id}>
                {message.status === 'SAVED' ? '거래 저장됨' : savingId === message.id ? '저장 중…' : '이 분석으로 거래 저장'}
              </button>
            </div>}
          </div></article>
        ))}
      </div>
    </>
  );
}
