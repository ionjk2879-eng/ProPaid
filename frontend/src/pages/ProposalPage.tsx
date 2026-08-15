import { useState, type FormEvent } from 'react';
import { isAxiosError } from 'axios';
import { previewProposal, type ProposalAnalysis } from '../api/proposal';
import ProposalEditor from '../components/proposal/ProposalEditor';
import AnalysisResult from '../components/proposal/AnalysisResult';
import TurnstileWidget from '../components/TurnstileWidget';
import { createDeal } from '../api/deals';

const turnstileConfigured = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY);

// "예시 불러오기"를 누를 때마다 다음 예시로 순환한다. 채널·날짜 표기·지급 조건 표현을
// 서로 다르게 섞어, 분석기가 다양한 문장 패턴을 커버하는지 눈으로도 확인할 수 있게 했다.
const examples = [
  `모바일 웹 화면 개발 외주를 제안드립니다.
브랜드: A 브랜드
8월 20일까지 유튜브 영상 1건과 쇼츠 2건 부탁드립니다.
초안은 8월 14일까지 전달 부탁드리며, 2차 활용은 3개월입니다.
비용은 원천세 포함 150만원이고 게시 후 익월 말 지급입니다.`,
  `인스타그램 릴스 협찬을 제안드립니다.
광고주: B 코스메틱
릴스 1건, 인스타그램 게시물 2건 제작 부탁드립니다.
게시일은 9월 5일입니다.
수정 3회까지 가능합니다.
비용은 80만원이며 착수금 30%, 잔금 70%로 나눠 지급합니다.
2차 활용 기간은 6개월입니다.`,
  `블로그 포스트 제작 건으로 연락드립니다.
클라이언트: C 브랜드
블로그 포스트 2건 작성 요청드립니다.
초안 마감은 2026-09-10이고, 게시는 2026-09-15로 예정되어 있습니다.
검수 완료 후 5일 이내 세금계산서 발행 후 입금 예정입니다.
금액은 원천징수 포함 60만원입니다.`,
  `외주 건 문의드려요.
거래처는 D 스튜디오입니다.
숏츠 3건 제작 부탁드립니다.
예산은 45만원이고 잔금 100%입니다.`,
];

export default function ProposalPage() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ProposalAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [exampleIndex, setExampleIndex] = useState(0);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      setResult(await previewProposal(text, turnstileToken));
    } catch (err) {
      setResult(null);
      setError(isAxiosError(err) ? err.response?.data?.message ?? '분석에 실패했습니다.' : '분석에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (keepRawText: boolean) => {
    if (!result) return;
    setSaving(true);
    setError(null);
    try { await createDeal(result, text, keepRawText); setSaved(true); }
    catch { setError('거래 저장에 실패했습니다.'); }
    finally { setSaving(false); }
  };

  const handleResultChange = (next: ProposalAnalysis) => {
    setResult(next);
    setSaved(false);
  };

  return (
    <>
      <header className="page-header"><div><p className="eyebrow">MANUAL ANALYSIS</p><h1 className="page-title">제안 직접 분석</h1><p className="page-description">메일이나 메신저로 받은 내용을 붙여넣으면 거래 조건, 일정, 확인할 위험을 구조화합니다.</p></div></header>
      {error && <div className="alert alert-error">{error}</div>}
      <div className={`proposal-workspace${result ? ' proposal-workspace-result' : ''}`}>
        <section className="card card-body proposal-source-card">
          <div className="proposal-panel-heading"><div><p className="eyebrow">SOURCE</p><h2 className="card-title">메일 원문</h2></div>{result && <span className="badge badge-confirmed">분석 완료</span>}</div>
          <div className="alert alert-info">원문에 없는 조건은 임의로 채우지 않습니다. 분석 결과는 메일 원문 기준 정보 표시이며 법률·계약 자문이 아닙니다. 계약 전 원문을 직접 확인하세요.</div>
          <ProposalEditor
            text={text}
            loading={loading}
            onTextChange={setText}
            onLoadExample={() => { setText(examples[exampleIndex]); setExampleIndex((index) => (index + 1) % examples.length); }}
            onSubmit={handleSubmit}
            submitDisabled={turnstileConfigured && !turnstileToken}
            belowEditor={<TurnstileWidget onVerify={setTurnstileToken} onExpire={() => setTurnstileToken(undefined)} />}
          />
        </section>
        {result && <AnalysisResult result={result} saving={saving} saved={saved} onChange={handleResultChange} onSave={handleSave} />}
      </div>
    </>
  );
}
