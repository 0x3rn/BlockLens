import { databaseClient } from './_database.ts';
import type { ServerEnvironment } from './_env.ts';
import { FirebaseAuthError, verifyFirebaseUser } from './_firebase-auth.ts';

const tables = {
  profiles: ['id', 'display_name', 'created_at', 'updated_at'],
  portfolios: ['id', 'user_id', 'name', 'base_currency', 'created_at', 'updated_at'],
  portfolio_positions: ['id', 'portfolio_id', 'coin_id', 'quantity', 'average_cost', 'currency', 'updated_at'],
  watchlist_items: ['id', 'user_id', 'coin_id', 'created_at'],
  price_alerts: ['id', 'user_id', 'coin_id', 'condition', 'threshold', 'currency', 'created_at', 'triggered_at'],
  ai_analysis_history: ['id', 'user_id', 'coin_id', 'coin_name', 'coin_symbol', 'currency', 'price', 'analysis', 'created_at'],
  position_history: ['id', 'user_id', 'coin_id', 'action', 'quantity', 'average_cost', 'currency', 'created_at'],
  paper_futures_accounts: ['id', 'user_id', 'balance', 'realized_pnl', 'positions', 'orders', 'trades', 'updated_at'],
} satisfies Record<string, string[]>;
const conflicts: Record<keyof typeof tables, string[]> = {
  profiles: ['id'], portfolios: ['id', 'user_id,name'], portfolio_positions: ['id', 'portfolio_id,coin_id'],
  watchlist_items: ['id', 'user_id,coin_id'], price_alerts: ['id'], ai_analysis_history: ['id'],
  position_history: ['id'], paper_futures_accounts: ['id', 'user_id'],
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class AccountError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const compileAccountQuery = (input: unknown, userId: string) => {
  const invalid = () => { throw new AccountError(400, 'Invalid account request.'); };
  if (!object(input) || typeof input.table !== 'string' || !Object.hasOwn(tables, input.table)) return invalid();
  const table = input.table as keyof typeof tables;
  const allowed: string[] = tables[table];
  const column = (name: unknown): string => {
    if (typeof name !== 'string' || !allowed.includes(name)) return invalid();
    return `"${name}"`;
  };
  const parameters: unknown[] = [];
  const parameter = (value: unknown) => { parameters.push(value); return `$${parameters.length}`; };
  const selected = input.columns === undefined || input.columns === '*' ? '*' : (
    typeof input.columns === 'string' ? input.columns.split(',').map((name) => column(name.trim())).join(', ') : invalid()
  );
  if (input.single !== undefined && !['optional', 'required'].includes(String(input.single))) return invalid();
  if (!Array.isArray(input.filters) || input.filters.length > 10) return invalid();
  const predicates = input.filters.map((filter) => {
    if (!object(filter)) return invalid();
    const name = column(filter.column);
    if (filter.operator === 'eq' && ['string', 'number', 'boolean'].includes(typeof filter.value)) {
      return `${name} = ${parameter(filter.value)}`;
    }
    if (filter.operator === 'in' && Array.isArray(filter.value) && filter.value.length > 0 && filter.value.length <= 500
      && filter.value.every((value) => ['string', 'number', 'boolean'].includes(typeof value))) {
      return `${name} in (${filter.value.map(parameter).join(', ')})`;
    }
    return invalid();
  });
  // RLS is also enforced in the transaction. Scope mutations before conflict
  // resolution and never trust user_id supplied by the browser.
  const owner = table === 'profiles' ? 'id' : table === 'portfolio_positions' ? null : 'user_id';
  if (owner) predicates.push(`"${owner}" = ${parameter(userId)}`);
  else predicates.push(`portfolio_id in (select id from public.portfolios where user_id = ${parameter(userId)})`);
  const where = ` where ${predicates.join(' and ')}`;
  let text: string;
  const operation = input.operation;
  if (operation === 'select') {
    let order = '';
    if (input.order !== undefined) {
      if (!object(input.order) || typeof input.order.ascending !== 'boolean') return invalid();
      order = ` order by ${column(input.order.column)} ${input.order.ascending ? 'asc' : 'desc'}`;
    }
    const limit = input.limit ?? 500;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 500) return invalid();
    text = `select ${selected} from public."${table}"${where}${order} limit ${parameter(limit)}`;
  } else if (operation === 'delete') {
    if (!input.filters.length) return invalid();
    text = `delete from public."${table}"${where} returning ${selected}`;
  } else if (operation === 'update') {
    if (!input.filters.length || !object(input.values) || !Object.keys(input.values).length) return invalid();
    const assignments = Object.entries(input.values).map(([name, value]) => {
      if (['id', 'user_id', 'portfolio_id'].includes(name)) return invalid();
      return `${column(name)} = ${parameter(value !== null && typeof value === 'object' ? JSON.stringify(value) : value)}`;
    });
    text = `update public."${table}" set ${assignments.join(', ')}${where} returning ${selected}`;
  } else if (operation === 'insert' || operation === 'upsert') {
    if (input.filters.length) return invalid();
    parameters.length = 0;
    const rows = Array.isArray(input.values) ? input.values : [input.values];
    if (!rows.length || rows.length > 500 || !rows.every(object)) return invalid();
    const normalized = rows.map((row) => {
      Object.keys(row).forEach(column);
      if (owner && row[owner] !== undefined && row[owner] !== userId) throw new AccountError(403, 'Account ownership check failed.');
      return owner ? { ...row, [owner]: userId } : row;
    });
    const keys = [...new Set(normalized.flatMap((row) => Object.keys(row)))];
    if (!keys.length) return invalid();
    const values = normalized.map((row) => `(${keys.map((key) => {
      const value = row[key];
      return value === undefined ? 'default' : parameter(value !== null && typeof value === 'object' ? JSON.stringify(value) : value);
    }).join(', ')})`).join(', ');
    let conflict = '';
    if (operation === 'upsert') {
      if (typeof input.onConflict !== 'string' || !conflicts[table].includes(input.onConflict)) return invalid();
      const conflictKeys = input.onConflict.split(',');
      const updates = keys.filter((key) => !conflictKeys.includes(key) && !['id', 'user_id', 'portfolio_id'].includes(key));
      conflict = ` on conflict (${conflictKeys.map(column).join(', ')}) ` + (updates.length
        ? `do update set ${updates.map((key) => `${column(key)} = excluded.${column(key)}`).join(', ')} where ${owner ? `"${table}"."${owner}" = ${parameter(userId)}` : `"${table}".portfolio_id in (select id from public.portfolios where user_id = ${parameter(userId)})`}`
        : 'do nothing');
    }
    text = `insert into public."${table}" (${keys.map(column).join(', ')}) values ${values}${conflict} returning ${selected}`;
  } else return invalid();
  return { text, parameters, single: input.single };
};

const verifiedUser = async (authorization: string | null, env: ServerEnvironment) => {
  try { return await verifyFirebaseUser(authorization, env); }
  catch (error) {
    if (error instanceof FirebaseAuthError) throw new AccountError(error.status, error.message);
    throw new AccountError(503, 'Account verification is temporarily unavailable.');
  }
};

export const executeAccountQuery = async (body: unknown, authorization: string | null, env: ServerEnvironment) => {
  const user = await verifiedUser(authorization, env);
  const query = compileAccountQuery(body, user.id);
  const sql = databaseClient(env);
  const results = await sql.transaction([
    sql`select set_config('role', 'blocklens_app', true)`,
    sql`select set_config('blocklens.user_id', ${user.id}, true)`,
    sql`insert into public.profiles (id, display_name) values (${user.id}, ${user.displayName ?? user.email?.split('@')[0]?.slice(0, 80) ?? null}) on conflict (id) do nothing`,
    sql.query(query.text, query.parameters),
  ]);
  const rows = results[3];
  if (query.single) {
    if (rows.length > 1 || (query.single === 'required' && rows.length !== 1)) throw new AccountError(409, 'The account record could not be resolved.');
    return rows[0] ?? null;
  }
  return rows;
};
