import { describe, expect, it } from 'vitest';
import { analyzeProposal } from './analyze';

// 규칙 기반 분석기는 정규식 패턴의 집합이라, 문장 표현이 조금만 달라져도 조용히 필드를 놓칠 수 있다
// (예: "2차 사용"만 인식하고 "2차 활용"은 놓치는 식). 이 테스트는 그런 회귀를 막기 위한 것으로,
// analyze.ts를 고칠 때마다 반드시 `npm test`로 돌려봐야 한다.

describe('기본 예시 4종 (프런트엔드 "예시 불러오기"와 동일한 문구)', () => {
  it('외주/유튜브 — 초안·게시 기한이 둘 다 라벨 없이/있게 섞여 있는 경우', () => {
    const result = analyzeProposal(`모바일 웹 화면 개발 외주를 제안드립니다.
브랜드: A 브랜드
8월 20일까지 유튜브 영상 1건과 쇼츠 2건 부탁드립니다.
초안은 8월 14일까지 전달 부탁드리며, 2차 활용은 3개월입니다.
비용은 원천세 포함 150만원이고 게시 후 익월 말 지급입니다.`);
    const year = new Date().getFullYear();
    expect(result.client).toBe('A 브랜드');
    expect(result.dealType).toBe('유튜브 협찬');
    expect(result.amount).toBe(1_500_000);
    expect(result.draftDueDate).toBe(`${year}-08-14`);
    expect(result.publishDueDate).toBe(`${year}-08-20`); // "게시" 라벨 없이 "까지 ... 부탁드립니다"로만 표현됨
    expect(result.secondaryUsage).toBe('3개월'); // "2차 활용"(사용이 아님)
    expect(result.paymentCondition).toBe('익월 지급');
    expect(result.risks).toContain('원천징수 포함 금액인지 실수령액 확인 필요'); // "원천세"도 인식해야 함
  });

  it('인스타그램/릴스 — 라벨이 명시적이고 조사가 바로 붙는 경우', () => {
    const result = analyzeProposal(`인스타그램 릴스 협찬을 제안드립니다.
광고주: B 코스메틱
릴스 1건, 인스타그램 게시물 2건 제작 부탁드립니다.
게시일은 9월 5일입니다.
수정 3회까지 가능합니다.
비용은 80만원이며 착수금 30%, 잔금 70%로 나눠 지급합니다.
2차 활용 기간은 6개월입니다.`);
    const year = new Date().getFullYear();
    expect(result.client).toBe('B 코스메틱');
    expect(result.dealType).toBe('인스타그램 협찬');
    expect(result.deliverables).toEqual(['릴스 1건', '인스타그램 게시물 2건']);
    expect(result.publishDueDate).toBe(`${year}-09-05`);
    expect(result.revisionCount).toBe(3);
    expect(result.paymentCondition).toBe('착수금 30% · 잔금 70%');
    expect(result.secondaryUsage).toBe('6개월'); // "활용 기간은"처럼 기간+조사가 함께 붙는 경우
    expect(result.risks).toEqual([]);
  });

  it('블로그/ISO 날짜 — 연도 포함 날짜, 검수 기반 지급 조건', () => {
    const result = analyzeProposal(`블로그 포스트 제작 건으로 연락드립니다.
클라이언트: C 브랜드
블로그 포스트 2건 작성 요청드립니다.
초안 마감은 2026-09-10이고, 게시는 2026-09-15로 예정되어 있습니다.
검수 완료 후 5일 이내 세금계산서 발행 후 입금 예정입니다.
금액은 원천징수 포함 60만원입니다.`);
    expect(result.client).toBe('C 브랜드');
    expect(result.dealType).toBe('블로그 광고');
    expect(result.draftDueDate).toBe('2026-09-10');
    expect(result.publishDueDate).toBe('2026-09-15');
    expect(result.startDate).toBe('2026-09-10');
    expect(result.endDate).toBe('2026-09-15');
    expect(result.paymentCondition).toBe('검수 후 5일 이내');
  });

  it('짧은 외주/최소 정보 — 라벨에 조사가 바로 붙고 문장이 "입니다"로 끝나는 경우', () => {
    const result = analyzeProposal(`외주 건 문의드려요.
거래처는 D 스튜디오입니다.
숏츠 3건 제작 부탁드립니다.
예산은 45만원이고 잔금 100%입니다.`);
    expect(result.client).toBe('D 스튜디오'); // "는"과 "입니다"가 함께 딸려오면 안 됨
    expect(result.amount).toBe(450_000);
    expect(result.paymentCondition).toBe('잔금 100%');
    expect(result.draftDueDate).toBeNull();
    expect(result.publishDueDate).toBeNull();
  });
});

describe('엣지 케이스', () => {
  it('틱톡 협찬을 인식한다', () => {
    const result = analyzeProposal('틱톡 영상 2건 제작 부탁드립니다. 브랜드: E 브랜드. 비용은 70만원입니다.');
    expect(result.dealType).toBe('틱톡 협찬');
    expect(result.deliverables).toEqual(['틱톡 영상 2건']);
  });

  it('작업물 단위가 "편"이어도 인식한다', () => {
    const result = analyzeProposal('유튜브 영상 2편 제작을 요청드립니다.');
    expect(result.deliverables).toEqual(['유튜브 영상 2편']);
  });

  it('소수점 금액을 정확히 환산한다', () => {
    const result = analyzeProposal('비용은 150.5만원입니다.');
    expect(result.amount).toBe(1_505_000);
  });

  it('부가세 표기가 섞여 있어도 금액 추출에 영향 없다', () => {
    const result = analyzeProposal('비용은 100만원(부가세 별도)입니다.');
    expect(result.amount).toBe(1_000_000);
  });

  it('한 문장에 서로 다른 채널의 작업물이 섞여 있어도 각각 추출한다', () => {
    const result = analyzeProposal('유튜브 영상 1건과 인스타그램 게시물 3건을 요청드립니다.');
    expect(result.deliverables).toEqual(['유튜브 영상 1건', '인스타그램 게시물 3건']);
  });

  it('구체적 채널 없이 "광고"만 언급되면 광고로 분류한다', () => {
    const result = analyzeProposal('신제품 광고를 의뢰드립니다. 비용은 30만원입니다.');
    expect(result.dealType).toBe('광고');
  });

  it('라벨 뒤에 조사가 붙는 다른 필드(금액은/지급 조건은)도 정상 처리한다', () => {
    // 현재 금액 라벨은 선택 사항이라 "금액은"의 조사 자체는 문제되지 않지만,
    // 회귀 확인을 위해 명시적으로 테스트해 둔다.
    const result = analyzeProposal('금액은 55만원이고 지급 조건은 익월 지급입니다.');
    expect(result.amount).toBe(550_000);
    expect(result.paymentCondition).toBe('익월 지급');
  });

  it('빈 원문에도 예외 없이 모든 필드를 null/빈 배열로 반환한다', () => {
    const result = analyzeProposal('');
    expect(result.client).toBeNull();
    expect(result.amount).toBeNull();
    expect(result.deliverables).toEqual([]);
    expect(result.risks.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('제안과 무관한 원문에도 예외 없이 정보 없음으로 처리한다', () => {
    const result = analyzeProposal('안녕하세요, 오늘 날씨가 좋네요. 좋은 하루 되세요.');
    expect(result.client).toBeNull();
    expect(result.dealType).toBeNull();
    expect(result.amount).toBeNull();
    expect(result.deliverables).toEqual([]);
  });
});
