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
    expect(vercelCsp).toContain('https://fapi.binance.com');
  });

  it('keeps AI and history quotas behind server-side database controls', () => {
    const migration = readFileSync('supabase/migrations/0004_security_hardening.sql', 'utf8');
    expect(migration).toContain('grant execute on function public.consume_ai_analysis_quota(text) to service_role');
    expect(migration).toContain('revoke all on public.history_write_limits from public, anon, authenticated');
    expect(migration).toContain('offset 49');
    expect(migration).toContain('offset 99');
    expect(migration).toContain('octet_length(new.analysis::text) > 65536');
    expect(migration).toContain('caller_id <> new.user_id');
  });
});
