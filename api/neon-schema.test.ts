// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileAccountQuery } from './_account';

const owner = '00000000-0000-4000-8000-000000000001';
const stranger = '00000000-0000-4000-8000-000000000002';
let db: PGlite;
const asUser = async <T>(user: string, action: () => Promise<T>) => {
  await db.exec('begin; set local role blocklens_app;');
  try {
    await db.query("select set_config('blocklens.user_id', $1, true)", [user]);
    const result = await action();
    await db.exec('commit'); return result;
  } catch (error) { await db.exec('rollback'); throw error; }
};
describe('Neon Postgres schema and account isolation', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(readFileSync('neon/migrations/0001_blocklens.sql', 'utf8'));
    await db.query('insert into profiles(id) values ($1), ($2)', [owner, stranger]);
    await db.query('insert into profiles(id,display_name) values ($1,$2)', ['00000000-0000-4000-8000-000000000009', 'Legacy account']);
    await db.query('insert into watchlist_items(user_id,coin_id) values ($1,$2)', ['00000000-0000-4000-8000-000000000009', 'ethereum']);
    await db.exec('begin;\n' + readFileSync('neon/migrations/0002_firebase_auth.sql', 'utf8') + '\ncommit;');
  }, 60_000);
  afterAll(async () => db?.close());
  it('executes compiled sync queries and isolates watchlists across users', async () => {
    const write = compileAccountQuery({ table: 'watchlist_items', operation: 'upsert', filters: [], values: { user_id: owner, coin_id: 'bitcoin' }, onConflict: 'user_id,coin_id' }, owner);
    await asUser(owner, () => db.query(write.text, write.parameters));
    const mine = await asUser(owner, () => db.query('select coin_id from watchlist_items'));
    const theirs = await asUser(stranger, () => db.query('select coin_id from watchlist_items'));
    expect(mine.rows).toEqual([{ coin_id: 'bitcoin' }]); expect(theirs.rows).toEqual([]);
    await expect(asUser(stranger, () => db.query('insert into watchlist_items(user_id,coin_id) values ($1,$2)', [owner, 'ethereum']))).rejects.toThrow(/row-level security/);
  });
  it('checks portfolio ownership for reads, writes, and conflict resolution', async () => {
    const portfolio = await db.query<{ id: string }>('insert into portfolios(user_id) values ($1) returning id', [owner]);
    const id = portfolio.rows[0].id;
    const values = { portfolio_id: id, coin_id: 'bitcoin', quantity: 2, average_cost: 10, currency: 'usd' };
    const write = compileAccountQuery({ table: 'portfolio_positions', operation: 'upsert', filters: [], values, onConflict: 'portfolio_id,coin_id' }, owner);
    await asUser(owner, () => db.query(write.text, write.parameters));
    await expect(asUser(stranger, () => db.query(write.text, write.parameters))).rejects.toThrow(/row-level security/);
    const hidden = await asUser(stranger, () => db.query('select * from portfolio_positions'));
    expect(hidden.rows).toEqual([]);
  });
  it('provisions a new verified profile under the restricted role', async () => {
    const id = 'FirebaseUser_AbC123xyz';
    await asUser(id, () => db.query('insert into profiles (id, display_name) values ($1,$2) on conflict(id) do nothing', [id, 'New user']));
    const profiles = await asUser(id, () => db.query('select display_name from profiles'));
    expect(profiles.rows).toEqual([{ display_name: 'New user' }]);
  });
  it('preserves legacy UUID account data and prevents Firebase users from accessing it', async () => {
    const legacy = await asUser('00000000-0000-4000-8000-000000000009', () => db.query('select coin_id from watchlist_items'));
    expect(legacy.rows).toEqual([{ coin_id: 'ethereum' }]);
    const firebase = await asUser('FirebaseUser_AbC123xyz', () => db.query('select coin_id from watchlist_items'));
    expect(firebase.rows).toEqual([]);
    const columns = await db.query<{ data_type: string }>("select data_type from information_schema.columns where table_schema='public' and ((table_name='profiles' and column_name='id') or column_name='user_id')");
    expect(columns.rows.every((row) => row.data_type === 'text')).toBe(true);
    await expect(asUser('FirebaseUser_AbC123xyz', () => db.query('insert into price_alerts(user_id,coin_id,condition,threshold,currency) values ($1,$2,$3,1,$4)', ['00000000-0000-4000-8000-000000000009', 'bitcoin', 'above', 'usd']))).rejects.toThrow(/row-level security/);
  });
  it('preserves exact numeric values and JSON through the import SQL', async () => {
    await db.exec('begin');
    try {
      const record = JSON.stringify({ id: '00000000-0000-4000-8000-000000000020', user_id: owner, balance: '12345678901234567890.123456789012345678', realized_pnl: '-1.500000000000000001', positions: [{ id: 'position', margin: 50 }], orders: [{ id: 'order', limit: 10 }], trades: [], updated_at: '2026-10-05T10:00:00Z' });
      const inserted = await db.query<{ row: string }>('insert into public.paper_futures_accounts select * from jsonb_populate_record(null::public.paper_futures_accounts, $1::jsonb) returning to_jsonb(paper_futures_accounts)::text as row', [record]);
      expect(inserted.rows[0].row).toContain('12345678901234567890.123456789012345678');
      expect(inserted.rows[0].row).toContain('-1.500000000000000001');
      expect(JSON.parse(inserted.rows[0].row).orders).toEqual([{ id: 'order', limit: 10 }]);
    } finally { await db.exec('rollback'); }
    expect((await db.query('select * from paper_futures_accounts')).rows).toEqual([]);
  });
  it('rejects a stale paper-ledger save while preserving orders and owner isolation', async () => {
    const revision = '2026-10-08T10:00:00.000Z';
    const nextRevision = '2026-10-08T10:00:00.001Z';
    await db.query('insert into paper_futures_accounts(user_id, balance, realized_pnl, updated_at) values ($1, 10000, 0, $2)', [owner, revision]);
    try {
      const orders = [{ id: 'reserved-order', status: 'open', margin: 10, reservedFee: .02 }];
      const request = { table: 'paper_futures_accounts', operation: 'update', values: { balance: 9989.98, orders, updated_at: nextRevision }, filters: [{ column: 'user_id', operator: 'eq', value: owner }, { column: 'updated_at', operator: 'eq', value: revision }], columns: 'updated_at' };
      const write = compileAccountQuery(request, owner);
      expect((await asUser(owner, () => db.query(write.text, write.parameters))).rows).toHaveLength(1);
      expect((await asUser(owner, () => db.query(write.text, write.parameters))).rows).toHaveLength(0);
      const strangerWrite = compileAccountQuery({ ...request, values: { ...request.values, updated_at: '2026-10-08T10:00:00.002Z' }, filters: [{ column: 'updated_at', operator: 'eq', value: nextRevision }] }, stranger);
      expect((await asUser(stranger, () => db.query(strangerWrite.text, strangerWrite.parameters))).rows).toHaveLength(0);
      const saved = await asUser(owner, () => db.query('select balance, orders from paper_futures_accounts'));
      expect(saved.rows).toEqual([{ balance: '9989.980000000000000000', orders }]);
    } finally { await db.query('delete from paper_futures_accounts where user_id = $1', [owner]); }
  });
  it('keeps the atomic quota server-only and rejects the ninth request', async () => {
    await expect(asUser(owner, () => db.query('select consume_ai_analysis_quota($1)', ['a'.repeat(64)]))).rejects.toThrow(/permission denied/);
    for (let i = 0; i < 8; i++) {
      const result = await db.query<{ allowed: boolean }>('select consume_ai_analysis_quota($1) as allowed', ['a'.repeat(64)]);
      expect(result.rows[0].allowed).toBe(true);
    }
    const denied = await db.query<{ allowed: boolean }>('select consume_ai_analysis_quota($1) as allowed', ['a'.repeat(64)]);
    expect(denied.rows[0].allowed).toBe(false);
  });
  it('bounds history storage and enforces its owner and payload size', async () => {
    await asUser(owner, () => db.query("insert into position_history(user_id,coin_id,action,quantity,average_cost,currency) select $1,'bitcoin','added',1,2,'usd' from generate_series(1,105)", [owner]));
    const result = await db.query<{ count: number }>('select count(*)::int as count from position_history');
    expect(result.rows[0].count).toBe(100);
    await expect(asUser(stranger, () => db.query("insert into position_history(user_id,coin_id,action,quantity,average_cost,currency) values ($1,'bitcoin','added',1,2,'usd')", [owner]))).rejects.toThrow(/ownership/);
    await expect(asUser(owner, () => db.query("insert into ai_analysis_history(user_id,coin_id,coin_name,coin_symbol,currency,price,analysis) values ($1,'bitcoin','Bitcoin','BTC','usd',1,$2)", [owner, JSON.stringify({ padding: 'x'.repeat(70_000) })]))).rejects.toThrow(/storage limit/);
  });
});
