import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getGoogleLoginUrl, login } from '../api/auth';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await login(email, password);
      setAuth(res.accessToken, res.nickname);
      navigate('/dashboard');
    } catch {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
    }
  };

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
        <h1 className="auth-title">다시 만나 반가워요</h1><p className="auth-copy">제안부터 입금까지, 오늘의 업무를 이어서 정리하세요.</p>
        <button className="btn google-login-btn" type="button" onClick={handleGoogleLogin} disabled={googleLoading}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.37l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.39 13.92A6.02 6.02 0 0 1 6.07 12c0-.67.12-1.32.32-1.92V7.46H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.54l3.35-2.62Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.46l3.35 2.62C7.18 7.71 9.39 5.95 12 5.95Z"/></svg>
          {googleLoading ? 'Google로 이동 중…' : 'Google로 계속하기'}
        </button>
        <div className="auth-divider"><span>또는 이메일로 로그인</span></div>
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field"><span className="field-label">이메일</span><input type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="field"><span className="field-label">비밀번호</span><input type="password" placeholder="비밀번호를 입력하세요" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary" type="submit">로그인</button>
        </form>
        <p className="auth-switch">계정이 없으신가요? <Link to="/signup">무료로 시작하기</Link></p>
      </div></section>
      <aside className="auth-visual"><p className="eyebrow">SMART DEAL WORKSPACE</p><h2>메일 속 제안을<br />실제 수익으로 연결하세요.</h2><p>흩어진 협찬과 외주 메일을 한곳에 모으고, 놓치기 쉬운 조건과 일정을 Propaid이 정리합니다.</p><div className="auth-steps"><span className="auth-step">01 메일 전달</span><span className="auth-step">02 조건 확인</span><span className="auth-step">03 거래 관리</span><span className="auth-step">04 입금 완료</span></div></aside>
    </div>
  );
}
