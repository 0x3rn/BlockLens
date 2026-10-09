import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readJsonBody } from './index';

describe('Cloudflare request and static response controls', () => {
  it('enforces the body limit in UTF-8 bytes', async () => {
    const multibyteBody = JSON.stringify({ padding: 'é'.repeat(500_000) });
    const result = await readJsonBody(new Request('https://blocklens.example/api/analyze', {
      method: 'POST',
      body: multibyteBody,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it('still accepts ordinary bounded JSON', async () => {
    const result = await readJsonBody(new Request('https://blocklens.example/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
    }));
    expect(result).toMatchObject({ ok: true, value: { ok: true } });
  });

  it('ships equivalent framing and futures connectivity policies', () => {
    const cloudflareHeaders = readFileSync('public/_headers', 'utf8');
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: Array<{ headers: Array<{ key: string; value: string }> }> };
    const vercelCsp = vercel.headers[0].headers.find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(cloudflareHeaders).toContain("X-Frame-Options: DENY");
    expect(cloudflareHeaders).toContain("frame-ancestors 'none'");
    expect(cloudflareHeaders).toContain('https://fapi.binance.com');
    expect(cloudflareHeaders).toContain('https://api.coinpaprika.com');
    expect(vercelCsp).toContain('https://fapi.binance.com');
    expect(vercelCsp).toContain('https://api.coinpaprika.com');
    expect(cloudflareHeaders).toContain('https://identitytoolkit.googleapis.com');
    expect(cloudflareHeaders).toContain('https://securetoken.googleapis.com');
    expect(vercelCsp).toContain('https://identitytoolkit.googleapis.com');
    expect(vercelCsp).toContain('https://securetoken.googleapis.com');
    expect(cloudflareHeaders).toContain('Cross-Origin-Opener-Policy: same-origin-allow-popups');
    expect(vercel.headers[0].headers.find(header => header.key === 'Cross-Origin-Opener-Policy')?.value).toBe('same-origin-allow-popups');
    expect(vercelCsp).toContain('https://apis.google.com');
    expect(vercelCsp).toMatch(/script-src[^;]+https:\/\/challenges.cloudflare.com/);
    expect(vercelCsp).toMatch(/frame-src[^;]+https:\/\/challenges.cloudflare.com/);
    expect(cloudflareHeaders).toMatch(/script-src[^;]+https:\/\/challenges.cloudflare.com/);
    expect(cloudflareHeaders).toMatch(/frame-src[^;]+https:\/\/challenges.cloudflare.com/);
    expect(cloudflareHeaders).toContain('https://apis.google.com');
    expect(vercelCsp).toContain('frame-src https://blocklens-0x.firebaseapp.com');
    expect(cloudflareHeaders).toContain('frame-src https://blocklens-0x.firebaseapp.com');
    expect(cloudflareHeaders).not.toContain('https://*.supabase.co');
    expect(vercelCsp).not.toContain('https://*.supabase.co');
  });

  it('keeps AI and history quotas behind server-side database controls', () => {
    const migration = readFileSync('neon/migrations/0001_blocklens.sql', 'utf8');
    expect(migration).toContain('revoke all on function public.consume_ai_analysis_quota(text) from public, blocklens_app');
    expect(migration).toContain('revoke all on public.history_write_limits from public, blocklens_app');
    expect(migration).toContain('offset 49');
    expect(migration).toContain('offset 99');
    expect(migration).toContain('octet_length(new.analysis::text) > 65536');
    expect(migration).toContain('caller_id <> new.user_id');
  });
});
