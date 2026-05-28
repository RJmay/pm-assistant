import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres";
const RUN = process.env.RUN_DB_TESTS === "1";

// Stable, isolated UUIDs that never collide with seed.sql fixtures.
const AGENCY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AGENCY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OWNER_A = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
const OWNER_B = "bbbbbbbb-bbbb-bbbb-bbbb-000000000001";

const describeIf = RUN ? describe : describe.skip;

describeIf("RLS tenant isolation (RUN_DB_TESTS=1)", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = postgres(DB_URL, { onnotice: () => {} });
    // Idempotent cleanup so the test re-runs cleanly.
    await sql`delete from agencies where id in (${AGENCY_A}, ${AGENCY_B})`;
    await sql`
      insert into agencies (id, name) values
        (${AGENCY_A}, 'RLS Test A'),
        (${AGENCY_B}, 'RLS Test B')
    `;
    await sql`
      insert into owners (id, agency_id, full_name) values
        (${OWNER_A}, ${AGENCY_A}, 'Owner A'),
        (${OWNER_B}, ${AGENCY_B}, 'Owner B')
    `;
  });

  afterAll(async () => {
    if (sql) {
      await sql`delete from agencies where id in (${AGENCY_A}, ${AGENCY_B})`;
      await sql.end({ timeout: 5 });
    }
  });

  /**
   * Run `body` inside a transaction that drops privileges to the `authenticated`
   * role and sets `request.jwt.claims` so `auth_helpers.current_agency_id()`
   * returns the given agency. Mirrors what PostgREST sets up per HTTP request.
   */
  async function asAgency<T>(agencyId: string, body: (tx: Sql) => Promise<T>): Promise<T> {
    return sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      const claims = JSON.stringify({ app_metadata: { agency_id: agencyId } });
      await tx.unsafe(`set local request.jwt.claims = '${claims.replaceAll("'", "''")}'`);
      return body(tx as unknown as Sql);
    }) as Promise<T>;
  }

  it("agency A sees only its own owner", async () => {
    const rows = await asAgency(
      AGENCY_A,
      (tx) => tx<Array<{ id: string }>>`select id from owners where id in (${OWNER_A}, ${OWNER_B})`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(OWNER_A);
  });

  it("agency B sees only its own owner", async () => {
    const rows = await asAgency(
      AGENCY_B,
      (tx) => tx<Array<{ id: string }>>`select id from owners where id in (${OWNER_A}, ${OWNER_B})`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(OWNER_B);
  });

  it("agency A cannot insert a row under agency B's id (WITH CHECK)", async () => {
    await expect(
      asAgency(
        AGENCY_A,
        (tx) =>
          tx`insert into owners (agency_id, full_name) values (${AGENCY_B}, 'Sneaky') returning id`,
      ),
    ).rejects.toThrow();
  });
});
