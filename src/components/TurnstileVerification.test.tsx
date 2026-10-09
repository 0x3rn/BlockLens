import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TurnstileVerification, { type TurnstileApi } from './TurnstileVerification';

afterEach(() => { cleanup(); delete window.turnstile; vi.unstubAllEnvs(); });

describe('Turnstile script loading', () => {
  it('does not load a widget or allow a token without a configured site key', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    const callback = vi.fn();
    render(<TurnstileVerification onToken={callback} resetKey={0} />);
    expect(screen.getByRole('status')).toHaveTextContent('Analysis is temporarily unavailable.');
    expect(callback).toHaveBeenCalledWith(null);
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
  });

  it('retries a failed script, renders once in Strict Mode, and avoids ready() on an async script', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'public-test-sitekey');
    const callback = vi.fn();
    const user = userEvent.setup();
    const view = render(<StrictMode><TurnstileVerification onToken={callback} resetKey={0} /></StrictMode>);
    let scripts = document.querySelectorAll('script[src*="challenges.cloudflare.com"]');
    expect(scripts).toHaveLength(1);
    act(() => scripts[0].dispatchEvent(new Event('error')));
    await screen.findByRole('button', { name: 'Retry verification' });
    expect(callback).toHaveBeenLastCalledWith(null);
    await user.click(screen.getByRole('button', { name: 'Retry verification' }));
    scripts = document.querySelectorAll('script[src*="challenges.cloudflare.com"]');
    expect(scripts).toHaveLength(1);
    const api: TurnstileApi = {
      ready: vi.fn(() => { throw new Error('Cloudflare disallows ready with async/defer.'); }),
      render: vi.fn(() => 'widget-1'), reset: vi.fn(), remove: vi.fn(),
    };
    window.turnstile = api;
    act(() => scripts[0].dispatchEvent(new Event('load')));
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    expect(api.ready).not.toHaveBeenCalled();
    expect(api.render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ sitekey: 'public-test-sitekey', action: 'ai_analysis', size: 'flexible' }));
    view.rerender(<StrictMode><TurnstileVerification onToken={callback} resetKey={1} /></StrictMode>);
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    view.unmount();
    expect(api.remove).toHaveBeenCalledWith('widget-1');
    scripts[0].remove();
  });
});
