// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { setSourcePause, sourcePauseStatus, sourceTables } from './migration-pause.mjs';

let database;
const setup = async () => {
  database = new PGlite();
  await database.exec('create schema auth');
  for (const table of sourceTables) await database.exec(`create table ${table} (id integer primary key, value text)`);
  return { query: async (sql, params) => { const r = await database.query(sql, params); return { ...r, rowCount: r.rows.length }; } };
};
afterEach(async () => { await database?.close(); });

describe('source migration pause', () => {
  it('blocks changes even with no matching rows, preserves reads, and restores writes', async () => {
    const client = await setup();
    await client.query('insert into public.profiles values (1, $1)', ['retained']);
    expect((await setSourcePause(client, true)).tables).toBe(13);
    expect((await sourcePauseStatus(client)).paused).toBe(true);
    await expect(client.query('update auth.users set value = value where false')).rejects.toMatchObject({ code: '55000' });
    await expect(client.query('delete from public.profiles')).rejects.toMatchObject({ code: '55000' });
    await expect(client.query('truncate public.profiles')).rejects.toMatchObject({ code: '55000' });
    expect((await client.query('select value from public.profiles')).rows).toEqual([{ value: 'retained' }]);
    await setSourcePause(client, false);
    expect((await sourcePauseStatus(client)).paused).toBe(false);
    await client.query('update public.profiles set value = $1', ['restored']);
    expect((await client.query('select value from public.profiles')).rows).toEqual([{ value: 'restored' }]);
  }, 30_000);
  it('is safe to repeat and refuses to replace an unrelated function', async () => {
    const client = await setup();
    await setSourcePause(client, true);
    await setSourcePause(client, true);
    expect((await sourcePauseStatus(client)).guards).toHaveLength(13);
    await setSourcePause(client, false);
    await client.query("comment on function public.blocklens_migration_write_pause() is 'another application'");
    await expect(setSourcePause(client, true)).rejects.toThrow('another function');
    expect((await sourcePauseStatus(client)).paused).toBe(false);
  }, 30_000);
});
