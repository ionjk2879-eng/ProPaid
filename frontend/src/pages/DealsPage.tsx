import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { deleteDeal, fetchDeals, updateDeal, updateDealStatus, type Deal, type DealDetailsInput, type DealStatus } from '../api/deals';
import { connectNotion, disconnectNotion, exportDealToNotion, fetchNotionStatus, setupNotionWorkspace, type NotionStatus } from '../api/notion';
import { connectGoogle, disconnectGoogle, fetchGoogleStatus, syncDealToCalendar, type GoogleStatus } from '../api/google';

const statusLabels: Record<DealStatus, string> = {
  REVIEW: '확인 필요', CONFIRMED: '확정', IN_PROGRESS: '진행 중', COMPLETED: '작업 완료', PAID: '입금 완료',
};
const splitLines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [view, setView] = useState<'pipeline' | 'list'>('pipeline');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DealDetailsInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [notion, setNotion] = useState<NotionStatus | null>(null);
  const [notionBusy, setNotionBusy] = useState<number | 'connect' | 'disconnect' | 'setup' | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [googleBusy, setGoogleBusy] = useState<number | 'connect' | 'disconnect' | null>(null);
  const [notice, setNotice] = useState<ReactNode | null>(null);
  const [expandedPipelineId, setExpandedPipelineId] = useState<number | null>(null);

  const load = () => fetchDeals().then(setDeals).catch(() => setError('거래 목록을 불러오지 못했습니다.'));
  useEffect(() => {
    load();
    fetchNotionStatus().then(setNotion).catch(() => setNotion({ connected: false, configured: false, workspaceId: null, workspaceName: null, rootPageUrl: null, updatedAt: null }));
    fetchGoogleStatus().then(setGoogle).catch(() => setGoogle({ connected: false, email: null, updatedAt: null }));
    const googleResult = new URLSearchParams(window.location.search).get('google');
    if (googleResult) {
      setNotice(googleResult === 'connected' ? 'Google Calendar 연결이 완료되었습니다.' : googleResult === 'denied' ? 'Google Calendar 연결이 취소되었습니다.' : 'Google Calendar 연결을 완료하지 못했습니다.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    const result = new URLSearchParams(window.location.search).get('notion');
    if (result) {
      setNotice(result === 'connected' ? 'Notion 연결이 완료되었습니다.' : result === 'denied' ? 'Notion 연결이 취소되었습니다.' : 'Notion 연결을 완료하지 못했습니다.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const startNotionConnect = async () => {
    setNotionBusy('connect'); setError(null);
    try { await connectNotion(); }
    catch { setError('Notion Public OAuth 설정이 아직 필요합니다.'); setNotionBusy(null); }
  };

  const stopNotion = async () => {
    setNotionBusy('disconnect'); setError(null);
    try { await disconnectNotion(); setNotion({ connected: false, configured: false, workspaceId: null, workspaceName: null, rootPageUrl: null, updatedAt: null }); setNotice('Notion 연결을 해제했습니다.'); }
    catch { setError('Notion 연결 해제에 실패했습니다.'); }
    finally { setNotionBusy(null); }
  };

  const createNotionWorkspace = async () => {
    if (!notion) return; setNotionBusy('setup'); setError(null); setNotice(null);
    try {
      const result = await setupNotionWorkspace();
      setNotion({ ...notion, configured: true, rootPageUrl: result.rootPageUrl });
      setNotice('Propaid 홈과 거래 관리 데이터베이스를 만들었습니다.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Propaid Notion 공간을 만들지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    finally { setNotionBusy(null); }
  };

  const startGoogleConnect = async () => {
    setGoogleBusy('connect'); setError(null);
    try { await connectGoogle(); }
    catch { setError('Google OAuth 설정이 아직 필요합니다.'); setGoogleBusy(null); }
  };

  const stopGoogle = async () => {
    setGoogleBusy('disconnect'); setError(null);
    try { await disconnectGoogle(); setGoogle({ connected: false, email: null, updatedAt: null }); setNotice('Google Calendar 연결을 해제했습니다.'); }
    catch { setError('Google Calendar 연결 해제에 실패했습니다.'); }
    finally { setGoogleBusy(null); }
  };

  const addToCalendar = async (id: number) => {
    setGoogleBusy(id); setError(null); setNotice(null);
    try {
      const { count } = await syncDealToCalendar(id);
      setDeals((items) => items.map((item) => item.id === id ? { ...item, calendarSyncedAt: new Date().toISOString() } : item));
      setNotice(<>Google Calendar에 일정 {count}개를 등록했습니다. <a href="https://calendar.google.com" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>캘린더 열기 →</a></>);
    } catch (e) { setError(e instanceof Error ? e.message : 'Calendar 등록에 실패했습니다.'); }
    finally { setGoogleBusy(null); }
  };

  const sendToNotion = async (id: number) => {
    setNotionBusy(id); setError(null); setNotice(null);
    try {
      const updated = await exportDealToNotion(id);
      setDeals((items) => items.map((item) => item.id === id ? updated : item));
      setNotice('확인된 거래를 Notion 페이지로 내보냈습니다.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Notion 내보내기에 실패했습니다. 연결 상태를 확인해주세요.'); }
    finally { setNotionBusy(null); }
  };

  const changeStatus = async (id: number, status: DealStatus) => {
    try {
      const updated = await updateDealStatus(id, status);
      setDeals((items) => items.map((item) => item.id === id ? updated : item));
    } catch { setError('상태 변경에 실패했습니다.'); }
  };

  const remove = async (id: number) => {
    try { await deleteDeal(id); setDeals((items) => items.filter((item) => item.id !== id)); }
    catch { setError('거래 삭제에 실패했습니다.'); }
  };

  const startEditing = (deal: Deal) => {
    setEditingId(deal.id);
    setDraft({ client: deal.client, dealType: deal.dealType, amount: deal.amount, deliverables: [...deal.deliverables],
      draftDueDate: deal.draftDueDate, publishDueDate: deal.publishDueDate, paymentDueDate: deal.paymentDueDate,
      revisionCount: deal.revisionCount, secondaryUsage: deal.secondaryUsage, paymentCondition: deal.paymentCondition,
      tasks: [...deal.tasks], risks: [...deal.risks] });
  };

  const changeDraft = <K extends keyof DealDetailsInput>(key: K, value: DealDetailsInput[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const saveDetails = async () => {
    if (editingId === null || !draft) return; setSaving(true); setError(null);
    try {
      const updated = await updateDeal(editingId, draft);
      setDeals((items) => items.map((item) => item.id === editingId ? updated : item)); setEditingId(null); setDraft(null);
    } catch { setError('거래 상세 수정에 실패했습니다. 입력값을 확인해주세요.'); }
    finally { setSaving(false); }
  };

  const total = deals.filter((deal) => deal.status !== 'REVIEW').reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
  const paid = deals.filter((deal) => deal.status === 'PAID').reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
  const statusOrder: DealStatus[] = ['REVIEW', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'PAID'];
  const colColors: Record<DealStatus, { bg: string; color: string }> = {
    REVIEW: { bg: '#fff4d8', color: '#8a4b06' }, CONFIRMED: { bg: '#eaf1ff', color: '#3157a4' },
    IN_PROGRESS: { bg: '#f0eaff', color: '#5b36a4' }, COMPLETED: { bg: '#dff7ef', color: '#0d7556' }, PAID: { bg: '#edf0f5', color: '#596174' },
  };
  const dealsByStatus = statusOrder.reduce<Record<DealStatus, Deal[]>>((acc, s) => ({ ...acc, [s]: deals.filter((d) => d.status === s) }), {} as Record<DealStatus, Deal[]>);

  return (
    <>
      <header className="page-header"><div><p className="eyebrow">DEAL PIPELINE</p><h1 className="page-title">거래 관리</h1><p className="page-description">제안부터 입금까지 거래의 현재 위치와 중요한 조건을 한눈에 확인하세요.</p></div><div className="page-actions"><div className="view-toggle"><button className={`view-toggle-btn${view === 'pipeline' ? ' active' : ''}`} onClick={() => setView('pipeline')}>파이프라인</button><button className={`view-toggle-btn${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>목록</button></div><Link className="btn btn-primary" to="/proposals">＋ 새 제안 분석</Link></div></header>
      <section className="grid-3" style={{ marginBottom: 24 }}><div className="card metric-card"><div className="metric-label">전체 거래</div><div className="metric-value">{deals.length}건</div><div className="metric-note">확인 대기 포함</div></div><div className="card metric-card"><div className="metric-label">확정 거래 금액</div><div className="metric-value">{total.toLocaleString()}원</div><div className="metric-note">확인 완료된 거래</div></div><div className="card metric-card"><div className="metric-label">입금 완료</div><div className="metric-value">{paid.toLocaleString()}원</div><div className="metric-note">실제 수령 기준</div></div></section>
      <section className="card integration-card">
        <div><p className="eyebrow">NOTION EXPORT</p><h2 className="card-title">Notion 연결</h2><p className="card-copy">사용자가 확인한 거래만 선택해서 개인 Notion 페이지로 내보냅니다.</p></div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>{notion?.connected ? <><a className="badge badge-saved" href={notion.rootPageUrl ?? 'https://notion.so'} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Notion · {notion.workspaceName || '워크스페이스'} 연결됨 ↗</a><div className="action-row">{!notion.configured && <button className="btn btn-primary" onClick={() => void createNotionWorkspace()} disabled={notionBusy !== null}>{notionBusy === 'setup' ? '만드는 중…' : 'Propaid 공간 만들기'}</button>}<a className="btn btn-secondary btn-sm" href={notion.rootPageUrl ?? 'https://notion.so'} target="_blank" rel="noreferrer">Notion에서 열기</a><button className="btn btn-secondary btn-sm" onClick={() => void stopNotion()} disabled={notionBusy !== null}>{notionBusy === 'disconnect' ? '해제 중…' : '연결 해제'}</button></div></> : <button className="btn btn-primary" onClick={() => void startNotionConnect()} disabled={notionBusy !== null}>{notionBusy === 'connect' ? '연결 중…' : 'Notion 연결'}</button>}</div>
      </section>
      <section className="card integration-card">
        <div><p className="eyebrow">CALENDAR SYNC</p><h2 className="card-title">Google Calendar</h2><p className="card-copy">거래별 초안·게시·입금 예정일을 Google Calendar에 자동으로 등록합니다.</p></div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>{google?.connected ? <><span className="badge badge-saved">Google Calendar 연결됨{google.email ? ` · ${google.email}` : ''}</span><div className="action-row"><button className="btn btn-secondary btn-sm" onClick={() => void stopGoogle()} disabled={googleBusy !== null}>{googleBusy === 'disconnect' ? '해제 중…' : '연결 해제'}</button></div></> : <button className="btn btn-primary" onClick={() => void startGoogleConnect()} disabled={googleBusy !== null}>{googleBusy === 'connect' ? '연결 중…' : 'Google Calendar 연결'}</button>}</div>
      </section>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}
      {!deals.length && <div className="empty-state"><div className="empty-icon">▦</div><h3>아직 저장된 거래가 없어요</h3><p>받은 메일을 확인하거나 제안 원문을 직접 분석해 첫 거래를 만들어보세요.</p><Link className="btn btn-primary" style={{ marginTop: 18 }} to="/inbox">받은 제안 보기</Link></div>}
      {view === 'pipeline' && deals.length > 0 && (
        <div className="pipeline">
          {statusOrder.map((status) => (
            <div key={status} className="pipeline-col">
              <div className="pipeline-col-header" style={{ background: colColors[status].bg, color: colColors[status].color }}>
                <span>{statusLabels[status]}</span><span className="pipeline-col-count">{dealsByStatus[status].length}</span>
              </div>
              {dealsByStatus[status].length === 0
                ? <div className="pipeline-col-empty">없음</div>
                : dealsByStatus[status].map((deal) => (
                  <div key={deal.id} className={`pipeline-card${expandedPipelineId === deal.id ? ' pipeline-card-expanded' : ''}`} onClick={() => setExpandedPipelineId(expandedPipelineId === deal.id ? null : deal.id)}>
                    <div className="pipeline-card-client">{deal.client ?? '거래처 확인 필요'}</div>
                    {deal.amount != null && <div className="pipeline-card-amount">{deal.amount.toLocaleString()}원</div>}
                    {deal.dealType && <span className="pipeline-card-type">{deal.dealType}</span>}
                    {deal.publishDueDate && <div className="pipeline-card-date">게시 <strong>{deal.publishDueDate}</strong></div>}
                    {deal.paymentDueDate && <div className="pipeline-card-date">입금 <strong>{deal.paymentDueDate}</strong></div>}
                    <select className="pipeline-card-select" value={deal.status} onClick={(e) => e.stopPropagation()} onChange={(e) => changeStatus(deal.id, e.target.value as DealStatus)}>
                      {Object.entries(statusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    {expandedPipelineId === deal.id && (
                      <div className="pipeline-card-actions" onClick={(e) => e.stopPropagation()}>
                        {deal.notionPageUrl
                          ? <a className="btn btn-secondary btn-sm" href={deal.notionPageUrl} target="_blank" rel="noreferrer">Notion에서 열기</a>
                          : <button className="btn btn-secondary btn-sm" onClick={() => void sendToNotion(deal.id)} disabled={!notion?.configured || deal.status === 'REVIEW' || notionBusy !== null}>{notionBusy === deal.id ? '내보내는 중…' : 'Notion으로 보내기'}</button>}
                        {google?.connected && <button className="btn btn-secondary btn-sm" onClick={() => void addToCalendar(deal.id)} disabled={(!deal.draftDueDate && !deal.publishDueDate && !deal.paymentDueDate) || googleBusy === deal.id} title={deal.calendarSyncedAt ? `마지막 등록: ${deal.calendarSyncedAt.slice(0, 10)}` : ''}>{googleBusy === deal.id ? '등록 중…' : deal.calendarSyncedAt ? '📅 재등록' : '📅 Calendar'}</button>}
                        <button className="btn btn-secondary btn-sm" onClick={() => { startEditing(deal); setView('list'); }}>상세 수정</button>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
      <div className="stack" style={{ display: view === 'list' ? 'grid' : 'none' }}>
        {deals.map((deal) => <article key={deal.id} className="card deal-card">
          <div className="deal-top"><div><div className="deal-client">{deal.client ?? '거래처 확인 필요'}</div><div className="deal-type">{deal.dealType ?? '거래 유형 미정'}</div></div><div className="deal-amount">{deal.amount == null ? '금액 확인 필요' : `${deal.amount.toLocaleString()}원`}</div></div>
          <div className="deal-deliverables">{deal.deliverables.length ? deal.deliverables.map((item) => <span className="tag" key={item}>{item}</span>) : <span className="tag">작업 범위 확인 필요</span>}</div>
          <div className="deal-meta"><div><span className="meta-label">초안 기한</span><span className="meta-value">{deal.draftDueDate ?? '-'}</span></div><div><span className="meta-label">게시 기한</span><span className="meta-value">{deal.publishDueDate ?? '-'}</span></div><div><span className="meta-label">입금 예정일</span><span className="meta-value">{deal.paymentDueDate ?? '-'}</span></div><div><span className="meta-label">{deal.status === 'PAID' ? '입금 완료일' : '지급 조건'}</span><span className="meta-value">{deal.status === 'PAID' && deal.paidAt ? deal.paidAt.slice(0, 10) : deal.paymentCondition ?? '-'}</span></div></div>
          {editingId === deal.id && draft && <div className="edit-panel" style={{ margin: '18px -22px 0' }}>
            <div className="form-grid"><label className="field"><span className="field-label">거래처</span><input value={draft.client ?? ''} onChange={(e) => changeDraft('client', e.target.value || null)} /></label><label className="field"><span className="field-label">거래 유형</span><input value={draft.dealType ?? ''} onChange={(e) => changeDraft('dealType', e.target.value || null)} /></label><label className="field"><span className="field-label">금액</span><input type="number" min="0" value={draft.amount ?? ''} onChange={(e) => changeDraft('amount', e.target.value === '' ? null : Number(e.target.value))} /></label><label className="field"><span className="field-label">수정 횟수</span><input type="number" min="0" value={draft.revisionCount ?? ''} onChange={(e) => changeDraft('revisionCount', e.target.value === '' ? null : Number(e.target.value))} /></label></div>
            <div className="expense-form-grid" style={{ marginTop: 14 }}><label className="field"><span className="field-label">초안 기한</span><input type="date" value={draft.draftDueDate ?? ''} onChange={(e) => changeDraft('draftDueDate', e.target.value || null)} /></label><label className="field"><span className="field-label">게시 기한</span><input type="date" value={draft.publishDueDate ?? ''} onChange={(e) => changeDraft('publishDueDate', e.target.value || null)} /></label><label className="field"><span className="field-label">입금 예정일</span><input type="date" value={draft.paymentDueDate ?? ''} onChange={(e) => changeDraft('paymentDueDate', e.target.value || null)} /></label></div>
            <div className="form-grid" style={{ marginTop: 14 }}><label className="field"><span className="field-label">2차 사용</span><input value={draft.secondaryUsage ?? ''} onChange={(e) => changeDraft('secondaryUsage', e.target.value || null)} /></label><label className="field"><span className="field-label">지급 조건</span><input value={draft.paymentCondition ?? ''} onChange={(e) => changeDraft('paymentCondition', e.target.value || null)} /></label></div>
            <div className="stack" style={{ marginTop: 14 }}><label className="field"><span className="field-label">작업물</span><textarea rows={3} value={draft.deliverables.join('\n')} onChange={(e) => changeDraft('deliverables', splitLines(e.target.value))} /></label><label className="field"><span className="field-label">작업 체크리스트</span><textarea rows={4} value={draft.tasks.join('\n')} onChange={(e) => changeDraft('tasks', splitLines(e.target.value))} /></label><label className="field"><span className="field-label">위험·확인 항목</span><textarea rows={4} value={draft.risks.join('\n')} onChange={(e) => changeDraft('risks', splitLines(e.target.value))} /></label></div>
            <div className="action-row" style={{ marginTop: 14 }}><button className="btn btn-primary" onClick={() => void saveDetails()} disabled={saving}>{saving ? '저장 중…' : '상세 저장'}</button><button className="btn btn-secondary" onClick={() => { setEditingId(null); setDraft(null); }}>취소</button></div>
          </div>}
          <div className="deal-footer"><select aria-label="거래 상태" value={deal.status} onChange={(event) => changeStatus(deal.id, event.target.value as DealStatus)} style={{ width: 'auto' }}>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select><div className="action-row"><span className={`badge badge-${deal.status.toLowerCase().replace('_', '-')}`}>{statusLabels[deal.status]}</span>{deal.notionPageUrl ? <a className="btn btn-secondary btn-sm" href={deal.notionPageUrl} target="_blank" rel="noreferrer">Notion에서 열기</a> : <button className="btn btn-secondary btn-sm" onClick={() => void sendToNotion(deal.id)} disabled={!notion?.configured || deal.status === 'REVIEW' || notionBusy !== null}>{notionBusy === deal.id ? '내보내는 중…' : 'Notion으로 보내기'}</button>}{google?.connected && <button className="btn btn-secondary btn-sm" onClick={() => void addToCalendar(deal.id)} disabled={(!deal.draftDueDate && !deal.publishDueDate && !deal.paymentDueDate) || googleBusy === deal.id} title={deal.calendarSyncedAt ? `마지막 등록: ${deal.calendarSyncedAt.slice(0, 10)}` : ''}>{googleBusy === deal.id ? '등록 중…' : deal.calendarSyncedAt ? '📅 재등록' : '📅 Calendar'}</button>}<button className="btn btn-secondary btn-sm" onClick={() => startEditing(deal)} disabled={editingId === deal.id}>상세 수정</button><button className="btn btn-danger btn-sm" onClick={() => remove(deal.id)}>삭제</button></div></div>
        </article>)}
      </div>
    </>
  );
}
