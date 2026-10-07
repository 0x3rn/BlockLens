import { getAccountToken, isFirebaseConfigured } from './firebase';
import type { Database } from './database-types';
export type { Json } from './database-types';

type Tables = Database['public']['Tables'];
type Table = keyof Tables;
type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

// Keep the existing sync hooks' small query vocabulary; all database access now
// goes through our authenticated server endpoint.
class AccountQuery<T extends Table, R = Tables[T]['Row'][]> implements PromiseLike<Result<R>> {
  private request: Record<string, unknown>;
  private pending?: Promise<Result<R>>;
  constructor(table: T) { this.request = { table, operation: 'select', filters: [] }; }
  select(columns = '*') { this.request.columns = columns; return this; }
  eq(column: string, value: unknown) { return this.filter(column, 'eq', value); }
  in(column: string, value: unknown[]) { return this.filter(column, 'in', value); }
  private filter(column: string, operator: string, value: unknown) {
    (this.request.filters as unknown[]).push({ column, operator, value }); return this;
  }
  order(column: string, options: { ascending: boolean }) {
    this.request.order = { column, ascending: options.ascending }; return this;
  }
  limit(limit: number) { this.request.limit = limit; return this; }
  insert(values: Tables[T]['Insert'] | Tables[T]['Insert'][]) {
    this.request.operation = 'insert'; this.request.values = values; return this;
  }
  upsert(values: Tables[T]['Insert'] | Tables[T]['Insert'][], options?: { onConflict: string }) {
    this.request.operation = 'upsert'; this.request.values = values;
    this.request.onConflict = options?.onConflict ?? 'id'; return this;
  }
  update(values: Tables[T]['Update']) { this.request.operation = 'update'; this.request.values = values; return this; }
  delete() { this.request.operation = 'delete'; return this; }
  maybeSingle() { this.request.single = 'optional'; return this as unknown as AccountQuery<T, Tables[T]['Row']>; }
  single() { this.request.single = 'required'; return this as unknown as AccountQuery<T, Tables[T]['Row']>; }
  private async execute(): Promise<Result<R>> {
    try {
      const token = await getAccountToken();
      if (!token) return { data: null, error: { message: 'Please sign in again.' } };
      const response = await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(this.request),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json() as Result<R>;
      if (!response.ok) return { data: null, error: result.error ?? { message: 'Account sync is temporarily unavailable.' } };
      return result;
    } catch {
      return { data: null, error: { message: 'Account sync is temporarily unavailable.' } };
    }
  }
  then<TResult1 = Result<R>, TResult2 = never>(
    onfulfilled?: ((value: Result<R>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    this.pending ??= this.execute();
    return this.pending.then(onfulfilled, onrejected);
  }
}

export const database = isFirebaseConfigured ? { from: <T extends Table>(table: T) => new AccountQuery(table) } : null;
