import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchDeals, type Deal } from '../api/deals';
import { fetchInboxMessages, type InboxMessage } from '../api/inbox';
import OverdueWorkspace from '../components/OverdueWorkspace';
import { isOverdue } from '../utils/dunning';

function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localIso(date);
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${iso}T00:00:00`));
}

interface TodayItem {
  key: string;
  to: string;
  title: string;
  sub: string;
  tag?: string;
  tagClass?: string;
}

function SectionCard({ eyebrow, title, description, items, emptyText, moreLink, moreCount }: {
  eyebrow: string; title: string; description: string; items: TodayItem[]; emptyText: string; moreLink?: string; moreCount?: number;
}) {
  return (
    <section className="card card-body today-section-card">
      <div className="today-card-head">
        <div><p className="eyebrow">{eyebrow}</p><h2 className="card-title">{title}</h2><p className="card-copy">{description}</p></div>
        {items.length > 0 && <span className="badge badge-review">{items.length}건</span>}
      </div>
      {items.length === 0
        ? <div className="today-card-empty">{emptyText}</div>
        : <div className="today-item-list">
          {items.map((item) => (
            <Link key={item.key} to={item.to} className="today-item">
              <span className="today-item-main"><span className="today-item-title">{item.title}</span><span className="today-item-sub">{item.sub}</span></span>
              {item.tag && <span className={`today-item-tag ${item.tagClass ?? 'badge-free'}`}>{item.tag}</span>}
            </Link>
          ))}
          {moreLink && moreCount !== undefined && moreCount > 0 && <Link to={moreLink} className="today-more">+{moreCount}건 더 보기 →</Link>}
        </div>}
    </section>
  );
}

const SECTION_LIMIT = 5;

export default function TodayPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([fetchDeals(), fetchInboxMessages()])
      .then(([nextDeals, nextMessages]) => { setDeals(nextDeals); setMessages(nextMessages); })
      .catch(() => setError('오늘 할 일을 불러오지 못했습니다.'))
      .finally(() => setLoaded(true));
  }, []);

  const todayIso = localIso(new Date());
  const weekEndIso = addDays(6);
  const paymentWindowIso = addDays(14);
  const activeDeals = deals.filter((deal) => deal.status !== 'PAID');

  const draftsDueToday = activeDeals.filter((deal) => deal.draftDueDate === todayIso);
  const publishThisWeek = activeDeals.filter((deal) => deal.publishDueDate && deal.publishDueDate >= todayIso && deal.publishDueDate <= weekEndIso)
    .sort((a, b) => a.publishDueDate!.localeCompare(b.publishDueDate!));
  const unreviewedProposals = messages.filter((message) => message.status === 'REVIEW');
  const upcomingPayments = activeDeals.filter((deal) => deal.paymentDueDate && deal.paymentDueDate >= todayIso && deal.paymentDueDate <= paymentWindowIso)
    .sort((a, b) => a.paymentDueDate!.localeCompare(b.paymentDueDate!));
  const overduePayments = deals.filter(isOverdue);
  const missingTerms = activeDeals.filter((deal) => deal.risks.length > 0);
  const exportFailures = deals.filter((deal) => deal.notionExportStatus === 'FAILED' || deal.calendarSyncStatus === 'FAILED');

  const totalActionable = draftsDueToday.length + publishThisWeek.length + unreviewedProposals.length
    + upcomingPayments.length + overduePayments.length + missingTerms.length + exportFailures.length;

  const dealItem = (deal: Deal, sub: string, tag?: string, tagClass?: string): TodayItem =>
    ({ key: String(deal.id), to: `/deals?deal=${deal.id}`, title: deal.client ?? '거래처 확인 필요', sub, tag, tagClass });

  return (
    <>
      <header className="page-header"><div><p className="eyebrow">TODAY</p><h1 className="page-title">오늘 할 일</h1><p className="page-description">오늘 처리하지 않으면 놓치는 일정과 확인만 모았습니다. 통계는 재무 관리에서 확인하세요.</p></div></header>
      {error && <div className="alert alert-error">{error}</div>}

      {loaded && totalActionable === 0 && !error && (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          <div className="empty-icon">✓</div>
          <h3>오늘 처리할 일이 없어요</h3>
          <p>마감·게시 일정, 입금, 누락 조건, 내보내기 실패가 없습니다. 좋은 하루 보내세요.</p>
        </div>
      )}

      {overduePayments.length > 0 && <OverdueWorkspace deals={overduePayments} />}

      <div className="today-grid">
        <SectionCard eyebrow="DRAFT" title="오늘 마감인 초안" description="오늘까지 초안을 전달해야 하는 거래입니다."
          items={draftsDueToday.slice(0, SECTION_LIMIT).map((deal) => dealItem(deal, `초안 기한 ${formatDate(deal.draftDueDate)}`, '오늘', 'badge-review'))}
          emptyText="오늘 마감인 초안이 없습니다." moreLink="/deals" moreCount={draftsDueToday.length - SECTION_LIMIT} />

        <SectionCard eyebrow="PUBLISH" title="이번 주 게시 일정" description="앞으로 7일 안에 게시해야 하는 거래입니다."
          items={publishThisWeek.slice(0, SECTION_LIMIT).map((deal) => dealItem(deal, `게시 기한 ${formatDate(deal.publishDueDate)}`))}
          emptyText="이번 주 게시 일정이 없습니다." moreLink="/deals" moreCount={publishThisWeek.length - SECTION_LIMIT} />

        <SectionCard eyebrow="INBOX" title="확인하지 않은 제안" description="받은 메일함에서 아직 확인하지 않은 제안입니다."
          items={unreviewedProposals.slice(0, SECTION_LIMIT).map((message) => ({ key: String(message.id), to: '/inbox', title: message.subject || '제목 없음', sub: message.sender || '발신자 정보 없음' }))}
          emptyText="확인하지 않은 제안이 없습니다." moreLink="/inbox" moreCount={unreviewedProposals.length - SECTION_LIMIT} />

        <SectionCard eyebrow="PAYMENT" title="입금 예정 거래" description="앞으로 14일 안에 입금 예정일이 있는 거래입니다."
          items={upcomingPayments.slice(0, SECTION_LIMIT).map((deal) => dealItem(deal, `입금 예정일 ${formatDate(deal.paymentDueDate)} · ${deal.amount == null ? '금액 확인 필요' : `${deal.amount.toLocaleString('ko-KR')}원`}`))}
          emptyText="입금 예정 거래가 없습니다." moreLink="/deals" moreCount={upcomingPayments.length - SECTION_LIMIT} />

        <SectionCard eyebrow="RISK" title="조건이 누락된 거래" description="확인이 필요한 위험·누락 항목이 있는 거래입니다."
          items={missingTerms.slice(0, SECTION_LIMIT).map((deal) => dealItem(deal, deal.risks.join(' · '), String(deal.risks.length), 'badge-review'))}
          emptyText="조건이 누락된 거래가 없습니다." moreLink="/deals" moreCount={missingTerms.length - SECTION_LIMIT} />

        <SectionCard eyebrow="SYNC" title="Notion·Calendar 내보내기 실패" description="최근 내보내기에 실패해 다시 확인이 필요한 거래입니다."
          items={exportFailures.slice(0, SECTION_LIMIT).map((deal) => dealItem(deal,
            [deal.notionExportStatus === 'FAILED' ? `Notion ${deal.notionExportAttempts}회 실패` : null, deal.calendarSyncStatus === 'FAILED' ? `Calendar ${deal.calendarSyncAttempts}회 실패` : null].filter(Boolean).join(' · ')))}
          emptyText="최근 내보내기 실패가 없습니다." moreLink="/deals" moreCount={exportFailures.length - SECTION_LIMIT} />

        {overduePayments.length === 0 && (
          <section className="card card-body today-section-card">
            <div className="today-card-head"><div><p className="eyebrow">OVERDUE</p><h2 className="card-title">입금 지연 거래</h2><p className="card-copy">예정일이 지났는데 입금이 확인되지 않은 거래입니다.</p></div></div>
            <div className="today-card-empty">입금이 지연된 거래가 없습니다.</div>
          </section>
        )}
      </div>
    </>
  );
}
