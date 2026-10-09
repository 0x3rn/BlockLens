import { useEffect, useRef, useState } from 'react';

type WidgetOptions = {
  sitekey: string;
  action: string;
  theme: 'auto';
  size: 'flexible';
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
  'timeout-callback': () => void;
};
export type TurnstileApi = {
  ready: (callback: () => void) => void;
  render: (container: HTMLElement, options: WidgetOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<TurnstileApi> | null = null;
const loadTurnstile = (): Promise<TurnstileApi> => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    const timer = window.setTimeout(() => failed(), 15_000);
    const failed = () => {
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      script.remove();
      reject(new Error('Verification could not load.'));
    };
    script.onerror = failed;
    script.onload = () => {
      if (!window.turnstile) return failed();
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      resolve(window.turnstile);
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
};

type Props = {
  onToken: (token: string | null) => void;
  resetKey: number;
  action?: 'ai_analysis' | 'password_login' | 'password_signup';
  className?: string;
};

const messages = {
  ai_analysis: { prompt: 'Verify to generate analysis.', unavailable: 'Analysis is temporarily unavailable. Please try again later.' },
  password_login: { prompt: 'Complete verification to sign in.', unavailable: 'Email sign-in is temporarily unavailable. Please try again later.' },
  password_signup: { prompt: 'Complete verification to create your account.', unavailable: 'Email registration is temporarily unavailable. Please try again later.' },
};

export default function TurnstileVerification({ onToken, resetKey, action = 'ai_analysis', className = 'analysis-verification' }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [message, setMessage] = useState(messages[action].prompt);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const lastReset = useRef(resetKey);
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();

  useEffect(() => {
    let active = true;
    callback.current(null);
    setFailed(false);
    setMessage(messages[action].prompt);
    if (!sitekey) {
      setMessage(messages[action].unavailable);
      return;
    }
    const unavailable = () => {
      if (!active) return;
      callback.current(null);
      setFailed(true);
      setMessage('Verification couldn’t complete. Please try again.');
    };
    void loadTurnstile().then((api) => {
      if (!active || !container.current) return;
      const id = api.render(container.current, {
        sitekey, action, theme: 'auto', size: 'flexible',
        callback: (token) => {
          if (!active) return;
          callback.current(token);
          setFailed(false);
          setMessage('Verification complete.');
        },
        'expired-callback': () => {
          if (!active) return;
          callback.current(null);
          setMessage('Verification expired. Please verify again.');
        },
        'error-callback': unavailable,
        'timeout-callback': unavailable,
      });
      widget.current = { api, id };
    }).catch(unavailable);
    return () => {
      active = false;
      if (widget.current) widget.current.api.remove(widget.current.id);
      widget.current = null;
    };
  }, [sitekey, retry, action]);

  useEffect(() => {
    if (lastReset.current === resetKey) return;
    lastReset.current = resetKey;
    callback.current(null);
    setMessage(messages[action].prompt);
    if (widget.current) widget.current.api.reset(widget.current.id);
  }, [resetKey, action]);

  return (
    <div className={className}>
      <div ref={container} />
      <p role="status" aria-live="polite">{message}</p>
      {failed && <button type="button" className="text-link" onClick={() => setRetry((value) => value + 1)}>Retry verification</button>}
    </div>
  );
}
