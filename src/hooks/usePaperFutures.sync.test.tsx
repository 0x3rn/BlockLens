import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const auth = { loading: false, user: null as { id: string } | null };
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  query.upsert = vi.fn().mockResolvedValue({ error: null });
  return { auth, query, from: vi.fn(() => query) };
});

vi.mock('../context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../lib/supabase', () => ({ supabase: { from: mocks.from } }));

import { createInitialPaperFuturesAccount, usePaperFutures } from './usePaperFutures';

describe('paper futures authentication transitions', () => {
  afterEach(() => {
    mocks.auth.user = null;
    mocks.from.mockClear();
    Object.values(mocks.query).forEach((mock) => mock.mockClear());
    localStorage.clear();
  });

  it('keeps the anonymous simulator ledger when the user signs in', async () => {
    const anonymousAccount = { ...createInitialPaperFuturesAccount(), balance: 9_250 };
    localStorage.setItem('blocklens_paper_futures', JSON.stringify(anonymousAccount));
    const { result, rerender } = renderHook(() => usePaperFutures());
    await waitFor(() => expect(result.current.account.balance).toBe(9_250));

    act(() => {
      mocks.auth.user = { id: '00000000-0000-4000-8000-000000000001' };
      rerender();
    });
    await waitFor(() => expect(mocks.query.upsert).toHaveBeenCalled());

    expect(JSON.parse(localStorage.getItem('blocklens_paper_futures') ?? '{}')).toMatchObject({ balance: 9_250 });
  });
});
