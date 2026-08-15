import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        'error-callback'?: () => void;
        'expired-callback'?: () => void;
      }) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Turnstile 스크립트 로드 실패'));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
}

/**
 * VITE_TURNSTILE_SITE_KEY가 설정된 경우에만 위젯을 렌더링한다. 없으면 아무것도 하지 않는다 —
 * 서버 쪽(worker/src/turnstile.ts)도 TURNSTILE_SECRET_KEY가 없으면 검증을 건너뛰므로 짝이 맞는다.
 */
export default function TurnstileWidget({ onVerify, onExpire }: TurnstileWidgetProps) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let widgetId: string | undefined;
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: onVerify,
          'error-callback': () => setError(true),
          'expired-callback': () => onExpire?.(),
        });
      })
      .catch(() => setError(true));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
    };
  }, [siteKey, onVerify, onExpire]);

  if (!siteKey) return null;
  return (
    <div className="turnstile-widget">
      <div ref={containerRef} />
      {error && <p className="alert alert-error">보안 확인 위젯을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.</p>}
    </div>
  );
}
