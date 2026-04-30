import { useEffect, useRef, useState } from 'react';

const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script';
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadTurnstileScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.turnstile) return Promise.resolve(window.turnstile);

  const existing = document.getElementById(TURNSTILE_SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(window.turnstile), { once: true });
      existing.addEventListener('error', reject, { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function TurnstileWidget({
  siteKey,
  lang,
  resetSignal,
  onVerify,
  onExpire,
  onError,
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const callbacksRef = useRef({ onVerify, onExpire, onError });
  const [failed, setFailed] = useState(false);

  callbacksRef.current = { onVerify, onExpire, onError };

  useEffect(() => {
    if (!siteKey || !containerRef.current) return undefined;

    let cancelled = false;

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !containerRef.current || !turnstile) return;
        if (widgetIdRef.current !== null) turnstile.remove(widgetIdRef.current);

        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'dark',
          size: 'flexible',
          action: 'vote',
          language: lang || 'auto',
          callback: (token) => {
            setFailed(false);
            callbacksRef.current.onVerify?.(token);
          },
          'expired-callback': () => {
            callbacksRef.current.onExpire?.();
          },
          'error-callback': () => {
            setFailed(true);
            callbacksRef.current.onError?.();
          },
        });
      })
      .catch(() => {
        setFailed(true);
        callbacksRef.current.onError?.();
      });

    return () => {
      cancelled = true;
      if (window.turnstile && widgetIdRef.current !== null) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, lang]);

  useEffect(() => {
    if (window.turnstile && widgetIdRef.current !== null) {
      setFailed(false);
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetSignal]);

  return (
    <div
      ref={containerRef}
      aria-hidden={failed ? 'true' : undefined}
      style={{ minHeight: 65, width: '100%' }}
    />
  );
}
