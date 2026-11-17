// Household operations built on save/remove. Each runs in one local
// transaction, so a multi-step action is never half-applied.
import { defaultLocationKind, guessCategory, parseQuickAdd } from "../../shared/categorize.ts";
import { nameKey, type Grocery, type Item, type Row } from "../../shared/schema.ts";
import { db } from "./db.ts";
import { fields, remove, save, transact } from "./store.ts";
import { addDays, today } from "./util.ts";

// ---- Catalog ---------------------------------------------------------------

export async function findProduct(name: string) {
  const key = nameKey(name);
  return key ? db.products.where("nameKey").equals(key).first() : undefined;
}

export async function findProductByBarcode(barcode: string) {
  return db.products.where("barcode").equals(barcode).first();
}

/** Remember how the household stores something, for next time. */
export async function learnProduct(p: {
  name: string;
  category?: string;
  unit?: string;
  locationId?: string | null;
  barcode?: string | null;
  shelfLifeDays?: number | null;
}) {
  const key = nameKey(p.name);
  if (!key) return;
  const existing = (p.barcode ? await findProductByBarcode(p.barcode) : undefined) ?? (await findProduct(p.name));
  const patch: Record<string, unknown> = { name: p.name.trim(), nameKey: key };
  if (p.category) patch.category = p.category;
  if (p.unit !== undefined) patch.unit = p.unit;
  if (p.locationId) patch.locationId = p.locationId;
  if (p.barcode) patch.barcode = p.barcode;
  if (p.shelfLifeDays != null) patch.shelfLifeDays = p.shelfLifeDays;
  await save("products", existing?.id ?? null, patch);
}

export async function locationForCategory(category: string): Promise<string | null> {
  const kind = defaultLocationKind(category);
  const locs = await db.locations.toArray();
  return (locs.find((l) => l.kind === kind) ?? locs.sort((a, b) => a.sort - b.sort)[0])?.id ?? null;
}

// ---- Inventory -------------------------------------------------------------

export interface ItemInput {
  name: string;
  locationId: string;
  quantity: number;
  unit: string;
  category: string;
  expiresOn: string | null;
  minQuantity: number | null;
  barcode: string | null;
  notes: string;
}

export function addItem(input: ItemInput): Promise<string> {
  return transact(async () => {
    const id = await save("items", null, { ...input, addedOn: today() });
    await learnProduct({
      name: input.name,
      category: input.category,
      unit: input.unit,
      locationId: input.locationId,
      barcode: input.barcode,
      shelfLifeDays: input.expiresOn ? Math.max(0, Math.round((Date.parse(input.expiresOn) - Date.parse(today())) / 86_400_000)) : undefined,
    });
    return id;
  });
}

export function updateItem(id: string, patch: Partial<Item>) {
  return transact(async () => {
    await save("items", id, patch);
    const item = await db.items.get(id);
    if (item) await learnProduct({ name: item.name, category: item.category, unit: item.unit, locationId: item.locationId, barcode: item.barcode });
  });
}

export interface QtyResult {
  usedUp: boolean;
  addedToList: boolean;
  snapshot: Row<"items">;
}

/** Change quantity. At zero the item is removed; tracked staples go on the shopping list. */
export function adjustQuantity(stale: Row<"items">, delta: number): Promise<QtyResult> {
  return transact(async () => {
    // Re-read: rapid taps can arrive before the UI has re-rendered with the last change.
    const item = (await db.items.get(stale.id)) ?? stale;
    const before = item.quantity;
    const next = delta === -Infinity ? 0 : Math.max(0, Math.round((before + delta) * 1000) / 1000);
    let addedToList = false;
    const crossedMin = item.minQuantity != null && next <= item.minQuantity && before > item.minQuantity;
    if (next === 0) {
      await remove("items", item.id);
      if (item.minQuantity != null) addedToList = await ensureOnList(item);
    } else {
      await save("items", item.id, { quantity: next });
      if (crossedMin) addedToList = await ensureOnList(item);
    }
    return { usedUp: next === 0, addedToList, snapshot: item };
  });
}

export function useUp(item: Row<"items">) {
  return adjustQuantity(item, -Infinity);
}

/** Put a removed item back (undo). It gets a new id: the server treats deletes as final. */
export function restoreItem(snapshot: Row<"items">) {
  return save("items", null, fields(snapshot));
}

export function deleteItem(id: string) {
  return remove("items", id);
}

// ---- Shopping list -----------------------------------------------------------

