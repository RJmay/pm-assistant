import type { Client } from "@pm/db";

// ============================================================================
// Minimal in-memory Supabase fake for sequence/cron tests.
// ============================================================================
// Supports the supabase-js surface the outbound-sequence scanners use:
//   from(t).select(cols).eq/gte/lte/order/limit ... (thenable → {data,error})
//                                      ... .maybeSingle()/.single()
//   from(t).insert(row).select(cols).single()  AND  await from(t).insert(row)
//   from(t).update(patch).eq(...).eq(...)      (thenable → {error})
// Filtering compares with `===` (eq) and string/number `<=`/`>=` (gte/lte),
// which is correct for ISO date strings. Unknown tables auto-create an empty
// array. `uniqueKeys` lets a table reject a duplicate insert with PG code
// 23505 so idempotency paths can be exercised.
// ============================================================================

export type Row = Record<string, unknown>;
export interface Db {
  [table: string]: Row[];
}

interface Opts {
  uniqueKeys?: Record<string, string[]>;
}

let idCounter = 0;

function table(db: Db, name: string): Row[] {
  if (!db[name]) db[name] = [];
  return db[name];
}

class SelectBuilder {
  private filters: Array<(r: Row) => boolean> = [];
  private limitN: number | null = null;
  constructor(
    protected db: Db,
    protected name: string,
  ) {}

  select(): this {
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  gte(col: string, val: string): this {
    this.filters.push((r) => r[col] != null && (r[col] as string) >= val);
    return this;
  }
  lte(col: string, val: string): this {
    this.filters.push((r) => r[col] != null && (r[col] as string) <= val);
    return this;
  }
  lt(col: string, val: string): this {
    this.filters.push((r) => r[col] != null && (r[col] as string) < val);
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  is(col: string, val: null): this {
    this.filters.push((r) => (val === null ? r[col] == null : r[col] === val));
    return this;
  }
  not(col: string, op: string, val: null): this {
    // Supports the `.not(col, "is", null)` form → keep rows where col is set.
    this.filters.push((r) => (op === "is" && val === null ? r[col] != null : true));
    return this;
  }
  order(): this {
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  private rows(): Row[] {
    let rs = table(this.db, this.name).filter((r) => this.filters.every((f) => f(r)));
    if (this.limitN != null) rs = rs.slice(0, this.limitN);
    return rs;
  }
  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return { data: this.rows()[0] ?? null, error: null };
  }
  async single(): Promise<{ data: Row | null; error: { message: string; code: string } | null }> {
    const rs = this.rows();
    if (rs.length === 0) {
      return { data: null, error: { message: "no rows", code: "PGRST116" } };
    }
    return { data: rs[0] ?? null, error: null };
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the fake builder
  then<T>(resolve: (v: { data: Row[]; error: null }) => T): T {
    return resolve({ data: this.rows(), error: null });
  }
}

class InsertBuilder {
  private done = false;
  constructor(
    private db: Db,
    private name: string,
    private row: Row,
    private uniqueKey: string[] | undefined,
  ) {}

  private apply(): { data: Row | null; error: { message: string; code: string } | null } {
    if (this.done) throw new Error("insert applied twice");
    this.done = true;
    const rows = table(this.db, this.name);
    if (this.uniqueKey) {
      const clash = rows.some((r) => this.uniqueKey?.every((k) => r[k] === this.row[k]));
      if (clash) {
        return { data: null, error: { message: "duplicate key", code: "23505" } };
      }
    }
    const stored: Row = { id: this.row.id ?? `${this.name}-${++idCounter}`, ...this.row };
    rows.push(stored);
    return { data: stored, error: null };
  }

  select(): { single: () => Promise<{ data: Row | null; error: unknown }> } {
    return {
      single: async () => {
        const r = this.apply();
        if (r.error) return { data: null, error: r.error };
        return { data: { id: (r.data as Row).id }, error: null };
      },
    };
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the fake builder
  then<T>(resolve: (v: { error: unknown }) => T): T {
    const r = this.apply();
    return resolve({ error: r.error });
  }
}

class UpdateBuilder {
  private filters: Array<(r: Row) => boolean> = [];
  constructor(
    private db: Db,
    private name: string,
    private patch: Row,
  ) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  private apply(): { error: null } {
    for (const r of table(this.db, this.name)) {
      if (this.filters.every((f) => f(r))) Object.assign(r, this.patch);
    }
    return { error: null };
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the fake builder
  then<T>(resolve: (v: { error: null }) => T): T {
    return resolve(this.apply());
  }
}

class TableBuilder extends SelectBuilder {
  constructor(
    db: Db,
    name: string,
    private uniqueKey: string[] | undefined,
  ) {
    super(db, name);
  }
  insert(row: Row): InsertBuilder {
    return new InsertBuilder(this.db, this.name, row, this.uniqueKey);
  }
  update(patch: Row): UpdateBuilder {
    return new UpdateBuilder(this.db, this.name, patch);
  }
}

/** Build a fake Supabase service client over an in-memory `Db`. */
export function makeFakeClient(db: Db, opts: Opts = {}): Client {
  return {
    from(name: string) {
      return new TableBuilder(db, name, opts.uniqueKeys?.[name]);
    },
    // biome-ignore lint/suspicious/noExplicitAny: only the surface we touch is mocked
  } as any;
}
