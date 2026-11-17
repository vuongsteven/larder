// Barcode lookup against Open Food Facts, cached in SQLite. Only the barcode
// leaves this server; nothing about the household is sent.
import { categoryFromTags } from "../shared/categorize.ts";
import type { BarcodeLookup } from "../shared/schema.ts";
import type { DB } from "./db.ts";

const FOUND_TTL_MS = 90 * 86_400_000;
const MISS_TTL_MS = 7 * 86_400_000;

interface OffResponse {
  status?: number;
  product?: {
    product_name?: string;
    generic_name?: string;
    brands?: string;
    quantity?: string;
    categories_tags?: string[];
  };
}

export async function lookupBarcode(
  db: DB,
  barcode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BarcodeLookup | null> {
  const cached = db.prepare("SELECT data, fetched_at FROM barcode_cache WHERE barcode = ?").get(barcode) as
    | { data: string; fetched_at: number }
    | undefined;
  if (cached) {
    const value = JSON.parse(cached.data) as BarcodeLookup;
    const ttl = value.found ? FOUND_TTL_MS : MISS_TTL_MS;
    if (Date.now() - cached.fetched_at < ttl) return value;
  }

  let result: BarcodeLookup;
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,generic_name,brands,quantity,categories_tags`;
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "Larder/1.0 (self-hosted pantry app)" },
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 404) {
      result = { barcode, found: false };
    } else if (!res.ok) {
      return null; // upstream trouble: don't cache, let the client fall back to manual entry
    } else {
      const body = (await res.json()) as OffResponse;
      const p = body.product;
      const name = (p?.product_name || p?.generic_name || "").trim();
      if (body.status !== 1 || !p || !name) {
        result = { barcode, found: false };
      } else {
        const brand = p.brands?.split(",")[0]?.trim() || undefined;
        result = {
          barcode,
          found: true,
          name: name.slice(0, 120),
          brand,
          category: categoryFromTags(p.categories_tags ?? []),
          quantityText: p.quantity?.slice(0, 40) || undefined,
        };
      }
    }
  } catch {
    return cached ? (JSON.parse(cached.data) as BarcodeLookup) : null;
  }

  db.prepare(
    "INSERT INTO barcode_cache (barcode, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(barcode) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at",
  ).run(barcode, JSON.stringify(result), Date.now());
  return result;
}
