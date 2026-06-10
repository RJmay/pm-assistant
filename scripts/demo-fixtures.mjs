// ============================================================================
// Demo fixtures — Coastline Property Management (Demo)
// ============================================================================
// Single source of truth for the demo tenant's structure: agency, config, PMs,
// owners, 25 properties (Sunshine Coast suburbs, fictional streets), tenancies,
// tenants, and the 10-scenario inbound-email library.
//
// Plain .mjs (not TS) so the seed CLI (node + postgres driver) can import it
// directly; worker tests import it too for invariant checks (vitest reads .mjs
// fine). All entities use FIXED UUIDs (dd…-prefixed) so seeding is idempotent:
// delete the agency (FK cascade) → recreate, byte-for-byte identical structure.
//
// Compliance metadata carries RULE KEYS / FORM IDS resolved through @pm/rules
// at render time — never hardcoded statutory values (spec §0.3). Scenarios
// without engine-backed rules (pets, smoke alarms, water, bond) get process
// chips with NO numeric legal claims.
//
// All people and street addresses are fictional; emails use the IANA-reserved
// example.com so nothing can ever receive real mail.
// ============================================================================

export const DEMO_AGENCY_ID = "dd000000-0000-4000-a000-000000000001";

/** Deterministic UUID for demo entity n in a numbered range. */
export function did(n) {
  return `dd000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
}

// ---------------------------------------------------------------------------
// Date helpers (UTC, ISO date strings). Generated dates always use day ≤ 28 so
// month arithmetic never needs end-of-month clamping.
// ---------------------------------------------------------------------------

function shiftDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function shiftMonths(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, 28))).toISOString().slice(0, 10);
}

const emailFor = (name) =>
  `${name
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/ +/g, ".")}@example.com`;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const OWNER_NAMES = [
  "Margaret Whitfield",
  "Tony Castellaro",
  "Priya Raman",
  "Bruce & Helen Caldwell",
  "Stavros Dimitriou",
  "Jenny Nakamura",
  "Rob Tennant",
  "Alicia Vandenberg",
  "Colin Mackay",
  "Deb Forsythe",
  "Sam Liu",
  "Patricia Hogan",
  "Marcus Webb",
  "Karen Albright",
  "Geoff Pemberton",
];

const TENANT_NAMES = [
  ["Mia Thompson", "Jake Thompson"],
  ["Liam O'Connor"],
  ["Grace Nguyen", "Daniel Nguyen"],
  ["Harrison Cole"],
  ["Chloe Patterson"],
  ["Ethan Walsh", "Sophie Walsh"],
  ["Aaliyah Khan"],
  ["Noah Bennett"],
  ["Isla McGregor", "Fergus McGregor"],
  ["Oscar Lindqvist"],
  ["Ruby Tran"],
  ["Henry Abbott", "Paula Abbott"],
  ["Zoe Calloway"],
  ["Lucas Moretti"],
  ["Evie Saunders"],
  ["Max Delaney", "Erin Delaney"],
  ["Charlotte Iversen"],
  ["Tom Hutchins"],
  ["Freya Aldridge"],
  ["Archie Pemell", "Tahlia Pemell"],
  ["Layla Brooks"],
  ["Felix Ngata"],
  ["Matilda Crane"],
];

// ---------------------------------------------------------------------------
// 25 properties: [street, suburb, postcode, ownerIdx, rent $/wk (null=vacant),
//                 agreement, startMonthsAgo, endMonthsAhead (null=periodic/none),
//                 lastInspectionMonthsAgo (null=never)]
// Suburbs are real Sunshine Coast suburbs; streets + numbers are fictional.
// ---------------------------------------------------------------------------

const PROPERTY_ROWS = [
  ["12 Banksia Street", "Maroochydore", "4558", 0, 650, "fixed", 8, 4, 5],
  ["48 Coraki Lane", "Maroochydore", "4558", 1, 540, "periodic", 22, null, 4],
  ["7 Tidewater Court", "Maroochydore", "4558", 2, 850, "fixed", 5, 7, 2],
  ["133 Plover Parade", "Maroochydore", "4558", 3, 480, "periodic", 30, null, 7],
  ["21 Driftway Close", "Maroochydore", "4558", 4, 720, "fixed", 11, 1, 5],
  ["3 Marlin Ridge", "Maroochydore", "4558", 5, 590, "fixed", 2, 10, 1],
  ["66 Kurrajong Avenue", "Maroochydore", "4558", 0, 610, "periodic", 18, null, 3],
  ["9 Sandpiper Walk", "Maroochydore", "4558", 6, null, null, 0, null, null],
  ["15 Seabreeze Terrace", "Coolum Beach", "4573", 7, 780, "fixed", 9, 3, 4],
  ["82 Mistral Street", "Coolum Beach", "4573", 8, 560, "periodic", 26, null, 6],
  ["4 Pandanus Rise", "Coolum Beach", "4573", 9, 690, "fixed", 6, 6, 2],
  ["27 Whitehaven Drive", "Coolum Beach", "4573", 10, 830, "fixed", 13, 2, 5],
  ["50 Cuttlefish Court", "Coolum Beach", "4573", 11, 470, "periodic", 35, null, 8],
  ["11 Norfolk Crescent", "Coolum Beach", "4573", 2, 640, "fixed", 4, 8, 3],
  ["38 Jacaranda Grove", "Buderim", "4556", 12, 750, "fixed", 10, 2, 4],
  ["6 Stonewood Place", "Buderim", "4556", 13, 580, "periodic", 16, null, 5],
  ["94 Highview Terrace", "Buderim", "4556", 14, 820, "fixed", 7, 5, 3],
  ["19 Fig Tree Lane", "Buderim", "4556", 4, 500, "periodic", 28, null, 6],
  ["43 Carramar Street", "Buderim", "4556", 5, 670, "fixed", 3, 9, 1],
  ["8 Mango Hill Court", "Buderim", "4556", 6, null, null, 0, null, null],
  ["25 Lighthouse Road", "Caloundra", "4551", 7, 620, "fixed", 12, 1, 5],
  ["71 Spinnaker Boulevard", "Caloundra", "4551", 8, 450, "periodic", 40, null, 9],
  ["14 Moffat Crest", "Caloundra", "4551", 9, 700, "fixed", 6, 6, 2],
  ["5 Westaway Parade", "Caloundra", "4551", 10, 530, "periodic", 20, null, 4],
  ["32 Bulcock Vale", "Caloundra", "4551", 11, 760, "fixed", 9, 3, 4],
];

// Scenario anchor indices into PROPERTY_ROWS (documented where used):
const P_HOTWATER = 0; // 12 Banksia Street — Mia Thompson, no hot water
const P_ARREARS = 4; // 21 Driftway Close — 9 days in arrears; owner Stavros asks
const P_INSPECTION = 3; // 133 Plover Parade — inspection due (7 months since last)
const P_RENEWAL = 8; // 15 Seabreeze Terrace — fixed term ending in ~3 months
const P_PET = 14; // 38 Jacaranda Grove — pet request
const P_SMOKE = 10; // 4 Pandanus Rise — owner smoke-alarm query
const P_BOND = 16; // 94 Highview Terrace — bond top-up after rent increase
const P_WATER = 12; // 50 Cuttlefish Court — water charging dispute
const P_TRADIE = 0; // tradie quote references the Banksia St hot water job
const P_RENTREVIEW = 6; // 66 Kurrajong Avenue — owner rent review + comps

/**
 * Build the full fixture set relative to `todayIso` (YYYY-MM-DD).
 * Relative dates (arrears 9 days ago, inspection anchors, lease windows) are
 * computed here so a fresh seed is always demo-ready.
 */
export function buildDemoFixtures(todayIso) {
  const agency = {
    id: DEMO_AGENCY_ID,
    name: "Coastline Property Management (Demo)",
    suburb: "Maroochydore",
    business_hours: "Mon–Fri 8:30am–5pm AEST",
    after_hours_emergency_line: "+61 7 5550 0199",
    principal_email: "principal.coastline.demo@example.com",
    is_demo: true,
  };

  const config = {
    nominated_repairer: { name: "Reef City Plumbing (Demo)", number: "+61 7 5550 0142" },
    approved_tradies: [
      {
        trade: "Plumbing",
        name: "Reef City Plumbing (Demo)",
        business_hours_contact: "+61 7 5550 0142",
        after_hours_contact: "+61 4 0055 0142",
      },
      {
        trade: "Electrical",
        name: "Brightline Electrical (Demo)",
        business_hours_contact: "+61 7 5550 0177",
        after_hours_contact: "+61 4 0055 0177",
      },
      {
        trade: "General",
        name: "Hinterland Maintenance Co (Demo)",
        business_hours_contact: "+61 7 5550 0163",
      },
    ],
    voice_samples: [
      {
        label: "Warm acknowledgement",
        body: "Hi {name},\n\nThanks so much for letting us know — I've logged this and will have someone onto it shortly. I'll keep you posted at every step.\n\nWarm regards,",
      },
      {
        label: "Professional update to an owner",
        body: "Hi {name},\n\nA quick update on {property}: everything is on track and I'll confirm once the work is complete. Please don't hesitate to call if you'd like to talk it through.\n\nKind regards,",
      },
    ],
    house_rules:
      "- Tone: professional, warm\n- Pet requests are considered on their merits — never refuse outright\n- Always offer a phone call for sensitive matters\n- Quotes over the threshold go to the owner before any work is booked",
    pm_signoff_default: "Warm regards,",
  };

  const pms = [
    {
      id: did(501),
      authUserId: did(551),
      email: "sophie.demo@example.com",
      fullName: "Sophie Marsh",
      role: "pm",
      signature: "Sophie Marsh | Senior Property Manager | Coastline Property Management (Demo)",
    },
    {
      id: did(502),
      authUserId: did(552),
      email: "daniel.demo@example.com",
      fullName: "Daniel Reyes",
      role: "principal",
      signature: "Daniel Reyes | Principal | Coastline Property Management (Demo)",
    },
  ];

  const owners = OWNER_NAMES.map((name, i) => ({
    id: did(101 + i),
    full_name: name,
    email: emailFor(name),
    phone: `+61 4 ${String(1200 + i).padStart(4, "0")} ${String(3300 + i * 7).padStart(4, "0")}`,
  }));

  const properties = [];
  const tenancies = [];
  const tenants = [];
  let tenantIdx = 0;
  let tenantId = 401;

  PROPERTY_ROWS.forEach((row, i) => {
    const [street, suburb, postcode, ownerIdx, rentWk, agreement, startAgo, endAhead, inspAgo] =
      row;
    const propertyId = did(201 + i);
    properties.push({
      id: propertyId,
      owner_id: owners[ownerIdx].id,
      address_line1: street,
      suburb,
      postcode,
      state: "QLD",
      managing_pm_id: pms[i % 2 === 0 ? 0 : 1].id,
    });
    if (rentWk === null) return; // vacant

    const tenancyId = did(301 + i);
    const rentCents = rentWk * 100;
    tenancies.push({
      id: tenancyId,
      property_id: propertyId,
      status: "active",
      agreement_type: agreement,
      start_date: shiftMonths(todayIso, -startAgo),
      end_date: agreement === "fixed" && endAhead !== null ? shiftMonths(todayIso, endAhead) : null,
      rent_amount_cents: rentCents,
      rent_frequency: "weekly",
      // Bond = 4 weeks rent, lodged with the RTA (reference is fictional).
      bond_amount_cents: rentCents * 4,
      bond_rta_reference: `RTA-1${String(704200 + i * 13)}`,
      last_routine_inspection_date: inspAgo === null ? null : shiftMonths(todayIso, -inspAgo),
      // 21 Driftway Close is the arrears scenario: 9 days behind as of seed time.
      arrears_since: i === P_ARREARS ? shiftDays(todayIso, -9) : null,
      // 94 Highview Terrace had a recent increase (bond top-up scenario).
      last_rent_increase_date: i === P_BOND ? shiftMonths(todayIso, -2) : null,
    });

    const names = TENANT_NAMES[tenantIdx % TENANT_NAMES.length];
    tenantIdx += 1;
    names.forEach((name, j) => {
      tenants.push({
        id: did(tenantId++),
        tenancy_id: tenancyId,
        full_name: name,
        email: emailFor(name),
        phone: `+61 4 ${String(2600 + tenantId).padStart(4, "0")} ${String(8100 + tenantId * 3).padStart(4, "0")}`,
        is_primary: j === 0,
      });
    });
  });

  const tenantAt = (propIdx) => {
    const tenancyId = did(301 + propIdx);
    return tenants.find((t) => t.tenancy_id === tenancyId && t.is_primary);
  };
  const ownerAt = (propIdx) => owners[PROPERTY_ROWS[propIdx][3]];
  const addr = (propIdx) => `${PROPERTY_ROWS[propIdx][0]}, ${PROPERTY_ROWS[propIdx][1]}`;

  // -------------------------------------------------------------------------
  // The 10-scenario library. Senders are seeded tenants/owners (exact-email
  // matching exercises the real matcher); the tradie quote deliberately comes
  // from an unknown third party. `compliance` = chips for the demo UI:
  // { ruleKey } and { formId } entries resolve through @pm/rules at render
  // time; bare { label } entries are process notes with NO statutory numbers.
  // -------------------------------------------------------------------------

  const s = (n, fields) => ({ id: did(601 + n), sort_order: n, ...fields });
  const scenarios = [
    s(0, {
      key: "urgent-maintenance-hot-water",
      title: "Urgent: no hot water",
      description:
        "Tenant reports a total hot water failure — exercises the s214 emergency-repair pathway, nominated-repairer language and the owner emergency alert.",
      from_name: tenantAt(P_HOTWATER).full_name,
      from_address: tenantAt(P_HOTWATER).email,
      subject: "No hot water at 12 Banksia Street",
      body: `Hi,\n\nWe've got no hot water at all at ${addr(P_HOTWATER)} — it stopped working last night and this morning it's still freezing cold. We've checked the fuse box and nothing's tripped. The unit is the gas system in the laundry cupboard.\n\nWe have a toddler at home so could someone please come out as soon as possible?\n\nThanks,\n${tenantAt(P_HOTWATER).full_name}`,
      compliance: [
        { ruleKey: "emergency_repairs_s214", label: "Emergency repair — s214 pathway" },
        { label: "Nominated repairer dispatch language (s218)" },
        { label: "Owner emergency alert raised (sandboxed in demo)" },
      ],
    }),
    s(1, {
      key: "rent-arrears-owner-query",
      title: "Rent arrears — owner asks",
      description:
        "The tenancy is 9 days in arrears; the owner wants to know what's happening. The draft must reference breach-notice timing from the rules engine — not guesswork.",
      from_name: ownerAt(P_ARREARS).full_name,
      from_address: ownerAt(P_ARREARS).email,
      subject: `Rent at ${addr(P_ARREARS)}?`,
      body: `Hi team,\n\nI noticed the rent for ${addr(P_ARREARS)} hasn't come through this cycle. Can you tell me what's going on and what the process is from here if it isn't paid? I don't want to be heavy-handed but I do have a mortgage on that place.\n\nRegards,\n${ownerAt(P_ARREARS).full_name}`,
      compliance: [
        {
          ruleKey: "notice_remedy_breach_rent_arrears",
          formId: "11",
          label: "Breach notice (Form 11) — rent arrears timing",
        },
        { label: "Days in arrears computed from the tenancy ledger flag" },
      ],
    }),
    s(2, {
      key: "routine-inspection-scheduling",
      title: "Routine inspection due",
      description:
        "Tenant asks when the next inspection is; one is now due. The draft must reference the entry-notice requirement and minimum notice period (Form 9).",
      from_name: tenantAt(P_INSPECTION).full_name,
      from_address: tenantAt(P_INSPECTION).email,
      subject: "Next inspection?",
      body: `Hi,\n\nJust wondering when our next routine inspection at ${addr(P_INSPECTION)} is due? We'd like a bit of notice to tidy up, and Tuesdays are generally bad for us as I work from home with back-to-back calls.\n\nCheers,\n${tenantAt(P_INSPECTION).full_name}`,
      compliance: [
        {
          ruleKey: "entry_notice_routine",
          formId: "9",
          label: "Entry notice (Form 9) — minimum notice period",
        },
        { ruleKey: "entry_frequency_cap", label: "Routine inspection frequency cap" },
      ],
    }),
    s(3, {
      key: "lease-renewal-enquiry",
      title: "Lease renewal enquiry",
      description:
        "Tenant asks about renewing a fixed term that ends soon. The draft proposes next steps and flags rent-increase notice rules.",
      from_name: tenantAt(P_RENEWAL).full_name,
      from_address: tenantAt(P_RENEWAL).email,
      subject: `Renewing our lease at ${addr(P_RENEWAL)}`,
      body: `Hi,\n\nOur lease at ${addr(P_RENEWAL)} is coming up to its end date and we'd love to stay on — ideally another 12 months. Could you let us know what the owner is thinking, and whether the rent would change? We've really looked after the place.\n\nThanks so much,\n${tenantAt(P_RENEWAL).full_name}`,
      compliance: [
        { ruleKey: "rent_increase_frequency", label: "Rent increase frequency limit" },
        { ruleKey: "rent_increase_min_notice", label: "Rent increase minimum notice" },
      ],
    }),
    s(4, {
      key: "pet-request-dog",
      title: "Pet request — dog",
      description:
        "Tenant asks to keep a dog. QLD's pet-request framework is handled by the drafting prompt with hedged, current-framework language — no statutory number is asserted by the demo.",
      from_name: tenantAt(P_PET).full_name,
      from_address: tenantAt(P_PET).email,
      subject: "Request to keep a dog",
      body: `Hi,\n\nWe'd like to ask the owner's permission to keep a dog at ${addr(P_PET)} — a 4-year-old cavoodle, desexed, house-trained, about 7kg. We're happy to put it in writing and discuss any reasonable conditions like professional carpet cleaning at the end of the tenancy.\n\nWhat's the process from here and how long does a decision usually take?\n\nKind regards,\n${tenantAt(P_PET).full_name}`,
      compliance: [
        { label: "QLD pet-request framework — drafted with current-framework hedging" },
        { label: "Response window referenced without asserting an unverified number" },
      ],
    }),
    s(5, {
      key: "smoke-alarm-owner-query",
      title: "Smoke alarm compliance (owner)",
      description:
        "Owner asks whether their property meets the QLD smoke-alarm requirements — prompt-guided guidance plus a pointer to the agency's compliance register.",
      from_name: ownerAt(P_SMOKE).full_name,
      from_address: ownerAt(P_SMOKE).email,
      subject: `Smoke alarms — ${addr(P_SMOKE)}`,
      body: `Hello,\n\nA friend mentioned the smoke alarm rules for rentals changed in Queensland. Is ${addr(P_SMOKE)} compliant with the current requirements, and when were the alarms last serviced? Do I need to do anything before the next tenancy renewal?\n\nThanks,\n${ownerAt(P_SMOKE).full_name}`,
      compliance: [
        { label: "Smoke-alarm compliance — guidance drafted without inventing dates/values" },
        { label: "Flags service-history check as a PM action" },
      ],
    }),
    s(6, {
      key: "bond-top-up-after-increase",
      title: "Bond top-up after rent increase",
      description:
        "Rent went up two months ago; the draft explains the RTA bond top-up process and checks the increase's validity against the rules engine.",
      from_name: tenantAt(P_BOND).full_name,
      from_address: tenantAt(P_BOND).email,
      subject: "Bond top up?",
      body: `Hi,\n\nWe got a letter about topping up our bond at ${addr(P_BOND)} after the recent rent increase. Can you explain how the top-up amount is worked out and how we pay it — does it go to you or straight to the RTA?\n\nThanks,\n${tenantAt(P_BOND).full_name}`,
      compliance: [
        { label: "Bond top-up — RTA process explained" },
        { ruleKey: "rent_increase_frequency", label: "Rent increase validity cross-check" },
      ],
    }),
    s(7, {
      key: "water-charging-dispute",
      title: "Water charging dispute",
      description:
        "Tenant questions a water bill. Water-efficiency prerequisites are explained with hedged language — the demo asserts no unverified statutory values.",
      from_name: tenantAt(P_WATER).full_name,
      from_address: tenantAt(P_WATER).email,
      subject: `Water bill at ${addr(P_WATER)}`,
      body: `Hi,\n\nWe've been charged $187 for water this quarter at ${addr(P_WATER)} but our understanding is we only have to pay full water costs if the property is water-efficient. Can you confirm whether it's certified water-efficient and send through whatever documentation supports the charge?\n\nRegards,\n${tenantAt(P_WATER).full_name}`,
      compliance: [
        { label: "Water charging — efficiency prerequisites, hedged until verified" },
        { label: "Requests documentation check as a PM action" },
      ],
    }),
    s(8, {
      key: "tradie-quote-follow-up",
      title: "Tradie quote follow-up",
      description:
        "A plumber sends a quote for the Banksia Street hot-water job. The draft routes an owner-approval request per the agency's spending authority.",
      from_name: "Reef City Plumbing (Demo)",
      from_address: "quotes.reefcityplumbing.demo@example.com",
      subject: "Quote — hot water system replacement, 12 Banksia Street",
      body: `Hi Coastline team,\n\nFollowing this morning's call-out to ${addr(P_TRADIE)}: the gas hot water unit has a failed heat exchanger and isn't economical to repair. Quote to supply and install a like-for-like replacement: $1,850 inc GST, available to install Thursday.\n\nLet us know how you'd like to proceed.\n\nReef City Plumbing (Demo)`,
      compliance: [
        { label: "Spending authority — owner approval gate before works" },
        { label: "Routes via the maintenance quote → approval workflow" },
      ],
    }),
    s(9, {
      key: "owner-rent-review-comps",
      title: "Owner rent review + comps",
      description:
        "Owner asks whether the rent is at market and requests comparables. The draft frames a review against increase-frequency and notice rules.",
      from_name: ownerAt(P_RENTREVIEW).full_name,
      from_address: ownerAt(P_RENTREVIEW).email,
      subject: `Rent review — ${addr(P_RENTREVIEW)}`,
      body: `Hi,\n\nIt's been a while since the rent moved at ${addr(P_RENTREVIEW)}. Could you put together a quick view of what similar places nearby are getting and whether a review is sensible at the next renewal? Keen to keep the tenants — they're great — so nothing aggressive.\n\nCheers,\n${ownerAt(P_RENTREVIEW).full_name}`,
      compliance: [
        { ruleKey: "rent_increase_frequency", label: "Increase frequency limit" },
        { ruleKey: "rent_increase_min_notice", label: "Minimum notice for an increase" },
        { ruleKey: "rent_bidding_ban", label: "Rent bidding ban constraints" },
      ],
    }),
  ];

  return { agency, config, pms, owners, properties, tenancies, tenants, scenarios };
}
