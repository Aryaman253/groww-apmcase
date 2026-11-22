import { expect, test } from "@playwright/test";

test("theme toggle persists across reloads", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(38, 38, 36)"); // #262624 — warm dark, no blue tint
  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("theme-light").click();
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
