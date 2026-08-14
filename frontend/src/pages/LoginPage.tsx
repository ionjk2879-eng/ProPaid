import { useState } from 'react';
import { getGoogleLoginUrl } from '../api/auth';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      window.location.assign(await getGoogleLoginUrl());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google 로그인을 시작하지 못했습니다.');
      setGoogleLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      <section className="auth-panel"><div className="auth-card">
        <div className="brand"><span className="brand-mark" />Propaid</div>
        <h1 className="auth-title">Google로 간편하게 시작하세요</h1><p className="auth-copy">별도 회원가입 없이 Google 계정 하나로 제안부터 입금까지 관리하세요.</p>
        <button className="btn google-login-btn" type="button" onClick={handleGoogleLogin} disabled={googleLoading}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.37l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.39 13.92A6.02 6.02 0 0 1 6.07 12c0-.67.12-1.32.32-1.92V7.46H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.54l3.35-2.62Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.46l3.35 2.62C7.18 7.71 9.39 5.95 12 5.95Z"/></svg>
          {googleLoading ? 'Google로 이동 중…' : 'Google로 계속하기'}
        </button>
        {error && <div className="alert alert-error">{error}</div>}
        <p className="google-login-note">Google에서 확인된 이메일로 기존 데이터가 안전하게 연결됩니다.</p>
      </div></section>
      <aside className="auth-visual"><p className="eyebrow">SMART DEAL WORKSPACE</p><h2>메일 속 제안을<br />실제 수익으로 연결하세요.</h2><p>흩어진 협찬과 외주 메일을 한곳에 모으고, 놓치기 쉬운 조건과 일정을 Propaid이 정리합니다.</p><div className="auth-steps"><span className="auth-step">01 메일 전달</span><span className="auth-step">02 조건 확인</span><span className="auth-step">03 거래 관리</span><span className="auth-step">04 입금 완료</span></div></aside>
    </div>
  );
}
