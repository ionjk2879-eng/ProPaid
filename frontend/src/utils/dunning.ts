import type { Deal } from '../api/deals';

export function isOverdue(deal: Deal): boolean {
  if (!deal.paymentDueDate || deal.status === 'PAID') return false;
  return new Date(deal.paymentDueDate) < new Date(new Date().toDateString());
}

export function generateDunningDraft(deal: Deal): string {
  const client = deal.client ?? '담당자';
  const amount = deal.amount != null ? `${deal.amount.toLocaleString('ko-KR')}원` : '협의 금액';
  const dueDate = deal.paymentDueDate ?? '';
  const deliverables = deal.deliverables.length > 0 ? deal.deliverables.join(', ') : '작업';

  return `안녕하세요, ${client} 담당자님.

${deliverables} 관련하여 연락드립니다.

입금 예정일(${dueDate})이 지났으나 아직 입금이 확인되지 않아 확인 요청드립니다.

- 거래 내용: ${deliverables}
- 제안 금액: ${amount}
- 입금 예정일: ${dueDate}

바쁘신 중에 번거롭게 해드려 죄송합니다.
입금 일정을 알려주시면 감사하겠습니다.

감사합니다.`;
}
