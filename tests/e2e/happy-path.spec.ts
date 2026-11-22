import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { chooseMethodForAll, confirmRun, openDraftToReview, startDemo } from "./helpers";

test("demo happy path: Home → run → confirm → download bank file → upload status file → completed", async ({ page }) => {
  await startDemo(page);
  await openDraftToReview(page);
  await chooseMethodForAll(page, "Bank file");
  await confirmRun(page);

  const card = page.getByTestId("bank-file-card");
  await expect(card.getByTestId("download-bank-file")).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), card.getByTestId("download-bank-file").click()]);
  expect(download.suggestedFilename()).toMatch(/^shubh-medicals-demo-r\d{4}-\d{8}\.csv$/i);
  const file = path.join(os.tmpdir(), `bank-${Date.now()}.csv`);
  await download.saveAs(file);
  const lines = readFileSync(file, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const acctCol = header.indexOf("Beneficiary Account No");
  const amtCol = header.indexOf("Amount");
  expect(acctCol).toBeGreaterThanOrEqual(0);

  await card.getByTestId("mark-file-sent").click();
  await expect(page.getByTestId("payment-row").first()).toHaveAttribute("data-status", "sent");

  // The bank's status report: account + amount + UTR + status.
  const status = ["Beneficiary Account No,Amount,UTR,Status"].concat(
    lines.slice(1).map((l, i) => {
      const c = l.split(",");
      return `${c[acctCol]},${c[amtCol]},DEMOUTR${String(9000 + i)},Success`;
    }),
  );
  const statusFile = path.join(os.tmpdir(), `status-${Date.now()}.csv`);
  writeFileSync(statusFile, status.join("\n"));
  await page.getByTestId("status-file").setInputFiles(statusFile);
  await page.getByTestId("apply-status").click();

  await expect(page.getByTestId("run-complete")).toBeVisible({ timeout: 60_000 });
  for (const row of await page.getByTestId("payment-row").all()) await expect(row).toHaveAttribute("data-status", "paid");
  await expect(page.getByTestId("export-paid")).toBeVisible();
});
