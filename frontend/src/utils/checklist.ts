import type { Deal } from '../api/deals';

export interface ChecklistItem {
  key: string;
  label: string;
  hint: string;
  foundValue: (deal: Deal) => string | null;
}

// 거래를 확정하기 전 메일 원문에서 직접 확인해야 하는 9개 고정 조건.
// 분석기가 값을 찾은 항목은 참고용으로 보여주되, 원문과 다를 수 있으므로 자동으로 확인 처리하지 않는다.
// 계약서 검토나 법률 자문이 아니라, 원문에 그 조건이 실제로 있는지 확인하는 용도다.
export const CHECKLIST_ITEMS: ChecklistItem[] = [
  { key: 'revisionCount', label: '수정 가능 횟수', hint: '몇 회까지 무료로 수정할 수 있는지', foundValue: (deal) => deal.revisionCount != null ? `${deal.revisionCount}회` : null },
  { key: 'secondaryUsage', label: '2차 활용 범위', hint: '원본 외 다른 채널·용도로도 쓸 수 있는지', foundValue: (deal) => deal.secondaryUsage },
  { key: 'adPeriod', label: '광고 집행 기간', hint: '유료 광고(부스팅)로 노출되는 기간', foundValue: () => null },
  { key: 'contentRetention', label: '콘텐츠 유지 기간', hint: '게시물을 최소 며칠 이상 내리지 않고 유지해야 하는지', foundValue: () => null },
  { key: 'originalFile', label: '원본 파일 제공 여부', hint: '편집 원본·고화질 파일을 별도로 전달해야 하는지', foundValue: () => null },
  { key: 'portraitCopyright', label: '초상권·저작권 범위', hint: '출연자 초상권과 콘텐츠 저작권이 어디까지 넘어가는지', foundValue: () => null },
  { key: 'paymentDate', label: '지급일', hint: '입금이 정확히 언제 이뤄지는지', foundValue: (deal) => deal.paymentDueDate },
  { key: 'taxWithholding', label: '세금계산서 또는 원천징수 방식', hint: '세금계산서 발행인지 원천징수(3.3%) 후 지급인지', foundValue: (deal) => deal.paymentCondition?.includes('세금계산서') ? deal.paymentCondition
    : deal.risks.some((risk) => risk.includes('원천징수')) ? '원천징수 포함 가능성 (원문 확인 필요)' : null },
  { key: 'cancellationTerms', label: '취소·변경 조건', hint: '거래처 사정으로 취소·연기될 때 어떻게 처리하는지', foundValue: () => null },
];

export function unconfirmedCount(deal: Deal): number {
  return CHECKLIST_ITEMS.length - deal.checklistConfirmed.filter((key) => CHECKLIST_ITEMS.some((item) => item.key === key)).length;
}
