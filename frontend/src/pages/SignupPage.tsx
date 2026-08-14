import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signup } from '../api/auth';
import { useAuth } from '../context/AuthContext';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await signup(email, password, nickname);
      setAuth(res.accessToken, res.nickname);
      navigate('/dashboard');
    } catch {
      setError('회원가입에 실패했습니다. 이미 가입된 이메일일 수 있습니다.');
    }
  };

  return (
    <div className="auth-layout">
      <section className="auth-panel"><div className="auth-card">
        <div className="brand"><span className="brand-mark" />Propaid</div>
        <h1 className="auth-title">내 업무 흐름 만들기</h1><p className="auth-copy">무료로 시작하고, 중요한 제안과 입금 일정을 한곳에서 관리하세요.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field"><span className="field-label">닉네임</span><input type="text" placeholder="어떻게 불러드릴까요?" value={nickname} onChange={(e) => setNickname(e.target.value)} required /></label>
          <label className="field"><span className="field-label">이메일</span><input type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="field"><span className="field-label">비밀번호</span><input type="password" placeholder="8자 이상 입력하세요" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></label>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary" type="submit">무료로 시작하기</button>
        </form>
        <p className="auth-switch">이미 계정이 있으신가요? <Link to="/login">로그인</Link></p>
      </div></section>
      <aside className="auth-visual"><p className="eyebrow">MADE FOR SOLO BUSINESS</p><h2>제안은 놓치지 않고,<br />일은 더 선명하게.</h2><p>메일 전달 주소 하나로 거래 조건을 정리하고, 확인한 내용만 안전하게 업무로 전환합니다.</p><div className="auth-steps"><span className="auth-step">Gmail 권한 불필요</span><span className="auth-step">사용자 확인 후 저장</span><span className="auth-step">무료로 시작</span></div></aside>
    </div>
  );
}
