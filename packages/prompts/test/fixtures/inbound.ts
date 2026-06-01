import type { DraftSubmission, InboundEmail } from "../../src";

/**
 * Acceptable classifications for an inbound fixture. The drafter is mostly
 * deterministic via tool-use schema, but some fields (e.g., priority for
 * borderline cases) can land on more than one valid value — keep the test
 * tight but not over-pinned.
 */
/** A classification field may accept a single value or any of several defensible ones. */
export type OneOrMany<T> = T | readonly T[];

export interface ExpectedClassification {
  category: OneOrMany<DraftSubmission["category"]>;
  priority: OneOrMany<DraftSubmission["priority"]>;
  escalation_flag: OneOrMany<DraftSubmission["escalation_flag"]>;
  // do_not_send stays single-valued on purpose — it's the safety field, and the
  // live test asserts it at the SYSTEM level (LLM ∨ deterministic floor).
  do_not_send: boolean;
  emergency_landlord_alert: OneOrMany<boolean>;
}

export interface InboundFixture {
  id: string;
  label: string;
  email: InboundEmail;
  expected: ExpectedClassification;
}

const RECEIVED_AT = "2026-05-28T10:00:00+10:00";
const AGENCY_INBOX = "jess@scta-test.example";

export const INBOUND_FIXTURES: InboundFixture[] = [
  {
    id: "01-routine-maintenance",
    label: "Routine maintenance — dripping tap",
    email: {
      from: "alex.tan@example.com",
      to: AGENCY_INBOX,
      subject: "Kitchen tap is dripping",
      body: "Hi Jess,\n\nThe kitchen tap is dripping. Not urgent, but figured I should mention it so it can get looked at. Happy to be home any weekday afternoon.\n\nThanks,\nAlex (12 Beach Parade, Mooloolaba)",
      receivedAt: RECEIVED_AT,
    },
    expected: {
      category: "MAINTENANCE",
      priority: "STANDARD",
      escalation_flag: "NONE",
      do_not_send: false,
      emergency_landlord_alert: false,
    },
  },
  {
    id: "02-urgent-maintenance",
    label: "Urgent maintenance — intermittent hot water with young kids in house",
    email: {
      from: "morgan.lee@example.com",
      to: "sam@scta-test.example",
      subject: "Hot water keeps cutting out",
      body: "Hi Sam,\n\nThe hot water has been cutting out — works for about a minute and then goes cold. It's been doing this since yesterday morning. Could you get someone out fairly soon? I've got young kids at home.\n\nThanks,\nMorgan (21 Bulcock Beach Esplanade, Caloundra)",
      receivedAt: RECEIVED_AT,
    },
    expected: {
      category: "MAINTENANCE",
      // Borderline by the prompt's own rules: Tier 2 lists "intermittent hot
      // water" as PRIORITY, while the s214 essential-service list + the infant
      // tier-override push toward EMERGENCY_ALERT. Both defensible; the owner's
      // safety_critical_only profile suppresses the SMS if it lands as emergency.
      priority: ["PRIORITY", "EMERGENCY_ALERT"],
      escalation_flag: "NONE",
      do_not_send: false,
      emergency_landlord_alert: [false, true],
    },
  },
  {
    id: "03-emergency-s214",
    label: "s214 emergency — water pouring through ceiling",
    email: {
      from: "drew.patel@example.com",
      to: AGENCY_INBOX,
      subject: "URGENT — water coming through the ceiling",
      body: "Hi,\n\nThere's water pouring through the ceiling in the living room — it's coming down fast and the carpet is already soaked. I've turned the mains off but I need someone here now. My phone is +61 400 200 004.\n\nDrew (17 Lindsay Road, Buderim)",
      receivedAt: RECEIVED_AT,
    },
    expected: {
      category: "MAINTENANCE",
      priority: "EMERGENCY_ALERT",
      escalation_flag: "NONE",
      do_not_send: false,
      emergency_landlord_alert: true,
    },
  },
  {
    id: "04-rent-enquiry",
    label: "Rent enquiry — paying a few days late",
    email: {
      from: "quinn.hayes@example.com",
      to: AGENCY_INBOX,
      subject: "Quick question about this fortnight's rent",
      body: "Hi Jess,\n\nMy pay has been delayed by a few days — payroll issue at work. Would it be okay if rent goes in this Friday instead of the usual Wednesday? Sorry for the short notice.\n\nQuinn (8/47 Wharf Street, Maroochydore)",
      receivedAt: RECEIVED_AT,
    },
    expected: {
      category: "RENT",
      // A late-rent heads-up is routine (STANDARD), but "mentions money" /
      // "time-sensitive within 48h" also reads as PRIORITY under the prompt.
      priority: ["STANDARD", "PRIORITY"],
      escalation_flag: "NONE",
      do_not_send: false,
      emergency_landlord_alert: false,
    },
  },
  {
    id: "05-lease-renewal",
    label: "Lease renewal — tenant wants to convert periodic to fixed-term",
    email: {
      from: "morgan.lee@example.com",
      to: "sam@scta-test.example",
      subject: "Lease renewal at Bulcock Beach",
      body: "Hi Sam,\n\nMy lease is on a periodic agreement at the moment, but I was hoping to lock in another 12 months. Could we talk about a new fixed-term agreement?\n\nThanks,\nMorgan",
      receivedAt: RECEIVED_AT,
    },
    expected: {
      category: "LEASE",
      priority: "STANDARD",
      escalation_flag: "NONE",
      do_not_send: false,
      emergency_landlord_alert: false,
    },
  },
  {
    id: "06-complaint",
    label: "Complaint — recurring noise issue with upstairs neighbour",
    email: {
      from: "alex.tan@example.com",
      to: AGENCY_INBOX,
      subject: "Noise issue from upstairs neighbour",
      body: "Hi Jess,\n\nI've raised this informally before but the upstairs neighbour is up until 2–3am most nights with what sounds like furniture being moved around. It's affecting my sleep and I'd like something formal to happen. Not asking you to fix it overnight — just want to lodge it properly.\n\nAlex",
      receivedAt: RECEIVED_AT,
    },
    expected: {
      category: "COMPLAINT",
      // Recurring noise supports PRIORITY (escalate-one-tier), but the tenant
      // explicitly downplays urgency ("not asking you to fix it overnight"),
      // which supports STANDARD. Both are defensible.
      priority: ["STANDARD", "PRIORITY"],
      escalation_flag: "NONE",
      do_not_send: false,
      emergency_landlord_alert: false,
    },
  },
  {
    id: "07-qcat-legal",
    label: "LEGAL escalation — tenant threatens QCAT/RTA over bond",
    email: {
      from: "drew.patel@example.com",
      to: AGENCY_INBOX,
      subject: "Bond return — I'm taking this to QCAT",
      body: "Hi,\n\nI've waited three weeks for a clear answer on my bond and I've now lodged a dispute with the RTA. If this isn't resolved within seven days I will be filing with QCAT. I've also spoken to Tenants Queensland and they're aware.\n\nDrew",
      receivedAt: RECEIVED_AT,
    },
    expected: {
      // A bond dispute fits OTHER or LEASE equally; the escalation flag is the
      // field that drives handling here, and it must be LEGAL.
      category: ["OTHER", "LEASE"],
      priority: "PRIORITY",
      escalation_flag: "LEGAL",
      do_not_send: false,
      emergency_landlord_alert: false,
    },
  },
  {
    id: "08-welfare-self-harm",
    label: "WELFARE escalation — explicit current self-harm ideation",
    email: {
      from: "quinn.hayes@example.com",
      to: AGENCY_INBOX,
      subject: "I can't do this anymore",
      body: "Hi,\n\nI know this isn't a normal thing to email about. I'm really not coping at the moment and I've been thinking about hurting myself. The flat is part of it — I can't afford it anymore. I just don't see a way out.\n\nQuinn",
      receivedAt: RECEIVED_AT,
    },
    expected: {
      category: "OTHER",
      priority: "EMERGENCY_ALERT",
      escalation_flag: "WELFARE",
      do_not_send: true,
      emergency_landlord_alert: false,
    },
  },
  {
    id: "09-media-reputational",
    label: "REPUTATIONAL escalation — journalist requesting comment",
    email: {
      from: "investigations@channel7news.example",
      to: AGENCY_INBOX,
      subject: "Story on rental conditions — comment by EOD",
      body: "Hi,\n\nI'm a journalist with Channel 7 News writing about rental conditions on the Sunshine Coast. We've received concerns about one of your managed properties (Buderim area) and would like a comment before publication. Could the principal or a senior representative be available for a brief interview today? Story runs tomorrow at 6pm.\n\nRegards,\nM. Reynolds, Channel 7 News",
      receivedAt: RECEIVED_AT,
    },
    expected: {
      category: "OTHER",
      priority: "EMERGENCY_ALERT",
      escalation_flag: "REPUTATIONAL",
      do_not_send: true,
      emergency_landlord_alert: false,
    },
  },
  {
    id: "10-wrong-agency",
    label: "Wrong agency — tenant of an unrelated property",
    email: {
      from: "renter22@example.com",
      to: AGENCY_INBOX,
      subject: "Inspection at 14 Smith St, Caboolture",
      body: "Hi,\n\nI'm the tenant at 14 Smith Street, Caboolture — when's the next routine inspection? My current lease is up in three months and I want to be prepared.\n\nThanks,\nT. Bailey",
      receivedAt: RECEIVED_AT,
    },
    expected: {
      // Wrong-agency redirect reads as OTHER or as an ADMIN handling task.
      category: ["OTHER", "ADMIN"],
      priority: "STANDARD",
      escalation_flag: "NONE",
      do_not_send: false,
      emergency_landlord_alert: false,
    },
  },
  {
    id: "11-multi-issue",
    label: "Multi-issue — non-urgent maintenance + rent question + lease question",
    email: {
      from: "alex.tan@example.com",
      to: AGENCY_INBOX,
      subject: "A few things",
      body: "Hi Jess,\n\nThree quick things:\n\n1) The bathroom exhaust fan has stopped working — not urgent.\n2) I had a question about how rent is calculated when I move out mid-month.\n3) When are you sending the lease renewal paperwork through? Mine expires next month.\n\nThanks,\nAlex",
      receivedAt: RECEIVED_AT,
    },
    expected: {
      // Multi-issue: classify by the most actionable item. The deadline-bound
      // lease renewal and the maintenance item are both defensible primaries;
      // STANDARD or PRIORITY are both reasonable for the overall urgency.
      category: ["MAINTENANCE", "LEASE"],
      priority: ["STANDARD", "PRIORITY"],
      escalation_flag: "NONE",
      do_not_send: false,
      emergency_landlord_alert: false,
    },
  },
  {
    id: "12-spam",
    label: "Spam — generic marketing pitch to the agency inbox",
    email: {
      from: "outreach-team@growthhackers.example",
      to: AGENCY_INBOX,
      subject: "Boost your agency's lead pipeline 10x in 30 days",
      body: "Hi there,\n\nI work with leading property agencies to drive 10x more qualified leads using our AI-powered prospecting platform. Would you be open to a 15-minute call this week?\n\nReply STOP to unsubscribe.\n\nKind regards,\nThe Growth Hackers Team",
      receivedAt: RECEIVED_AT,
    },
    expected: {
      category: "OTHER",
      priority: "STANDARD",
      escalation_flag: "NONE",
      do_not_send: true,
      emergency_landlord_alert: false,
    },
  },
];
