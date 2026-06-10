// Wizard step registry — shared by the /onboarding server actions and UI.
// (Lives in $lib because +page.server.ts may only export route handlers.)

export const WIZARD_STEPS = ["account", "connect-email", "import", "voice", "first-draft"] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];
