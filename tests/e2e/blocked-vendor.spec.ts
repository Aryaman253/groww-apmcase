import { expect, test } from "@playwright/test";
import { hold, startDemo } from "./helpers";

test("a vendor with changed bank details is blocked until reviewed", async ({ page }) => {
  await startDemo(page);
  await page.getByTestId("start-run").click();
  await page.waitForURL(/\/pay\/[0-9a-f-]{36}/);
  const runUrl = page.url();
  await page.getByRole("button", { name: "Everything due" }).click();
  await page.getByTestId("to-review").click();

  const moonlight = page.locator('[data-testid="review-row"][data-vendor="Moonlight Medicos"]');
  await expect(moonlight.locator('[data-warning="CHANGED_AWAITING_APPROVAL"]')).toBeVisible();
  await expect(page.getByTestId("to-confirm")).toBeDisabled();

  // Review: old vs new, then explicit approval (press and hold).
  await moonlight.getByRole("link", { name: "Fix" }).click();
  await page.getByTestId("review-panel").waitFor();
  await page.getByTestId("approve-bank").click();
  await hold(page, "confirm-approve");
  await page.waitForURL(/\/vendors\/[0-9a-f-]{36}$/);

  await page.goto(runUrl);
  // The draft remembers its step.
  await page.getByTestId("step-select").or(page.getByTestId("step-review")).waitFor();
  if (await page.getByTestId("to-review").isVisible()) await page.getByTestId("to-review").click();
  await expect(moonlight.locator('[data-warning="CHANGED_AWAITING_APPROVAL"]')).toHaveCount(0);
  // The other unreviewed vendor still blocks the run until removed.
  const pinnacle = page.locator('[data-testid="review-row"][data-vendor="Pinnacle Ortho Supplies"]');
  await expect(pinnacle.locator('[data-warning="BANK_NOT_APPROVED"]')).toBeVisible();
  await pinnacle.getByRole("button", { name: "Remove from run" }).click();
  await expect(page.getByTestId("to-confirm")).toBeEnabled();
});
