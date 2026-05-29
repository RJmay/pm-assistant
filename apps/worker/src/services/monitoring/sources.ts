// ============================================================================
// Monitored regulatory sources (spec §12, in priority order)
// ============================================================================
// The initial monitored set for the QLD regulatory monitoring bot. These are
// monitoring CONFIG (operator-adjustable), not regulatory facts — the bot
// fetches each, hash-and-diffs the relevant section, and raises a
// regulatory_alerts row on a detected change. Priority mirrors §12:
//   1 RTA (the authority for rental-law changes + forms + bonds)
//   2 Dept of Housing (legislation / rental-law-change news)
//   3 QLD Legislation register (the Act + the 2025 Regulation themselves)
// QLD Parliament (bills) + industry interpreters (REIQ) can be added later.
// ============================================================================

export interface MonitoredSource {
  key: string;
  name: string;
  url: string;
  /** 1 = highest priority (scan first / weight summaries). */
  priority: number;
}

export const MONITORED_SOURCES: readonly MonitoredSource[] = [
  {
    key: "rta_rental_law_changes",
    name: "RTA — rental law changes",
    url: "https://www.rta.qld.gov.au/rental-law-changes",
    priority: 1,
  },
  {
    key: "rta_forms",
    name: "RTA — forms",
    url: "https://www.rta.qld.gov.au/forms",
    priority: 1,
  },
  {
    key: "housing_rental_law_reform",
    name: "Queensland Department of Housing — rental law reform",
    url: "https://www.housing.qld.gov.au/initiatives/rent-law-changes",
    priority: 2,
  },
  {
    key: "qld_legislation_rtra_act",
    name: "QLD Legislation — RTRA Act 2008",
    url: "https://www.legislation.qld.gov.au/view/html/inforce/current/act-2008-073",
    priority: 3,
  },
  {
    key: "qld_legislation_rtra_regulation_2025",
    name: "QLD Legislation — RTRA Regulation 2025",
    url: "https://www.legislation.qld.gov.au/view/html/inforce/current/sl-2025-0100",
    priority: 3,
  },
];
