import { expect, test } from "@playwright/test";
import en from "../../src/messages/en.json";
import hi from "../../src/messages/hi.json";
import { startDemo } from "./helpers";

function flatten(t: unknown, out: string[] = []): string[] {
  if (typeof t === "string") out.push(t);
  else if (Array.isArray(t)) t.forEach((v) => flatten(v, out));
  else if (t && typeof t === "object") Object.values(t).forEach((v) => flatten(v, out));
  return out;
}
const hiSet = new Set(flatten(hi));
// UI strings that must not appear in English once Hindi is on (no placeholders, real words).
const english = flatten(en).filter((s) => !s.includes("{") && /[a-z]{3,}/.test(s) && s.split(" ").length >= 2 && !hiSet.has(s));

test("switching to Hindi leaves no untranslated English UI strings in the main flows", async ({ page }) => {
  await startDemo(page);
  await page.goto("/more/settings");
  await page.getByTestId("language-switcher").first().click();
  await page.getByTestId("lang-hi").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  for (const path of ["/home", "/vendors", "/bills", "/pay", "/more"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const text = await page.locator("body").innerText();
    const leaked = english.filter((s) => text.includes(s));
    expect(leaked, `English strings on ${path}`).toEqual([]);
  }
  // Payment wizard
  await page.goto("/home");
  await page.getByTestId("start-run").click();
  await page.getByTestId("step-select").waitFor();
  await page.getByTestId("to-review").click();
  const text = await page.locator("body").innerText();
  expect(english.filter((s) => text.includes(s))).toEqual([]);
});
