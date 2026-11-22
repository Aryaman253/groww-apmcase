import { expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

/** Starts a fresh, isolated demo workspace (anonymous session) and lands on Home. */
export async function startDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Try the demo|डेमो/ }).click();
  await page.waitForURL(/\/home/, { timeout: 120_000, waitUntil: "commit" });
  await page.getByTestId("home-hero").waitFor();
  const skip = page.getByTestId("tour").getByRole("button").first();
  await page.waitForTimeout(600);
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

/** Press-and-hold confirmation (money steps). */
export async function hold(page: Page, testId: string) {
  const btn = page.getByTestId(testId);
  await btn.waitFor();
  await page.waitForTimeout(700); // let the bottom sheet settle
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1600);
  await page.mouse.up();
}

/** Opens the draft run from Home and goes to the review step. */
export async function openDraftToReview(page: Page) {
  await page.getByTestId("start-run").click();
  await page.waitForURL(/\/pay\/[0-9a-f-]{36}/);
  await page.getByTestId("step-select").waitFor();
  await page.getByTestId("to-review").click();
  await page.getByTestId("step-review").waitFor();
}

export async function chooseMethodForAll(page: Page, method: "Direct pay" | "Bank file" | "UPI") {
  for (const row of await page.getByTestId("review-row").all()) {
    const radio = row.getByRole("radio", { name: method });
    if ((await radio.count()) && (await radio.isEnabled())) await radio.click();
  }
}

export async function confirmRun(page: Page) {
  await page.getByTestId("to-confirm").click();
  await page.getByTestId("step-confirm").waitFor();
  await page.getByTestId("open-confirm").click();
  await hold(page, "hold-confirm");
  await page.getByTestId("run-view").waitFor({ timeout: 60_000 });
}

/** Sends a signed webhook for the simulated test rail. */
export async function simulatedWebhook(page: Page, body: Record<string, unknown>) {
  const secret = process.env.SIMULATED_RAIL_SECRET;
  if (!secret) throw new Error("SIMULATED_RAIL_SECRET must be set for webhook tests");
  const raw = JSON.stringify(body);
  const sig = createHmac("sha256", secret).update(raw).digest("hex");
  const res = await page.request.post("/api/webhooks/simulated", { data: raw, headers: { "content-type": "application/json", "x-simulated-signature": sig } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

export async function paymentIds(page: Page): Promise<{ id: string; vendor: string; status: string }[]> {
  return page.getByTestId("payment-row").evaluateAll((els) =>
    els.map((e) => ({ id: (e as HTMLElement).dataset.paymentId ?? "", vendor: (e as HTMLElement).dataset.vendor ?? "", status: (e as HTMLElement).dataset.status ?? "" })),
  );
}
