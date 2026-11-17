import { expect, type Page } from "@playwright/test";

// Each run of each project uses its own names, since all tests share one household.
export const tag = () => Math.random().toString(36).slice(2, 7);

export async function addItem(page: Page, name: string, opts: { place?: string; expiry?: string; expiresOn?: string; staple?: boolean; qty?: string; navigate?: boolean } = {}) {
  if (opts.navigate !== false) await page.goto("/stock");
  await page.getByRole("button", { name: "Add item" }).click();
  const dialog = page.getByRole("dialog", { name: "Add item" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  if (opts.qty) await dialog.getByRole("textbox", { name: "Quantity" }).fill(opts.qty);
  if (opts.place) await dialog.getByRole("group", { name: "Kept in" }).getByRole("button", { name: opts.place }).click();
  if (opts.expiry) await dialog.getByRole("group", { name: "Expires" }).getByRole("button", { name: opts.expiry, exact: true }).click();
  if (opts.expiresOn) await dialog.getByLabel("Expiry date").fill(opts.expiresOn);
  if (opts.staple) await dialog.getByRole("switch", { name: "Always keep in stock" }).click();
  await dialog.getByRole("button", { name: "Add to stock" }).click();
  await expect(dialog).toBeHidden();
}

export async function waitSynced(page: Page) {
  // The header badge is only shown while changes are waiting.
  await expect(page.locator("header").getByRole("button", { name: /^\d+$|waiting/ })).toHaveCount(0, { timeout: 10_000 });
}
