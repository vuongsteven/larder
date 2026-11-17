// The local copy of the household's data. The UI only ever reads from here,
// so every screen works offline and updates instantly.
import Dexie, { type Table } from "dexie";
import type { Op, Row, TableName } from "../../shared/schema.ts";

export interface OutboxEntry {
  seq?: number;
  op: Op;
  createdAt: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export class LarderDB extends Dexie {
  declare locations: Table<Row<"locations">, string>;
  declare items: Table<Row<"items">, string>;
  declare grocery: Table<Row<"grocery">, string>;
  declare tasks: Table<Row<"tasks">, string>;
  declare products: Table<Row<"products">, string>;
  declare outbox: Table<OutboxEntry, number>;
  declare meta: Table<MetaEntry, string>;

  constructor(name = "larder") {
    super(name);
    this.version(1).stores({
      locations: "id",
      items: "id, locationId, barcode",
      grocery: "id",
      tasks: "id",
      products: "id, nameKey, barcode",
      outbox: "++seq",
      meta: "key",
    });
  }

  entity<T extends TableName>(name: T): Table<Row<T>, string> {
    return this.table(name) as Table<Row<T>, string>;
  }

  get entityTables() {
    return [this.locations, this.items, this.grocery, this.tasks, this.products];
  }
}

export const db = new LarderDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}
