import { expect, test } from "@playwright/test";
import { startDemo } from "./helpers";

test("desktop: sidebar navigation, keyboard access, no bottom tab bar", async ({ page }) => {
  await startDemo(page);
  const sidebar = page.locator("aside nav");
  await expect(sidebar).toBeVisible();
  await expect(page.locator("nav.fixed")).toBeHidden(); // phone tab bar hidden
  // Keyboard: from a fresh page load the skip link is the first stop.
  await page.goto("/home");
  await page.getByTestId("home-hero").waitFor();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await sidebar.getByRole("link", { name: "Vendors" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/vendors$/);
  await expect(page.getByTestId("vendor-list")).toBeVisible();
  await sidebar.getByRole("link", { name: "Bills" }).click();
  await expect(page.getByTestId("bill-list")).toBeVisible();
});
