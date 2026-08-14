import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login } from '../api/auth';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
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

  return (
    <div className="auth-layout">
      <section className="auth-panel"><div className="auth-card">
        <div className="brand"><span className="brand-mark" />Propaid</div>
        <h1 className="auth-title">다시 만나 반가워요</h1><p className="auth-copy">제안부터 입금까지, 오늘의 업무를 이어서 정리하세요.</p>
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
