import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addGroceryFromText,
  addItem,
  adjustQuantity,
  completeTask,
  putAway,
  useUp,
} from "../../web/lib/actions.ts";
import { db } from "../../web/lib/db.ts";
import { clearLocalData, save } from "../../web/lib/store.ts";
import { addDays, today } from "../../web/lib/util.ts";

let pantry: string;
let fridge: string;

beforeEach(async () => {
  await clearLocalData();
  pantry = await save("locations", null, { name: "Pantry", kind: "pantry", sort: 0 });
  fridge = await save("locations", null, { name: "Fridge", kind: "fridge", sort: 1 });
});

const base = { unit: "", category: "Dairy & Eggs", expiresOn: null, minQuantity: null, barcode: null, notes: "" };

describe("local writes", () => {
  it("queue one op per change and skip no-op edits", async () => {
    const id = await addItem({ ...base, name: "Milk", locationId: fridge, quantity: 2 });
    const before = await db.outbox.count();
    await save("items", id, { quantity: 2 });
    expect(await db.outbox.count()).toBe(before);
    await save("items", id, { quantity: 3 });
    const last = (await db.outbox.orderBy("seq").last())!.op;
    expect(last).toMatchObject({ table: "items", id, patch: { quantity: 3 } });
  });

  it("reject invalid data before it reaches the outbox", async () => {
    await expect(save("items", null, { name: "", locationId: fridge, addedOn: today() })).rejects.toThrow();
    expect(await db.items.count()).toBe(0);
  });

  it("learn products so the next add is pre-filled", async () => {
    await addItem({ ...base, name: "Greek yoghurt", locationId: fridge, quantity: 1, expiresOn: addDays(today(), 10) });
    const p = await db.products.where("nameKey").equals("greek yoghurt").first();
    expect(p).toMatchObject({ category: "Dairy & Eggs", locationId: fridge, shelfLifeDays: 10 });
  });
});

describe("quantities and staples", () => {
  it("adds a staple to the list when it drops to its minimum, once", async () => {
    const id = await addItem({ ...base, name: "Milk", locationId: fridge, quantity: 3, minQuantity: 1 });
    let item = (await db.items.get(id))!;
    expect((await adjustQuantity(item, -1)).addedToList).toBe(false);
    item = (await db.items.get(id))!;
    expect((await adjustQuantity(item, -1)).addedToList).toBe(true);
    expect((await db.grocery.toArray()).map((g) => g.name)).toEqual(["Milk"]);
    // Using up the last one doesn't add a duplicate.
    item = (await db.items.get(id))!;
    const r = await useUp(item);
    expect(r).toMatchObject({ usedUp: true, addedToList: false });
    expect(await db.items.get(id)).toBeUndefined();
    expect(await db.grocery.count()).toBe(1);
  });

  it("uses fresh state when taps arrive faster than renders", async () => {
    const id = await addItem({ ...base, name: "Eggs", locationId: fridge, quantity: 6 });
    const stale = (await db.items.get(id))!;
    await Promise.all([adjustQuantity(stale, -1), adjustQuantity(stale, -1), adjustQuantity(stale, -1)]);
    expect((await db.items.get(id))!.quantity).toBe(3);
  });
});

describe("shopping list", () => {
  it("parses quantities, guesses the aisle and merges duplicates", async () => {
    await addGroceryFromText("2 bananas");
    await addGroceryFromText("3 bananas");
    expect(await addGroceryFromText("bananas")).toMatchObject({ added: false });
    const [g] = await db.grocery.toArray();
    expect(g).toMatchObject({ name: "bananas", quantity: 5, category: "Produce" });
  });

  it("puts bought things away, topping up undated stock and adding dated items separately", async () => {
    const rice = await addItem({ ...base, category: "Pantry", name: "Rice", locationId: pantry, quantity: 1, unit: "bag" });
    await addGroceryFromText("rice");
    await addGroceryFromText("2 yoghurt");
    const list = await db.grocery.toArray();
    for (const g of list) await save("grocery", g.id, { checked: true });
    const checked = await db.grocery.toArray();
    await putAway(
      checked.map((g) => ({
        grocery: g,
        locationId: g.name === "Rice" ? pantry : fridge,
        expiresOn: g.name === "yoghurt" ? addDays(today(), 5) : null,
      })),
    );
    expect(await db.grocery.count()).toBe(0);
    expect((await db.items.get(rice))!.quantity).toBe(2);
    const yog = (await db.items.toArray()).find((i) => i.name === "yoghurt")!;
    expect(yog).toMatchObject({ locationId: fridge, quantity: 2, expiresOn: addDays(today(), 5) });
  });
});

describe("tasks", () => {
  it("rolls repeating tasks forward instead of completing them", async () => {
    const id = await save("tasks", null, { title: "Clean fridge", dueOn: addDays(today(), -3), repeatDays: 7 });
    await completeTask((await db.tasks.get(id))!);
    const t = (await db.tasks.get(id))!;
    expect(t.doneAt).toBeNull();
    expect(t.dueOn).toBe(addDays(today(), 7));
    expect(t.lastDoneAt).toEqual(expect.any(Number));
  });
});
