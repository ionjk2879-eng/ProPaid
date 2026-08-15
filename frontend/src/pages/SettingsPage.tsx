import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchAccountSummary, downloadAccountExport, revokeAllSessions, requestAccountDeletion, type AccountSummary } from '../api/account';
import { fetchNotionStatus, disconnectNotion, type NotionStatus } from '../api/notion';
import { fetchGoogleStatus, disconnectGoogle, type GoogleStatus } from '../api/google';

type Busy = 'export' | 'notion' | 'google' | 'sessions' | 'delete' | null;

export default function SettingsPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [notion, setNotion] = useState<NotionStatus | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    fetchAccountSummary().then(setSummary).catch(() => setError('계정 정보를 불러오지 못했습니다.'));
    fetchNotionStatus().then(setNotion).catch(() => {});
    fetchGoogleStatus().then(setGoogle).catch(() => {});
  }, []);

  const exportData = async () => {
    setBusy('export'); setError(null);
    try { await downloadAccountExport(); }
    catch { setError('데이터 내려받기에 실패했습니다.'); }
    finally { setBusy(null); }
  };

  const stopNotion = async () => {
    setBusy('notion'); setError(null);
    try { await disconnectNotion(); setNotion({ connected: false, configured: false, workspaceId: null, workspaceName: null, rootPageUrl: null, updatedAt: null }); setNotice('Notion 연결을 해제했습니다.'); }
    catch { setError('Notion 연결 해제에 실패했습니다.'); }
    finally { setBusy(null); }
  };

  const stopGoogleCalendar = async () => {
    setBusy('google'); setError(null);
    try { await disconnectGoogle(); setGoogle({ connected: false, email: null, updatedAt: null }); setNotice('Google Calendar 연결을 해제했습니다.'); }
    catch { setError('Google Calendar 연결 해제에 실패했습니다.'); }
    finally { setBusy(null); }
  };

  const forceLogoutEverywhere = async () => {
    if (!confirm('현재 기기를 포함한 모든 로그인 세션을 종료할까요? 다시 사용하려면 재로그인이 필요합니다.')) return;
    setBusy('sessions'); setError(null);
    try { await revokeAllSessions(); logout(); navigate('/login?revoked=1', { replace: true }); }
    catch { setError('세션 종료에 실패했습니다.'); setBusy(null); }
  };

  const confirmDelete = async (immediate: boolean) => {
    setBusy('delete'); setError(null);
    try {
      const result = await requestAccountDeletion(immediate);
      logout();
      navigate(result.status === 'deleted' ? '/login?deleted=now' : `/login?deleted=pending&graceDays=${result.graceDays ?? summary?.graceDays ?? 14}`, { replace: true });
    } catch { setError('회원 탈퇴 요청에 실패했습니다.'); setBusy(null); }
  };

  return (
    <>
      <header className="page-header"><div><p className="eyebrow">ACCOUNT</p><h1 className="page-title">설정</h1><p className="page-description">계정 정보, 데이터, 외부 연동, 보안을 관리합니다.</p></div></header>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

      <section className="card card-body" style={{ marginBottom: 20 }}>
        <h2 className="card-title">계정 정보</h2>
        {summary && <dl className="finance-summary-list" style={{ marginTop: 14 }}>
          <div><dt>이메일</dt><dd>{summary.email}</dd></div>
          <div><dt>닉네임</dt><dd>{summary.nickname}</dd></div>
          <div><dt>가입일</dt><dd>{summary.createdAt?.slice(0, 10)}</dd></div>
          <div><dt>플랜</dt><dd>{summary.planType}</dd></div>
        </dl>}
      </section>

      <section className="card card-body" style={{ marginBottom: 20 }}>
        <h2 className="card-title">데이터 내려받기</h2>
        <p className="card-copy">거래, 비용, 구독, 받은 제안 메일 분석 결과를 포함한 전체 데이터를 JSON 파일로 내려받습니다.</p>
        <div className="action-row" style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={() => void exportData()} disabled={busy === 'export'}>{busy === 'export' ? '준비 중…' : '⇩ 전체 데이터 내려받기'}</button>
        </div>
      </section>

      <section className="card card-body" style={{ marginBottom: 20 }}>
        <h2 className="card-title">연동 관리</h2>
        <div className="stack" style={{ marginTop: 14 }}>
          <div className="action-row" style={{ justifyContent: 'space-between' }}>
            <div><b>Notion</b><div className="helper">{notion?.connected ? `연결됨 · ${notion.workspaceName || '워크스페이스'}` : '연결 전'}</div></div>
            {notion?.connected && <button className="btn btn-secondary btn-sm" onClick={() => void stopNotion()} disabled={busy === 'notion'}>연결 해제</button>}
          </div>
          <div className="action-row" style={{ justifyContent: 'space-between' }}>
            <div><b>Google Calendar</b><div className="helper">{google?.connected ? `연결됨${google.email ? ` · ${google.email}` : ''}` : '연결 전'}</div></div>
            {google?.connected && <button className="btn btn-secondary btn-sm" onClick={() => void stopGoogleCalendar()} disabled={busy === 'google'}>연결 해제</button>}
          </div>
          <div className="action-row" style={{ justifyContent: 'space-between' }}>
            <div><b>Google 로그인</b><div className="helper">서비스 이용을 위한 유일한 로그인 수단이라 단독으로 해제할 수 없습니다. 해제하려면 회원 탈퇴를 이용하세요.</div></div>
            <button className="btn btn-secondary btn-sm" disabled title="유일한 로그인 수단은 해제할 수 없습니다">연결 해제</button>
          </div>
        </div>
      </section>

      <section className="card card-body" style={{ marginBottom: 20 }}>
        <h2 className="card-title">보안</h2>
        <p className="card-copy">다른 기기에서 로그인된 상태라면 이 계정으로 발급된 모든 로그인 세션(현재 기기 포함)을 즉시 종료할 수 있습니다.</p>
        <div className="action-row" style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={() => void forceLogoutEverywhere()} disabled={busy === 'sessions'}>{busy === 'sessions' ? '종료 중…' : '모든 기기에서 로그아웃'}</button>
        </div>
      </section>

      <section className="card card-body" style={{ borderColor: '#ffd5ca' }}>
        <h2 className="card-title" style={{ color: 'var(--danger)' }}>회원 탈퇴</h2>
        <p className="card-copy">탈퇴하면 거래, 비용, 구독, 증빙 파일, 외부 연동 정보가 모두 삭제됩니다. 이 작업은 신중하게 진행해주세요.</p>
        <div className="action-row" style={{ marginTop: 14 }}>
          <button className="btn btn-danger" onClick={() => setDeleteOpen(true)} disabled={!summary}>회원 탈퇴</button>
        </div>
      </section>

      <p className="helper" style={{ marginTop: 4 }}><Link to="/privacy">개인정보 처리방침 보기</Link></p>

      {deleteOpen && summary && (
        <div className="modal-backdrop" onClick={() => busy !== 'delete' && setDeleteOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div><p className="eyebrow">ACCOUNT DELETION</p><h2 className="card-title">탈퇴 전 삭제 범위를 확인하세요</h2></div>
              <button className="btn-icon" aria-label="닫기" onClick={() => setDeleteOpen(false)}>✕</button>
            </div>
            <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
              <li>거래 {summary.dataScope.deals}건, 비용 {summary.dataScope.expenses}건, 구독 {summary.dataScope.subscriptions}건</li>
              <li>증빙 파일 {summary.dataScope.evidenceFiles}건</li>
              <li>{summary.integrations.notion ? `Notion 연동 (${summary.integrations.notionWorkspace ?? '워크스페이스'})` : 'Notion 연동 없음'}</li>
              <li>{summary.integrations.googleCalendar ? 'Google Calendar 연동' : 'Google Calendar 연동 없음'}</li>
              <li>Google 로그인 계정 정보</li>
            </ul>
            <div className="alert alert-info" style={{ marginBottom: 0 }}>
              탈퇴 즉시 모든 기기에서 로그아웃되며, <b>{summary.graceDays}일 이내에 같은 Google 계정으로 다시 로그인하면 탈퇴가 취소되고 계정이 복구</b>됩니다. {summary.graceDays}일이 지나면 위 데이터는 서버에서 영구적으로 삭제되어 복구할 수 없습니다.
            </div>
            <div className="action-row" style={{ justifyContent: 'space-between', marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => void confirmDelete(true)} disabled={busy === 'delete'}>유예 없이 즉시 영구 삭제</button>
              <div className="action-row">
                <button className="btn btn-secondary" onClick={() => setDeleteOpen(false)} disabled={busy === 'delete'}>취소</button>
                <button className="btn btn-danger" onClick={() => void confirmDelete(false)} disabled={busy === 'delete'}>{busy === 'delete' ? '처리 중…' : `${summary.graceDays}일 유예 후 탈퇴`}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
