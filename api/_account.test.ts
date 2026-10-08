import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileAccountQuery, executeAccountQuery } from './_account';

const userId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const select = { table: 'watchlist_items', operation: 'select', filters: [], columns: 'coin_id' };

describe('account SQL boundary', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('parameterizes values and independently scopes account reads', () => {
    const query = compileAccountQuery({ ...select, filters: [{ column: 'coin_id', operator: 'eq', value: "bitcoin' or true --" }] }, userId);
    expect(query.text).toContain('"user_id" = $2');
    expect(query.text).not.toContain("bitcoin' or true");
    expect(query.parameters).toEqual(["bitcoin' or true --", userId, 500]);
  });
  it('only exposes app tables, columns, operations, and bounded results', () => {
    for (const input of [
      { ...select, table: 'ai_analysis_global_limit' },
      { ...select, table: 'watchlist_items; drop table profiles' },
      { ...select, columns: '(select password from auth.users)' },
      { ...select, limit: 501 }, { ...select, operation: 'execute' },
      { ...select, operation: 'delete' },
    ]) expect(() => compileAccountQuery(input, userId)).toThrow('Invalid account request');
  });
  it('rejects forged owners and prevents reassignment of identifiers', () => {
    expect(() => compileAccountQuery({ ...select, operation: 'upsert', values: { user_id: otherId, coin_id: 'bitcoin' }, onConflict: 'user_id,coin_id' }, userId)).toThrow('ownership');
    expect(() => compileAccountQuery({ ...select, operation: 'update', values: { user_id: otherId }, filters: [{ column: 'coin_id', operator: 'eq', value: 'bitcoin' }] }, userId)).toThrow('Invalid account request');
    const query = compileAccountQuery({ ...select, operation: 'upsert', values: { coin_id: 'bitcoin' }, onConflict: 'user_id,coin_id' }, userId);
    expect(query.parameters).toEqual(['bitcoin', userId]);
    expect(query.text).toContain('on conflict ("user_id", "coin_id") do nothing');
  });
  it('scopes position reads through portfolios and protects conflict updates', () => {
    const query = compileAccountQuery({ table: 'portfolio_positions', operation: 'upsert', filters: [], values: { portfolio_id: otherId, coin_id: 'bitcoin', quantity: 1, average_cost: 5, currency: 'usd' }, onConflict: 'portfolio_id,coin_id' }, userId);
    expect(query.text).toContain('where "portfolio_positions".portfolio_id in (select id from public.portfolios where user_id = $6)');
    expect(query.parameters).toHaveLength(6);
  });
  it('requires verified sign-in before database access', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    await expect(executeAccountQuery(select, null, {})).rejects.toMatchObject({ status: 401 });
    expect(request).not.toHaveBeenCalled();
    await expect(executeAccountQuery(select, 'Bearer forged', { FIREBASE_PROJECT_ID: 'blocklens-test' })).rejects.toMatchObject({ status: 401 });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { operation: 'upsert', filters: [], values: { balance: 9990 }, onConflict: 'user_id' },
    { operation: 'update', filters: [{ column: 'user_id', operator: 'eq', value: userId }], values: { balance: 9990, updated_at: '2026-10-08T10:00:01Z' } },
    { operation: 'update', filters: [{ column: 'updated_at', operator: 'eq', value: '2026-10-08T10:00:00Z' }], values: { balance: 9990, updated_at: '2026-10-08T10:00:00Z' } },
    { operation: 'update', filters: [{ column: 'updated_at', operator: 'eq', value: 'invalid' }], values: { balance: 9990, updated_at: '2026-10-08T10:00:01Z' } },
  ])('rejects paper-ledger writes that bypass or reuse a revision', request => {
    expect(() => compileAccountQuery({ table: 'paper_futures_accounts', ...request }, userId)).toThrow('Invalid account request');
  });
});
