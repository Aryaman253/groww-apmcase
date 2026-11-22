import { expect, test } from "@playwright/test";
import { confirmRun, hold, openDraftToReview, paymentIds, simulatedWebhook, startDemo } from "./helpers";

test("Direct pay (test mode): pay, webhooks mark Paid / return failed bills to Due, double tap pays once", async ({ page, context }) => {
  await startDemo(page);
  await openDraftToReview(page);
  // Simulated test rail is the demo's payout provider; Direct pay is the default method.
  await confirmRun(page);
  const url = page.url();
  await expect(page.getByTestId("test-mode-badge").first()).toBeVisible();

  // Double tap: two tabs confirm the same payouts at the same time.
  const page2 = await context.newPage();
  await page2.goto(url);
  await page.getByTestId("direct-pay-btn").click();
  await page2.getByTestId("direct-pay-btn").click();
  await Promise.all([hold(page, "direct-pay-confirm"), hold(page2, "direct-pay-confirm")]);
  // Wait until every payout has been created (no payment left "pending").
  await expect
    .poll(async () => { await page.reload(); return (await paymentIds(page)).filter((p) => p.status === "pending").length; }, { timeout: 90_000, intervals: [3000] })
    .toBe(0);
  const pays = await paymentIds(page);
  expect(pays.length).toBeGreaterThanOrEqual(2);
  for (const p of pays) expect(["processing", "paid"]).toContain(p.status);

  // One payout per payment, even with two taps.
  await page2.goto("/more/activity");
  await expect(page2.getByTestId("activity-list").getByText("Payout sent (test mode)")).toHaveCount(pays.length);
  await page2.close();

  // Webhooks: first succeeds, second fails.
  const [ok, bad] = pays;
  await simulatedWebhook(page, { id: `evt-${ok.id}`, reference_id: ok.id, status: "processed", utr: "SIMUTRE2E0001" });
  await simulatedWebhook(page, { id: `evt-${bad.id}`, reference_id: bad.id, status: "failed", reason: "Beneficiary bank declined" });
  // Redelivery is a no-op.
  const again = await simulatedWebhook(page, { id: `evt-${ok.id}`, reference_id: ok.id, status: "processed", utr: "SIMUTRE2E0001" });
  expect(again.duplicate).toBe(true);
  // A bad signature is rejected.
  const forged = await page.request.post("/api/webhooks/simulated", { data: JSON.stringify({ reference_id: bad.id, status: "processed" }), headers: { "content-type": "application/json", "x-simulated-signature": "00" } });
  expect(forged.status()).toBe(401);

  await page.reload();
  await expect(page.locator(`[data-payment-id="${ok.id}"]`)).toHaveAttribute("data-status", "paid");
  await expect(page.locator(`[data-payment-id="${ok.id}"]`)).toContainText("SIMUTRE2E0001");
  await expect(page.locator(`[data-payment-id="${bad.id}"]`)).toHaveAttribute("data-status", "failed");
  await expect(page.locator(`[data-payment-id="${bad.id}"]`)).toContainText("Beneficiary bank declined");

  // The failed vendor's bills are back in Due.
  await page.goto("/bills?tab=due");
  await page.getByTestId("bills-tab-overdue").click();
  const overdue = await page.getByTestId("bill-list").innerText().catch(() => "");
  await page.getByTestId("bills-tab-due").click();
  const due = await page.getByTestId("bill-list").innerText().catch(() => "");
  expect(overdue + due).toContain(bad.vendor);
});
