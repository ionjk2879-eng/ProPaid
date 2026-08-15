export interface ProposalAnalysis {
  client: string | null;
  dealType: string | null;
  amount: number | null;
  currency: string | null;
  deliverables: string[];
  draftDueDate: string | null;
  publishDueDate: string | null;
  revisionCount: number | null;
  secondaryUsage: string | null;
  paymentCondition: string | null;
  tasks: string[];
  risks: string[];
  startDate: string | null;
  endDate: string | null;
  paymentTerms: string[];
  matchedRules: string[];
  warnings: string[];
}

function first(text: string, pattern: RegExp, group = 1): string | null {
  return text.match(pattern)?.[group]?.trim() || null;
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function contextualDate(text: string, label: string): string | null {
  const full = first(text, new RegExp(`${label}[^\\n.]{0,40}?(20\\d{2}[.\\-/년\\s]+\\d{1,2}[.\\-/월\\s]+\\d{1,2})`));
  if (full) return normalizeDate(full);
  const short = text.match(new RegExp(`${label}[^\\n.]{0,30}?(\\d{1,2})월\\s*(\\d{1,2})일`));
  if (!short) return null;
  const year = new Date().getFullYear();
  return `${year}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`;
}

// "게시" 같은 라벨 없이 "8월 20일까지 유튜브 영상 1건... 부탁드립니다"처럼 날짜 뒤에 곧바로
// 작업물이 나오는 문장도 게시(납품) 기한으로 본다. exclude와 같은 날짜면(초안 기한과 중복) 무시한다.
function deliverableDeadline(text: string, exclude: string | null): string | null {
  const match = text.match(/(\d{1,2})월\s*(\d{1,2})일\s*까지[^\n.]{0,40}?(?:유튜브|숏츠|릴스|인스타그램|블로그|영상|게시물)/);
  if (!match) return null;
  const year = new Date().getFullYear();
  const date = `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return date === exclude ? null : date;
}

export function analyzeProposal(raw: string): ProposalAnalysis {
  const text = raw.replace(/\u00a0/g, ' ').trim();
  const warnings: string[] = [];
  const risks: string[] = [];
  const matchedRules: string[] = [];

  const client = first(text, /(?:거래처|브랜드|광고주|클라이언트)\s*[:：]?\s*([^\n,]{1,60}?)(?=\s+(?:유튜브|숏츠|인스타그램|릴스|블로그|영상|게시물|금액|예산|보수)|[,\n]|$)/);
  if (client) matchedRules.push('거래처 표현'); else warnings.push('거래처를 찾지 못했습니다.');

  const dealType = /유튜브|숏츠/.test(text) ? '유튜브 협찬'
    : /인스타그램|릴스/.test(text) ? '인스타그램 협찬'
      : /블로그/.test(text) ? '블로그 광고' : /광고/.test(text) ? '광고' : /외주/.test(text) ? '외주' : null;
  if (dealType) matchedRules.push('채널·제안 유형');

  const deliverables = [...text.matchAll(/(유튜브\s*영상|숏츠|릴스|인스타그램\s*게시물|블로그\s*포스트|영상|게시물)\s*(\d+)\s*건/gi)]
    .map((match) => `${match[1].replace(/\s+/g, ' ')} ${match[2]}건`)
    .filter((value, index, all) => all.indexOf(value) === index);
  if (deliverables.length) matchedRules.push('작업물 수량'); else warnings.push('작업 범위를 찾지 못했습니다.');

  let amount: number | null = null;
  for (const match of text.matchAll(/(?:금액|예산|보수|대금|총액|견적)?\s*[:：]?\s*(?:₩|KRW)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(만원|천원|원|KRW)/gi)) {
    const multiplier = match[2].toLowerCase() === '만원' ? 10_000 : match[2].toLowerCase() === '천원' ? 1_000 : 1;
    const value = Math.round(Number(match[1].replace(/,/g, '')) * multiplier);
    if (amount === null || value > amount) amount = value;
  }
  if (amount !== null) matchedRules.push('금액 표현'); else warnings.push('금액을 찾지 못했습니다.');

  const dates = [...text.matchAll(/20\d{2}[.\-/년\s]+\d{1,2}[.\-/월\s]+\d{1,2}일?/g)].map((m) => normalizeDate(m[0])).filter(Boolean) as string[];
  const startDate = dates[0] ?? null;
  const endDate = dates[1] ?? null;
  if (dates.length) matchedRules.push('날짜 표현'); else warnings.push('프로젝트 날짜를 찾지 못했습니다.');

  const draftDueDate = contextualDate(text, '초안');
  const publishDueDate = contextualDate(text, '(?:게시|업로드)') ?? deliverableDeadline(text, draftDueDate);
  if (draftDueDate || publishDueDate) matchedRules.push('초안·게시 기한');

  const revisionText = first(text, /수정(?:\s*가능)?\s*[:：]?\s*(\d+)\s*회/);
  const revisionCount = revisionText ? Number(revisionText) : null;
  if (revisionCount !== null) matchedRules.push('수정 횟수'); else risks.push('수정 횟수가 명시되지 않음');

  // "2차 사용"과 "2차 활용"은 계약서에서 같은 뜻으로 섞어 쓰이고, 조사(은/는)가 라벨에 바로 붙는 경우도 있다.
  const secondaryUsage = first(text, /2차\s*(?:사용|활용)(?:\s*기간)?(?:은|는)?\s*[:：]?\s*(\d+\s*(?:개월|년))/);
  if (secondaryUsage) matchedRules.push('2차 사용 기간'); else risks.push('2차 사용 조건이 명시되지 않음');

  const paymentTerms: string[] = [];
  for (const match of text.matchAll(/(선금|착수금|중도금|잔금)\s*([0-9]{1,3})\s*%/g)) paymentTerms.push(`${match[1]} ${match[2]}%`);
  for (const match of text.matchAll(/(검수|납품|세금계산서\s*발행)\s*(?:후|완료\s*후)?\s*(\d{1,3})\s*일\s*(?:이내|후)?/g)) paymentTerms.push(`${match[1].replace(/\s+/g, ' ')} 후 ${match[2]}일 이내`);
  if (/월말\s*지급/.test(text)) paymentTerms.push('월말 지급');
  if (/익월\s*(?:말\s*)?지급|다음\s*달\s*지급/.test(text)) paymentTerms.push('익월 지급');
  const uniqueTerms = [...new Set(paymentTerms)];
  const paymentCondition = uniqueTerms.length ? uniqueTerms.join(' · ') : null;
  if (paymentCondition) matchedRules.push('지급 조건'); else { warnings.push('지급 조건을 찾지 못했습니다.'); risks.push('입금 조건이 명시되지 않음'); }
  if (/원천징수\s*포함/.test(text)) risks.push('원천징수 포함 금액인지 실수령액 확인 필요');

  const tasks = deliverables.map((item) => `${item} 제작`);
  if (draftDueDate) tasks.push(`${draftDueDate}까지 초안 전달`);
  if (publishDueDate) tasks.push(`${publishDueDate}까지 게시`);
  if (paymentCondition) tasks.push(`입금 예정일 확인: ${paymentCondition}`);

  return { client, dealType, amount, currency: amount === null ? null : 'KRW', deliverables, draftDueDate,
    publishDueDate, revisionCount, secondaryUsage, paymentCondition, tasks, risks, startDate, endDate,
    paymentTerms: uniqueTerms, matchedRules, warnings };
}
