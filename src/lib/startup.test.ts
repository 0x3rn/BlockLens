import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'public/startup.js'), 'utf8');
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const listeners = new Map<string, (event: Record<string, unknown>) => void>();
const reload = vi.fn();
const start = (storage: Storage = sessionStorage) => runInNewContext(source, {
  document, sessionStorage: storage, Date, setTimeout, clearTimeout,
  window: { location: { reload }, addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => listeners.set(type, fn) },
});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-11T00:00:00Z'));
  listeners.clear(); reload.mockClear(); sessionStorage.clear();
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = parsed.getElementById('root')!.outerHTML;
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
describe('application startup recovery', () => {
  it('renders startup content before the application bundle and offers retry if it never mounts', () => {
    expect(html.indexOf('src="/startup.js"')).toBeLessThan(html.indexOf('src="/src/index.tsx"'));
    start(); expect(document.body).toHaveTextContent('Loading BlockLens');
    vi.advanceTimersByTime(20000);
    expect(document.querySelector('[role="alert"]')).toHaveTextContent('We couldn’t load BlockLens.');
    const button = document.querySelector<HTMLButtonElement>('button')!;
    expect(button.hidden).toBe(false); button.click(); expect(reload).toHaveBeenCalledOnce();
  });
  it('reloads once for a missing lazy chunk and stops a reload loop', () => {
    start(); const preventDefault = vi.fn();
    listeners.get('vite:preloadError')!({ preventDefault });
    expect(reload).toHaveBeenCalledOnce(); expect(preventDefault).toHaveBeenCalledOnce();
    start(); listeners.get('vite:preloadError')!({ preventDefault });
    expect(reload).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="alert"]')).toBeInTheDocument();
  });
  it('recovers a missing entry bundle and Safari module import rejection', () => {
    start(); listeners.get('error')!({ target: { tagName: 'SCRIPT', src: 'https://example.com/assets/index-old.js' } });
    expect(reload).toHaveBeenCalledOnce();
    sessionStorage.clear(); start();
    listeners.get('unhandledrejection')!({ reason: new TypeError('Importing a module script failed.') });
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it('uses a retry screen if storage is blocked and leaves account storage untouched', () => {
    sessionStorage.setItem('firebase:authUser', 'session');
    start({ getItem: () => { throw new Error('blocked'); } } as unknown as Storage);
    listeners.get('vite:preloadError')!({ preventDefault: vi.fn() });
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('firebase:authUser')).toBe('session');
    expect(document.querySelector('button')!.hidden).toBe(false);
  });
  it('does not interrupt a healthy app on restoration, timeout, or unrelated errors', () => {
    start(); document.getElementById('root')!.innerHTML = '<main><h1>Open positions</h1></main>';
    listeners.get('pageshow')!({ persisted: true });
    listeners.get('unhandledrejection')!({ reason: new Error('market fetch failed') });
    listeners.get('error')!({ target: { tagName: 'IMG', src: '/missing.png' } });
    vi.advanceTimersByTime(30000);
    expect(document.body).toHaveTextContent('Open positions'); expect(reload).not.toHaveBeenCalled();
  });
  it('restores a retry screen when the root is empty after tab restoration', () => {
    start(); document.getElementById('root')!.innerHTML = '';
    listeners.get('pageshow')!({ persisted: true });
    expect(document.querySelector('[role="alert"]')).toHaveTextContent('We couldn’t load BlockLens.');
  });
  it('does not treat a missing image as an application startup failure', () => {
    start(); listeners.get('error')!({ target: { tagName: 'IMG', src: '/missing.png' } });
    expect(document.querySelector('[role="alert"]')).toBeNull(); expect(reload).not.toHaveBeenCalled();
  });
});
