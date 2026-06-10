// Type surface for scripts/demo-fixtures.mjs (plain-JS module; this keeps the
// worker's fixture-invariant tests typechecked under moduleResolution=Bundler).

export const DEMO_AGENCY_ID: string;
export function did(n: number): string;

export interface DemoScenarioFixture {
  id: string;
  sort_order: number;
  key: string;
  title: string;
  description: string;
  from_name: string;
  from_address: string;
  subject: string;
  body: string;
  compliance: Array<{ ruleKey?: string; formId?: string; label: string }>;
}

export interface DemoFixtures {
  agency: {
    id: string;
    name: string;
    suburb: string;
    business_hours: string;
    after_hours_emergency_line: string;
    principal_email: string;
    is_demo: boolean;
  };
  config: {
    nominated_repairer: { name: string; number: string };
    approved_tradies: Array<Record<string, string>>;
    voice_samples: Array<{ label: string; body: string }>;
    house_rules: string;
    pm_signoff_default: string;
  };
  pms: Array<{
    id: string;
    authUserId: string;
    email: string;
    fullName: string;
    role: string;
    signature: string;
  }>;
  owners: Array<{ id: string; full_name: string; email: string; phone: string }>;
  properties: Array<{
    id: string;
    owner_id: string;
    address_line1: string;
    suburb: string;
    postcode: string;
    state: string;
    managing_pm_id: string;
  }>;
  tenancies: Array<{
    id: string;
    property_id: string;
    status: string;
    agreement_type: string | null;
    start_date: string;
    end_date: string | null;
    rent_amount_cents: number;
    rent_frequency: string;
    bond_amount_cents: number;
    bond_rta_reference: string;
    last_routine_inspection_date: string | null;
    arrears_since: string | null;
    last_rent_increase_date: string | null;
  }>;
  tenants: Array<{
    id: string;
    tenancy_id: string;
    full_name: string;
    email: string;
    phone: string;
    is_primary: boolean;
  }>;
  scenarios: DemoScenarioFixture[];
}

export function buildDemoFixtures(todayIso: string): DemoFixtures;
