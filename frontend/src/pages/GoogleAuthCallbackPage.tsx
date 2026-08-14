import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function GoogleAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get('access_token');
    const nickname = hash.get('nickname');
    window.history.replaceState(null, '', window.location.pathname);
    if (accessToken && nickname) {
      setAuth(accessToken, nickname);
      navigate('/dashboard', { replace: true });
      return;
    }
    const reason = searchParams.get('error');
    setError(reason === 'denied' ? 'Google 로그인이 취소되었습니다.' : 'Google 로그인에 실패했습니다. 다시 시도해주세요.');
  }, [navigate, searchParams, setAuth]);

  return (
    <div className="auth-callback">
      <div className="auth-callback-card">
        <div className="brand"><span className="brand-mark" />Propaid</div>
        {error ? <><div className="alert alert-error">{error}</div><Link className="btn btn-primary" to="/login">로그인으로 돌아가기</Link></>
          : <p>Google 계정을 확인하고 있습니다…</p>}
      </div>
    </div>
  );
}
