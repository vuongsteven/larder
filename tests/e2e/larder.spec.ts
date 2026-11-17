import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { addItem, tag, waitSynced } from "./helpers.ts";

test("adds an item and shows it in stock and on the home screen", async ({ page }) => {
  const name = `Cheddar ${tag()}`;
  await addItem(page, name, { place: "Fridge", expiry: "3 days" });
  await expect(page.getByRole("group", { name })).toBeVisible();
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("group", { name })).toBeVisible();
});

test("keeps working offline and syncs when the connection returns", async ({ page, context, browser }) => {
  await page.goto("/stock");
  // First sync done: the household's storage places have arrived.
  await expect(page.getByRole("button", { name: /^Pantry/ })).toBeVisible();
  await waitSynced(page);
  await context.setOffline(true);
  const name = `Offline beans ${tag()}`;
  await addItem(page, name, { place: "Pantry", navigate: false });
  await expect(page.getByRole("group", { name })).toBeVisible();
  await expect(page.locator("header").getByText(/waiting/)).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitSynced(page);

  // A different device (fresh storage, same account) receives it.
  const other = await browser.newContext({ storageState: "tests/e2e/.auth.json" });
  const page2 = await other.newPage();
  await page2.goto("/stock");
  await expect(page2.getByRole("group", { name })).toBeVisible();
  await other.close();
});

test("shows another device's changes live, without a reload", async ({ page, browser }) => {
  await page.goto("/list");
  const other = await browser.newContext({ storageState: "tests/e2e/.auth.json" });
  const page2 = await other.newPage();
  await page2.goto("/list");
  await expect(page2.getByRole("textbox", { name: "Add to shopping list" })).toBeVisible();
  await page.waitForTimeout(500); // let both event streams connect

  const name = `Lemons ${tag()}`;
  await page2.getByRole("textbox", { name: "Add to shopping list" }).fill(`3 ${name}`);
  await page2.keyboard.press("Enter");
  await expect(page.getByRole("checkbox", { name: new RegExp(name) })).toBeVisible({ timeout: 8_000 });
  await other.close();
});

test("a staple that runs out goes on the list, and putting it away restocks it", async ({ page }) => {
  const name = `Oat milk ${tag()}`;
  await addItem(page, name, { place: "Fridge", staple: true, qty: "2" });
  await expect(page.getByRole("group", { name })).toBeVisible();
  await page.getByRole("button", { name: `Use some ${name}` }).click();
  await expect(page.getByText(/running low · added to list/)).toBeVisible();

  await page.getByRole("link", { name: "List" }).click();
  const entry = page.getByRole("checkbox", { name: new RegExp(name) });
  await entry.click();
  await expect(entry).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: /Put away/ }).click();
  const sheet = page.getByRole("dialog", { name: "Put away" });
  await expect(sheet.getByText(name)).toBeVisible();
  await sheet.getByRole("button", { name: /to stock/ }).click();
  await expect(page.getByRole("checkbox", { name: new RegExp(name) })).toHaveCount(0);

  await page.getByRole("link", { name: "Stock" }).click();
  // 1 left + 1 bought = topped back up to 2 in the fridge.
  await expect(page.getByRole("group", { name }).getByText("2", { exact: true })).toBeVisible();
});

test("repeating tasks roll forward when ticked", async ({ page }) => {
  const title = `Wipe shelves ${tag()}`;
  await page.goto("/tasks");
  await page.getByPlaceholder(/Add a task/).fill(title);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: title }).click();
  const sheet = page.getByRole("dialog", { name: "Edit task" });
  await sheet.getByRole("button", { name: "Today", exact: true }).click();
  await sheet.getByRole("combobox", { name: "Repeat" }).selectOption({ label: "Every week" });
  await sheet.getByRole("button", { name: "Save" }).click();
  await page.getByRole("checkbox", { name: `Complete ${title}` }).click();
  await expect(page.getByText(/next due/i)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Complete ${title}` })).toHaveAttribute("aria-checked", "false");
});

test("opens offline from the service worker cache", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Playwright's WebKit doesn't run service workers");
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
  await expect(page.getByRole("link", { name: "Stock" })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("link", { name: "Stock" })).toBeVisible();
  await page.getByRole("link", { name: "Stock" }).click();
  await expect(page.getByRole("heading", { name: "Stock" })).toBeVisible();
  await context.setOffline(false);
});

test("scans a barcode with the WebAssembly decoder, then recognises it next time", async ({ page, browserName }) => {
  // Linux WebKit can't play a canvas capture stream in a <video>, so the fake camera
  // never yields a frame there. The decoder itself is the same WASM build in both.
  test.skip(browserName === "webkit", "fake camera stream unsupported in Playwright WebKit on Linux");
  const png = readFileSync(new URL("./ean13.png", import.meta.url)).toString("base64");
  await page.addInitScript((b64) => {
    // Take the path an iPhone takes: no native BarcodeDetector.
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    // A fake rear camera that films a printed barcode.
    navigator.mediaDevices.getUserMedia = async () => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d")!;
      const draw = () => {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, (canvas.width - img.width) / 2, (canvas.height - img.height) / 2);
      };
      draw();
      setInterval(draw, 100);
      return canvas.captureStream(10);
    };
  }, png);

  const name = `Scanned crisps ${tag()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Scan" }).click();
  const dialog = page.getByRole("dialog", { name: "Add item" });
  await expect(dialog.getByText(/Barcode 5000112637922/)).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  await dialog.getByRole("button", { name: "Add to stock" }).click();
  await expect(dialog).toBeHidden();

  // Same barcode again: it's in stock now, so the item opens.
  await page.getByRole("button", { name: "Scan" }).click();
  await expect(page.getByRole("dialog", { name })).toBeVisible({ timeout: 15_000 });
});
