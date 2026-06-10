// ============================================================================
// Demo-tenant constants shared between the worker and the web app.
// ============================================================================
// The demo tenant uses FIXED UUIDs so seeding is idempotent and the worker can
// reference specific seeded entities (e.g. the arrears tenancy) without
// importing the full fixture set. scripts/demo-fixtures.mjs hardcodes the same
// values — a worker test asserts the two stay in sync.

export const DEMO_AGENCY_ID = "dd000000-0000-4000-a000-000000000001";

/** Deterministic UUID for demo entity n (mirrors scripts/demo-fixtures.mjs). */
export function demoId(n: number): string {
  return `dd000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
}

/**
 * The tenancy behind the rent-arrears scenario (21 Driftway Close). The demo
 * reset endpoint re-pins its `arrears_since` to 9 days before "today" so the
 * scenario's breach-notice timing is always live-accurate.
 */
export const DEMO_ARREARS_TENANCY_ID = demoId(305);
export const DEMO_ARREARS_DAYS = 9;
