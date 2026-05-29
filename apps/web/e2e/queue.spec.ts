import { expect, test } from "@playwright/test";

// Gated: needs a running app, a seeded Supabase, and credentials. Until the
// test system is up (Phase B), this self-skips so CI stays green.
const RUN = process.env.RUN_E2E_TESTS === "1";
const EMAIL = process.env.E2E_PM_EMAIL ?? "";
const PASSWORD = process.env.E2E_PM_PASSWORD ?? "";

test.describe("PM dashboard happy path", () => {
  test.skip(!RUN, "set RUN_E2E_TESTS=1 (+ E2E_PM_EMAIL / E2E_PM_PASSWORD) with the app running");

  test("login → queue → open a draft → edit body", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/queue/);
    await expect(page.getByRole("heading", { name: "Daily queue" })).toBeVisible();

    // Open the first draft in the queue (seed must provide at least one).
    const firstDraft = page.locator('a[href^="/queue/"]').first();
    await firstDraft.click();
    await expect(page).toHaveURL(/\/queue\/.+/);

    // Edit the body and save.
    const body = page.getByLabel("Body");
    await body.fill("Edited by the e2e suite.");
    await page.getByRole("button", { name: "Save edit" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();
  });
});