/** Add to the shopping list unless an unticked entry with the same name is already there. */
export async function ensureOnList(src: { name: string; category: string; unit?: string }): Promise<boolean> {
  const key = nameKey(src.name);
  const exists = (await db.grocery.toArray()).some((g) => !g.checked && nameKey(g.name) === key);
  if (exists) return false;
  await save("grocery", null, { name: src.name.trim(), category: src.category, unit: "", quantity: null, addedOn: today() });
  return true;
}

export async function addGroceryFromText(text: string): Promise<{ added: boolean; name: string }> {
  const parsed = parseQuickAdd(text);
  if (!parsed.name) return { added: false, name: "" };
  const product = await findProduct(parsed.name);
  const name = product?.name ?? parsed.name;
  const key = nameKey(name);
  return transact(async () => {
    const existing = (await db.grocery.toArray()).find((g) => !g.checked && nameKey(g.name) === key);
    if (existing) {
      if (parsed.quantity != null) {
        await save("grocery", existing.id, { quantity: (existing.quantity ?? 0) + parsed.quantity, unit: parsed.unit || existing.unit });
        return { added: true, name };
      }
      return { added: false, name };
    }
    await save("grocery", null, {
      name,
      quantity: parsed.quantity,
      unit: parsed.unit || (parsed.quantity != null ? product?.unit ?? "" : ""),
      category: product?.category ?? guessCategory(name),
      addedOn: today(),
    });
    return { added: true, name };
  });
}

export function toggleGrocery(g: Row<"grocery">) {
  return save("grocery", g.id, { checked: !g.checked });
}

export function updateGrocery(id: string, patch: Partial<Grocery>) {
  return save("grocery", id, patch);
}

export function deleteGrocery(id: string) {
  return remove("grocery", id);
}

export function clearChecked() {
  return transact(async () => {
    const checked = (await db.grocery.toArray()).filter((g) => g.checked);
    for (const g of checked) await remove("grocery", g.id);
    return checked.length;
  });
}

export interface PutAwayEntry {
  grocery: Row<"grocery">;
  locationId: string;
  expiresOn: string | null;
}

/**
 * Move bought items into stock. Tops up an existing undated item in the same
 * place and unit; otherwise adds a new item. Ticked list entries are removed.
 */
export function putAway(entries: PutAwayEntry[]) {
  return transact(async () => {
    const stock = await db.items.toArray();
    for (const { grocery: g, locationId, expiresOn } of entries) {
      const product = await findProduct(g.name);
      const qty = g.quantity ?? 1;
      const unit = g.unit || (g.quantity == null ? product?.unit ?? "" : "");
      const match = !expiresOn
        ? stock.find((i) => nameKey(i.name) === nameKey(g.name) && i.locationId === locationId && i.unit === unit && !i.expiresOn)
        : undefined;
      if (match) {
        await save("items", match.id, { quantity: match.quantity + qty });
        match.quantity += qty;
      } else {
        await save("items", null, {
          name: g.name,
          locationId,
          quantity: qty,
          unit,
          category: g.category,
          expiresOn,
          addedOn: today(),
          minQuantity: stock.find((i) => nameKey(i.name) === nameKey(g.name))?.minQuantity ?? null,
          barcode: product?.barcode ?? null,
        });
      }
      await learnProduct({ name: g.name, category: g.category, locationId });
      await remove("grocery", g.id);
    }
  });
}

/** Suggested expiry for a product being put away, from what the household learnt before. */
export function suggestedExpiry(shelfLifeDays: number | null | undefined): string | null {
  return shelfLifeDays != null && shelfLifeDays > 0 ? addDays(today(), shelfLifeDays) : null;
}

// ---- Tasks -------------------------------------------------------------------

export function completeTask(t: Row<"tasks">) {
  if (t.repeatDays) {
    // Repeating chores roll forward from today rather than from the old due date.
    return save("tasks", t.id, { dueOn: addDays(today(), t.repeatDays), lastDoneAt: Date.now() });
  }
  return save("tasks", t.id, { doneAt: Date.now(), lastDoneAt: Date.now() });
}

export function reopenTask(t: Row<"tasks">) {
  return save("tasks", t.id, { doneAt: null });
}

// ---- Locations ---------------------------------------------------------------

export async function deleteLocation(id: string, moveTo: string | null) {
  return transact(async () => {
    const items = await db.items.where("locationId").equals(id).toArray();
    for (const i of items) {
      if (moveTo) await save("items", i.id, { locationId: moveTo });
      else await remove("items", i.id);
    }
    await remove("locations", id);
  });
}
