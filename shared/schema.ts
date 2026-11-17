// Entity and sync-protocol schemas shared by the server and the web client.
// The server validates every merged record against these; the client validates
// before writing locally, so a write that passes here is accepted by the server.
import { z } from "zod";

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const name = z.string().trim().min(1, "Required").max(120);
const id = z.string().min(1).max(64);

export const LOCATION_KINDS = ["pantry", "fridge", "freezer", "other"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const CATEGORIES = [
  "Produce",
  "Dairy & Eggs",
  "Meat & Fish",
  "Bakery",
  "Frozen",
  "Pantry",
  "Snacks",
  "Drinks",
  "Condiments",
  "Household",
  "Other",
] as const;

export const UNITS = ["", "g", "kg", "ml", "l", "pack", "can", "jar", "bottle", "box", "bag", "loaf", "dozen"] as const;

export const locationSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(LOCATION_KINDS).default("other"),
  sort: z.number().int().default(0),
});

export const itemSchema = z.object({
  name,
  locationId: id,
  quantity: z.number().min(0).max(1_000_000).default(1),
  unit: z.string().max(20).default(""),
  category: z.string().max(40).default("Other"),
  expiresOn: isoDate.nullable().default(null),
  openedOn: isoDate.nullable().default(null),
  addedOn: isoDate,
  // When set, the item is a tracked staple: dropping to or below this adds it to the shopping list.
  minQuantity: z.number().min(0).max(1_000_000).nullable().default(null),
  barcode: z.string().max(32).nullable().default(null),
  notes: z.string().max(2000).default(""),
});

export const grocerySchema = z.object({
  name,
  quantity: z.number().min(0).max(1_000_000).nullable().default(null),
  unit: z.string().max(20).default(""),
  category: z.string().max(40).default("Other"),
  checked: z.boolean().default(false),
  note: z.string().max(500).default(""),
  addedOn: isoDate,
});

export const taskSchema = z.object({
  title: name,
  notes: z.string().max(2000).default(""),
  dueOn: isoDate.nullable().default(null),
  // Repeating tasks roll their due date forward instead of being completed.
  repeatDays: z.number().int().min(1).max(366).nullable().default(null),
  doneAt: z.number().int().nullable().default(null),
  lastDoneAt: z.number().int().nullable().default(null),
});

// Catalog the household builds up as it adds things: drives autocomplete,
// barcode matching and sensible defaults (category, unit, where it lives, shelf life).
export const productSchema = z.object({
  name,
  nameKey: z.string().min(1).max(120),
  barcode: z.string().max(32).nullable().default(null),
  category: z.string().max(40).default("Other"),
  unit: z.string().max(20).default(""),
  locationId: id.nullable().default(null),
  shelfLifeDays: z.number().int().min(0).max(3650).nullable().default(null),
});

export const ENTITY_SCHEMAS = {
  locations: locationSchema,
  items: itemSchema,
  grocery: grocerySchema,
  tasks: taskSchema,
  products: productSchema,
} as const;

export type TableName = keyof typeof ENTITY_SCHEMAS;
export const TABLES = Object.keys(ENTITY_SCHEMAS) as TableName[];

export type Location = z.output<typeof locationSchema>;
export type Item = z.output<typeof itemSchema>;
export type Grocery = z.output<typeof grocerySchema>;
export type Task = z.output<typeof taskSchema>;
export type Product = z.output<typeof productSchema>;

export interface EntityMap {
  locations: Location;
  items: Item;
  grocery: Grocery;
  tasks: Task;
  products: Product;
}

/** Server bookkeeping attached to every synced row. */
export interface RowMeta {
  id: string;
  _v: number; // server version (change sequence)
  _at: number; // server time of last change, ms
  _by: string | null; // user id of last writer
}

export type Row<T extends TableName = TableName> = EntityMap[T] & RowMeta;

// ---- Sync protocol -------------------------------------------------------

export const opSchema = z.object({
  opId: z.string().min(8).max(64),
  table: z.enum(TABLES as [TableName, ...TableName[]]),
  id,
  // Field-level patch: merged onto the stored record, so concurrent edits to
  // different fields of the same record both survive.
  patch: z.record(z.string(), z.unknown()).optional(),
  delete: z.boolean().optional(),
});
export type Op = z.infer<typeof opSchema>;

export const syncRequestSchema = z.object({
  clientId: z.string().min(8).max(64),
  cursor: z.number().int().min(0),
  ops: z.array(opSchema).max(500),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export interface SyncResponse {
  cursor: number;
  /** True when the client must drop its local copy and take `changes` as the full state. */
  reset: boolean;
  /** True when more changes are waiting: call again with the returned cursor. */
  more: boolean;
  applied: string[];
  rejected: { opId: string; reason: string }[];
  changes: { table: TableName; row: Record<string, unknown> & RowMeta; deleted: boolean }[];
}

// ---- Auth / API payloads ------------------------------------------------

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,32}$/, "2–32 letters, numbers, dot, dash or underscore");
export const passwordSchema = z.string().min(8, "At least 8 characters").max(200);
export const displayNameSchema = z.string().trim().min(1).max(60);

export const setupSchema = z.object({
  username: usernameSchema,
  name: displayNameSchema,
  password: passwordSchema,
});
export const loginSchema = z.object({ username: z.string().trim().toLowerCase().min(1).max(32), password: z.string().min(1).max(200) });
export const createUserSchema = setupSchema;
export const changePasswordSchema = z.object({ current: z.string().min(1).max(200), next: passwordSchema });

export interface PublicUser {
  id: string;
  username: string;
  name: string;
  role: "owner" | "member";
}

export interface AuthStatus {
  setupRequired: boolean;
  user: PublicUser | null;
}

export interface BarcodeLookup {
  barcode: string;
  found: boolean;
  name?: string;
  brand?: string;
  category?: string;
  quantityText?: string;
}

/** Normalise a product name for matching ("Whole Milk " → "whole milk"). */
export function nameKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
