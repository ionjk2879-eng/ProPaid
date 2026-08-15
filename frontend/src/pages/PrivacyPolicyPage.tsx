import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', margin: '14px 0 22px' };
const thStyle: CSSProperties = { textAlign: 'left', padding: '10px 12px', background: '#f6f8fb', border: '1px solid #e1e6ef', fontSize: 12, fontWeight: 800 };
const tdStyle: CSSProperties = { padding: '10px 12px', border: '1px solid #e1e6ef', fontSize: 13, verticalAlign: 'top' };

function Table({ head, rows }: { head: string[]; rows: (string | ReactNode)[][] }) {
  return (
    <table style={tableStyle}>
      <thead><tr>{head.map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} style={tdStyle}>{cell}</td>)}</tr>)}</tbody>
    </table>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fb' }}>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '48px 24px 80px' }}>
        <Link to="/login" className="brand" style={{ textDecoration: 'none', marginBottom: 28, display: 'inline-flex' }}>
          <span className="brand-mark"><img src="/favicon.svg" alt="" /></span>Propaid
        </Link>

        <div className="alert alert-info" style={{ marginBottom: 28 }}>
          이 페이지는 초안이며, 실제 시행 전 담당자 정보와 시행일자를 확정하고 개인정보 전문가의 검토를 받은 뒤 게시합니다.
          참고: 개인정보보호위원회, 「2026 개인정보 처리방침 작성지침」(2026.4.)
        </div>

        <h1 className="page-title" style={{ marginBottom: 8 }}>ProPaid 개인정보 처리방침</h1>
        <p className="page-description">공고일자: [YYYY-MM-DD] · 시행일자: [YYYY-MM-DD]</p>

        <p style={{ lineHeight: 1.8, fontSize: 14, marginTop: 20 }}>
          [운영자명](이하 &apos;ProPaid&apos;라 함)은(는) 정보주체의 자유와 권리 보호를 위해 「개인정보 보호법」 및 관계 법령이 정한 바를 준수하여, 적법하게 개인정보를 처리하고 안전하게 관리하고 있습니다.
          이에 「개인정보 보호법」 제30조에 따라 정보주체에게 개인정보의 처리와 보호에 관한 절차 및 기준을 안내하고, 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 하기 위하여 다음과 같이 개인정보 처리방침을 수립·공개합니다.
        </p>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">1. 개인정보의 처리 목적</h2>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>ProPaid는 다음의 목적을 위하여 개인정보를 처리하며, 목적 외 용도로는 이용하지 않습니다. 이용 목적이 변경되는 경우에는 「개인정보 보호법」 제18조에 따라 별도의 동의를 받는 등 필요한 조치를 이행합니다.</p>
          <ol style={{ lineHeight: 1.9, fontSize: 14, paddingLeft: 20 }}>
            <li><b>회원 가입 및 관리</b>: Google 계정을 통한 회원 식별·인증, 회원 자격 유지·관리, 부정 이용 방지, 고지·통지, 고충 처리</li>
            <li><b>협찬·외주 제안 분석 서비스 제공</b>: 사용자가 전달한 제안 메일 원문(직접 붙여넣기 또는 사용자별 전달 주소로 수신)에서 거래처, 금액, 결과물, 일정, 지급 조건 등을 구조화하여 확인용 초안 제공</li>
            <li><b>거래·재무 관리 서비스 제공</b>: 거래 상태 관리, 입금 예정일 관리, 비용·구독 등록, 손익 요약 제공</li>
            <li><b>증빙 관리</b>: 비용 증빙 파일(영수증, 세금계산서 등)의 업로드·보관·다운로드</li>
            <li><b>외부 도구 연동</b>: 사용자가 직접 연결을 선택한 경우에 한해 확인된 거래를 Notion 페이지로 내보내거나 Google Calendar에 일정 등록</li>
            <li><b>서비스 개선 및 부정 이용 방지</b>: 오류 처리, 서비스 이용 통계 분석, 비정상 접근 탐지</li>
            <li><b>법령상 의무 이행</b>: 관계 법령에 따른 보관·제공 의무 이행</li>
          </ol>
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">2. 처리하는 개인정보의 항목</h2>
          <p style={{ fontSize: 13, fontWeight: 700, marginTop: 16 }}>2-1. 동의 없이 처리하는 개인정보</p>
          <Table
            head={['처리 업무', '법적 근거', '처리 항목']}
            rows={[
              ['회원 가입 및 서비스 이용 (Google 로그인)', '제15조제1항제4호(계약 체결·이행)', '이메일 주소, 닉네임, Google 고유 식별자, 프로필 이름, 가입일, 최근 활동일'],
              ['협찬·외주 제안 분석', '제15조제1항제4호(계약 체결·이행)', '제안 메일 원문(발신자명·이메일, 제목, 본문 — 분석 중에만 처리, 기본적으로 저장하지 않음) 및 추출되어 저장되는 거래처명, 거래 유형, 금액, 결과물, 초안·게시·입금 예정일, 수정 횟수, 2차 활용 조건, 지급 조건'],
              ['전용 전달 주소를 통한 메일 수신', '제15조제1항제4호(계약 체결·이행)', '발신자 이메일, 수신 주소(사용자별 고유 토큰 포함), 제목, 수신 일시, 처리 상태. 메일 본문은 사용자가 확인 전까지 최대 30일간만 보관'],
              ['거래·재무 관리', '제15조제1항제4호(계약 체결·이행)', '거래처명, 거래 금액, 입금 상태, 비용 항목·금액·결제수단, 구독 서비스명·금액, 증빙 파일 및 메타데이터'],
              ['부정이용 방지, 접속 기록', '제15조제1항제4호, 제22조의6', '접속 로그, 세션 유효성 정보(토큰 버전), 인증 실패 기록'],
            ]}
          />
          <p style={{ fontSize: 13, fontWeight: 700 }}>2-2. 동의를 받아 처리하는 개인정보 (선택 기능)</p>
          <Table
            head={['처리 업무', '법적 근거', '처리 항목']}
            rows={[
              ['Notion 연동', '제15조제1항제1호(동의)', 'Notion 워크스페이스 식별자·명칭, 접근 토큰(암호화 저장), 내보낸 거래 데이터'],
              ['Google Calendar 연동', '제15조제1항제1호(동의)', 'Google 계정 이메일, 접근·갱신 토큰(암호화 저장), 등록한 일정'],
            ]}
          />
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
            ProPaid는 원천세, 계좌번호 전체, 주민등록번호 등 고유식별정보·민감정보의 입력을 서비스 이용에 요구하지 않습니다. 다만 사용자가 제안 메일 원문이나 증빙 파일에 이러한 정보를 직접 포함해 입력할 수 있으므로 되도록 입력하지 않도록 권장합니다.
            서비스 제공 과정에서 IP 주소, 브라우저 정보(User-Agent) 등이 자동으로 생성·수집될 수 있습니다.
            전용 전달 주소로 받은 메일의 첨부파일은 현재 저장·분석하지 않습니다.
          </p>
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">3. 개인정보의 처리 및 보유 기간</h2>
          <ol style={{ lineHeight: 1.9, fontSize: 14, paddingLeft: 20 }}>
            <li>
              <b>제안 메일 원문(직접 입력한 텍스트, 전달 주소로 받은 메일 본문)</b>: 원문은 분석 목적으로만 일시적으로 처리하며 기본적으로 저장하지 않습니다.
              직접 붙여넣기 분석은 저장 시 <b>&quot;원문도 함께 보관&quot;</b>을 명시적으로 선택한 경우에만 원문이 함께 저장되고, 그렇지 않으면 구조화된 필드만 저장됩니다.
              전달 주소로 받은 메일은 사용자가 확인(저장 처리)하기 전까지만 원문을 보관하며, 확인 즉시 원문은 삭제되고 발신자·제목·분석 결과만 남습니다.
              <b>30일 동안 확인하지 않은 메일은 원문이 자동으로 삭제</b>됩니다. 분석에 실패한 메일은 애초에 원문을 저장하지 않습니다.
            </li>
            <li>
              <b>회원 정보, 거래·비용·구독·증빙 데이터(구조화된 필드)</b>: 회원 탈퇴 시까지.
              탈퇴를 신청하면 신청 시점에 모든 기기에서 즉시 로그아웃되며, <b>탈퇴 신청일로부터 14일간 유예 기간</b>을 둡니다.
              유예 기간 중 동일한 Google 계정으로 다시 로그인하면 탈퇴가 취소되고 계정과 모든 데이터가 자동으로 복구됩니다.
              유예 기간이 지나면 데이터는 서버에서 영구적으로 삭제되며 복구할 수 없습니다. 유예 기간 없이 즉시 영구 삭제를 선택할 수도 있습니다.
            </li>
            <li><b>Notion·Google Calendar 연동 정보(접근 토큰)</b>: 사용자가 연동을 해제하는 즉시 삭제, 미해제 시 회원 탈퇴와 함께 삭제</li>
            <li><b>장기 미접속 계정</b>: 365일 이상 로그인 기록이 없으면 휴면 상태로 전환되어 기존 로그인 세션이 종료됩니다. 데이터 삭제가 아닌 보안 조치이며, 다시 로그인하면 정상 이용할 수 있습니다.</li>
            <li>
              <b>관계 법령에 따라 별도 보관 의무가 발생하는 경우</b>: 해당 법령이 정한 기간 동안 분리 보관 후 파기
              (해당 시 계약·청약철회 기록 5년, 대금결제·공급 기록 5년, 소비자 불만·분쟁 처리 기록 3년 — 「전자상거래 등에서의 소비자보호에 관한 법률 시행령」 제6조.
              위 항목은 유료 결제 기능이 실제로 도입되는 시점부터 적용되며, 현재 유료 플랜은 결제 기능 없이 준비 중입니다.)
            </li>
            <li>접속 기록 등 통신사실확인자료에 해당하는 정보(해당 시): 3개월(「통신비밀보호법」 제15조의2제2항)</li>
          </ol>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
            증빙 파일(영수증, 세금계산서 등)은 세무 신고·소명 자료로 장기간 필요할 수 있어 별도의 자동 만료를 적용하지 않으며, 사용자가 직접 삭제하거나 연결된 비용을 삭제할 때, 또는 회원 탈퇴 시(유예 기간 포함) 함께 영구 삭제됩니다.
          </p>
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">4. 개인정보의 파기 절차 및 방법</h2>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>
            ProPaid는 개인정보 보유기간의 경과, 처리 목적 달성, 회원 탈퇴 유예 기간 만료 등 개인정보가 불필요하게 되었을 때에는 지체 없이 해당 개인정보를 파기합니다.
          </p>
          <ol style={{ lineHeight: 1.9, fontSize: 14, paddingLeft: 20 }}>
            <li><b>파기 절차</b>: 회원 탈퇴(유예 기간 만료 시 자동 처리) 또는 개별 삭제 요청이 접수되면, 데이터베이스(Cloudflare D1)에서 해당 회원과 연결된 모든 레코드를 삭제하고, 파일 저장소(Cloudflare R2)의 증빙 파일도 함께 삭제합니다.</li>
            <li><b>파기 방법</b>: 전자적 파일 형태로 저장된 개인정보는 복구할 수 없는 방법으로 영구 삭제합니다. ProPaid는 개인정보를 종이 문서로 보관하지 않습니다.</li>
            <li><b>오류 로그 최소화</b>: 메일 수신·분석 처리 중 오류가 발생해도 오류 기록에는 정해진 안내 문구만 남기며, 메일 본문·거래처명·금액 등 개인정보는 포함하지 않습니다.</li>
          </ol>
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">5. 개인정보의 제3자 제공에 관한 사항</h2>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>
            ProPaid는 정보주체의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만 사용자가 스스로 Notion·Google Calendar 연동을 선택하고 확인된 거래를 직접 내보내는 경우에만 해당 데이터가 사용자 본인의 계정으로 전달됩니다(자세한 내용은 &quot;7. 개인정보의 국외 수집 및 이전에 관한 사항&quot; 참조). 그 외에 관계 법령에 따라 다음과 같이 제공될 수 있습니다.
          </p>
          <Table
            head={['관련 근거', '제공받는 자', '제공 목적', '제공 항목']}
            rows={[['제18조제2항제2호, 「형사소송법」 제215조', '수사기관', '압수·수색·검증 영장에 따른 요청', '요청 범위의 정보']]}
          />
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">6. 개인정보 처리업무의 위탁에 관한 사항</h2>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>
            ProPaid는 원활한 서비스 제공을 위하여 다음과 같이 개인정보 처리 업무를 외부 사업자에게 위탁하고 있습니다. 위탁계약 체결 시 「개인정보 보호법」 제26조에 따라 위탁업무 수행 목적 외 처리 금지, 기술적·관리적 보호조치, 재위탁 제한, 관리·감독, 손해배상 책임을 계약에 명시합니다. 위탁 내용이나 수탁자가 변경되면 지체 없이 이 방침을 통해 공개합니다.
          </p>
          <Table
            head={['수탁자', '위탁 업무', '국외 이전 여부']}
            rows={[
              ['Cloudflare, Inc.', '데이터베이스(D1) 및 파일 저장소(R2) 호스팅, 웹 서비스 인프라 운영', '국외(미국) — 7항 참조'],
              ['Resend, Inc.', '전용 전달 주소로 수신되는 제안 메일의 수신 및 본문 조회 대행', '국외(미국) — 7항 참조'],
              ['Anthropic, PBC', '(선택적) 제안 메일 원문을 분석해 거래처·금액·일정을 구조화하는 AI 분석 API 처리. 미설정 또는 실패 시 규칙 기반 분석기가 대신 처리하며 외부로 전송되지 않음', '국외(미국) — 7항 참조'],
            ]}
          />
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">7. 개인정보의 국외 수집 및 이전에 관한 사항</h2>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>
            ProPaid의 서비스 인프라(Cloudflare) 및 일부 연동 기능이 국외 사업자를 통해 제공되므로, 아래와 같이 개인정보가 국외로 이전(제공, 처리위탁, 보관)됩니다.
            국외 이전을 거부할 경우 해당 기능(회원 가입, 메일 수신 대행, AI 분석, Notion·Calendar 연동)의 이용이 제한되거나 불가능할 수 있습니다.
            국외 이전을 원치 않을 경우 설정 &gt; 회원 탈퇴를 통해 서비스 이용을 중단할 수 있습니다.
          </p>
          <p style={{ fontSize: 13, fontWeight: 700, marginTop: 16 }}>1. 개인정보 국외 처리위탁·보관</p>
          <Table
            head={['관련 근거', '이전 항목', '이전 국가', '이전받는 자', '이용 목적', '보유·이용 기간']}
            rows={[
              ['제28조의8제1항제3호', '회원·거래·비용·구독·증빙 파일 전체', '미국 등', 'Cloudflare, Inc.', '서비스 인프라 운영', '회원 탈퇴(유예기간 포함) 시까지'],
              ['제28조의8제1항제3호', '수신 메일의 발신자·제목·본문', '미국', 'Resend, Inc.', '전용 전달 주소 메일 본문 조회', '수신 처리 후 DB 저장, 회원 탈퇴 시까지'],
              ['제28조의8제1항제3호', '제안 메일 원문 텍스트', '미국', 'Anthropic, PBC', 'AI 기반 제안 분석(선택적, 결과 즉시 반환)', '응답 생성 후 즉시 반환 — 모델 학습 미활용(상업용 API 기본 정책)'],
            ]}
          />
          <p style={{ fontSize: 13, fontWeight: 700 }}>2. 개인정보 국외 이전 (사용자 요청에 따른 연동)</p>
          <Table
            head={['관련 근거', '이전 항목', '이전 국가', '이전받는 자', '이용 목적', '보유·이용 기간']}
            rows={[
              ['제28조의8제1항제1호(동의)', '연결을 선택한 거래의 거래처·상태·금액·일정', '미국', 'Notion Labs, Inc. (사용자 본인 워크스페이스)', '선택한 거래를 본인 Notion 페이지로 내보내기', '연동 해제 또는 회원 탈퇴 시까지'],
              ['제28조의8제1항제1호(동의)', '연결을 선택한 거래의 초안·게시·입금 예정일', '미국', 'Google LLC (사용자 본인 Calendar)', '선택한 일정을 본인 Calendar에 등록', '연동 해제 또는 회원 탈퇴 시까지'],
              ['제28조의8제1항제1호(동의)', '이메일, 프로필 이름, Google 고유 식별자', '미국', 'Google LLC', 'Google 계정을 통한 로그인 인증(openid email profile)', '회원 탈퇴 시까지'],
            ]}
          />
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">8. 생성형 인공지능(AI) 서비스 관련 사항</h2>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>ProPaid는 협찬·외주 제안 메일 분석 기능에서 선택적으로 Anthropic Claude API(생성형 AI)를 활용합니다.</p>
          <ol style={{ lineHeight: 1.9, fontSize: 14, paddingLeft: 20 }}>
            <li><b>의도된 용례</b>: 제안 메일 원문에서 거래처, 금액, 결과물, 일정, 지급 조건을 구조화하고 누락된 계약 조건을 안내하는 용도로만 사용합니다. 분석 결과는 계약·세무 자문이 아닌 참고용 초안이며, <b>사용자가 직접 확인한 뒤에만</b> 거래로 저장됩니다(자동화된 결정에 해당하지 않음).</li>
            <li><b>입력·결과물의 수집 및 활용 여부</b>: 전송된 메일 원문과 분석 결과는 응답을 받는 즉시 ProPaid 서버에 저장되며, Anthropic이 자체 모델 학습에 활용하지 않습니다(상업용 API 기본 정책 기준이며, 실제 계약 조건은 Anthropic 정책에 따름).</li>
            <li><b>AI 미사용 시 대체 처리</b>: API 키가 설정되지 않았거나 호출이 실패하면 외부로 데이터를 전송하지 않는 자체 규칙 기반 분석기가 대신 동작합니다.</li>
            <li><b>보유·이용 기간</b>: 메일 원문은 기본적으로 저장하지 않으며(사용자가 명시적으로 보관을 선택한 경우에만 저장), 분석 결과(구조화된 필드)는 회원 탈퇴 시까지 보관됩니다. Anthropic 측에는 원문과 결과 모두 별도로 보관되지 않습니다.</li>
            <li><b>정보주체의 통제권(Opt-out)</b>: 제안 메일 원문을 직접 입력하지 않거나, 저장된 거래·받은 메일 데이터를 개별 삭제할 수 있습니다. AI 분석을 원치 않으면 직접 분석 화면을 이용하지 않고 거래를 수동으로 등록할 수 있습니다.</li>
            <li><b>부적절한 결과에 대한 조치</b>: 분석 결과가 사실과 다르거나 부적절한 경우 저장 전 직접 수정할 수 있으며, 저장 후에도 거래 상세 정보를 언제든지 수정할 수 있습니다.</li>
          </ol>
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">9. 개인정보의 안전성 확보조치에 관한 사항</h2>
          <ol style={{ lineHeight: 1.9, fontSize: 14, paddingLeft: 20 }}>
            <li><b>관리적 조치</b>: 개인정보 취급 최소화, 회원 탈퇴 시 데이터 자동 파기 절차 운영</li>
            <li>
              <b>기술적 조치</b>: Notion·Google Calendar 연동 접근 토큰은 서버 비밀값에서 파생한 키로 AES-GCM 암호화 저장,
              JWT(HMAC-SHA256) 기반 인증과 세션 버전 관리로 필요 시 특정 계정의 모든 로그인 세션을 즉시 무효화,
              비밀번호 없는 Google OpenID Connect 전용 인증, 증빙 파일은 인증된 API로만 업로드·다운로드(공개 URL 미생성), 통신 구간 암호화(TLS/HTTPS) 적용
            </li>
            <li><b>물리적 조치</b>: 개인정보는 Cloudflare의 관리형 인프라(D1, R2)에 저장되며, ProPaid는 별도의 물리 서버를 운영하지 않습니다.</li>
          </ol>
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">10. 정보주체와 법정대리인의 권리·의무 및 행사방법</h2>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>정보주체는 ProPaid에 대해 언제든지 개인정보 열람·정정·삭제·처리정지 및 동의 철회 등을 요구할 수 있으며, 다음과 같은 방법으로 직접 행사할 수 있습니다.</p>
          <ul style={{ lineHeight: 1.9, fontSize: 14, paddingLeft: 20 }}>
            <li><b>데이터 열람 및 내려받기</b>: 설정 &gt; 데이터 내려받기에서 보유 중인 전체 데이터를 JSON 파일로 즉시 내려받을 수 있습니다.</li>
            <li><b>외부 연동 해제</b>: 설정 &gt; 연동 관리에서 Notion·Google Calendar 연동을 언제든지 해제할 수 있습니다.</li>
            <li><b>정정·삭제</b>: 거래·비용·구독 내역은 각 관리 화면에서 직접 수정하거나 삭제할 수 있습니다.</li>
            <li><b>세션 종료</b>: 설정 &gt; 보안에서 현재 기기를 포함한 모든 기기의 로그인 세션을 즉시 종료할 수 있습니다.</li>
            <li><b>처리정지(회원 탈퇴)</b>: 설정 &gt; 회원 탈퇴에서 삭제 범위를 확인한 뒤 탈퇴를 신청할 수 있습니다. 14일의 유예 기간이 부여되며, 유예 기간 내 재로그인 시 자동 복구됩니다. 유예 기간 없이 즉시 영구 삭제도 선택할 수 있습니다.</li>
          </ul>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>
            정보주체는 위 권리 행사를 대리인을 통해서도 할 수 있으며, 이 경우 위임장을 제출해야 합니다. ProPaid는 권리 행사를 한 자가 본인이거나 정당한 대리인인지 확인합니다.
            그 밖의 문의는 아래 &quot;12. 개인정보 보호책임자에 관한 사항&quot;의 연락처로 하실 수 있으며, 청구를 받은 날로부터 10일 이내에 회신합니다.
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>ProPaid는 만 14세 미만 아동을 대상으로 한 서비스가 아니며, 아동의 개인정보를 의도적으로 수집하지 않습니다.</p>
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">11. 개인정보 자동 수집 장치에 관한 사항</h2>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>
            ProPaid는 로그인 상태 유지를 위해 브라우저의 로컬 저장소(localStorage)에 인증 토큰과 닉네임을 저장합니다. 이는 광고·행태정보 수집 목적의 쿠키가 아니며, 로그아웃하거나 브라우저 데이터를 삭제하면 함께 삭제됩니다.
            ProPaid는 현재 광고 목적의 쿠키나 제3자 행태정보 수집 도구를 사용하지 않습니다.
          </p>
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">12. 개인정보 보호책임자에 관한 사항</h2>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>ProPaid는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 정보주체의 불만 처리 및 피해 구제 등을 위하여 아래와 같이 개인정보 보호책임자를 지정하고 있습니다.</p>
          <p style={{ lineHeight: 1.9, fontSize: 14 }}>
            <b>개인정보 보호책임자</b><br />
            성명: [성명] · 직위: [직위]<br />
            연락처: [전화번호], [이메일 주소]
          </p>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>정보주체는 ProPaid 서비스 이용 중 발생한 모든 개인정보 보호 관련 문의, 불만 처리, 피해 구제 등을 위 연락처로 문의할 수 있으며, 지체 없이 답변 및 처리합니다.</p>
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 className="card-title">13. 정보주체의 권익침해에 대한 구제방법</h2>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>정보주체는 아래 기관에 개인정보침해에 대한 신고, 상담을 문의할 수 있습니다.</p>
          <ul style={{ lineHeight: 1.9, fontSize: 14, paddingLeft: 20 }}>
            <li>개인정보분쟁조정위원회: (국번없이) 1833-6972 (www.kopico.go.kr)</li>
            <li>개인정보침해신고센터: (국번없이) 118 (privacy.kisa.or.kr)</li>
            <li>대검찰청: (국번없이) 1301 (www.spo.go.kr)</li>
            <li>경찰청: (국번없이) 182 (ecrm.police.go.kr)</li>
          </ul>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>「개인정보 보호법」 제35조, 제36조, 제37조에 따른 권리 침해 구제를 위해 중앙행정심판위원회에 행정심판을 청구할 수 있습니다. (국번없이 110, www.simpan.go.kr)</p>
        </section>

        <section style={{ marginTop: 36, marginBottom: 40 }}>
          <h2 className="card-title">14. 개인정보 처리방침의 변경에 관한 사항</h2>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>
            이 개인정보 처리방침은 [시행일자]부터 적용되며, 법령 및 방침에 따른 변경이 있는 경우 시행 최소 7일 전부터 서비스 내 공지사항을 통해 고지합니다.
            다만 개인정보의 수집·활용, 제3자 제공 등 정보주체 권리의 중대한 변경이 발생할 때에는 최소 30일 전에 고지합니다.
          </p>
          <Table head={['버전', '공고일자', '시행일자', '주요 변경 내용']} rows={[['v1.0', '[YYYY-MM-DD]', '[YYYY-MM-DD]', '최초 제정']]} />
        </section>
      </div>
    </div>
  );
}
