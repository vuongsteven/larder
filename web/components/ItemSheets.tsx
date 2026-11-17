import { ArrowRightLeft, Barcode, Minus, PackageOpen, Pencil, Plus, ScanLine, ShoppingBasket, Trash2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { guessCategory } from "../../shared/categorize.ts";
import { CATEGORIES, nameKey, UNITS, type BarcodeLookup, type Row } from "../../shared/schema.ts";
import {
  addItem,
  adjustQuantity,
  deleteItem,
  ensureOnList,
  findProductByBarcode,
  locationForCategory,
  restoreItem,
  suggestedExpiry,
  updateItem,
  useUp,
  type ItemInput,
} from "../lib/actions.ts";
import { api } from "../lib/api.ts";
import { db } from "../lib/db.ts";
import { useItem, useLocations, useProducts, useUsers } from "../lib/hooks.ts";
import { closeSheet, openItem, openItemEditor, toast, useSheet } from "../lib/ui-store.ts";
import { addDays, cx, expiryLevel, formatQty, parseISODate, qtyStep, relativeDay, relativeTime, today } from "../lib/util.ts";
import { ExpiryBadge, reportQty } from "./ItemRow.tsx";
import { Sheet } from "./Sheet.tsx";
import { Button, Chip, Field, Input, Select, Spinner, Textarea, Toggle } from "./ui.tsx";

const Scanner = lazy(() => import("./Scanner.tsx"));

const longDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** Mounted once in the app shell; renders whichever item sheet is open. */
export function ItemSheets() {
  const sheet = useSheet();
  const onDetected = useCallback(async (code: string) => {
    closeSheet();
    const inStock = await db.items.where("barcode").equals(code).first();
    if (inStock) return openItem(inStock.id);
    const product = await findProductByBarcode(code);
    if (product) {
      return openItemEditor(null, {
        name: product.name,
        category: product.category,
        unit: product.unit,
        locationId: product.locationId ?? undefined,
        expiresOn: suggestedExpiry(product.shelfLifeDays),
        barcode: code,
      });
    }
    openItemEditor(null, { barcode: code }, true);
  }, []);

  return (
    <>
      <ItemDetail id={sheet.kind === "item" ? sheet.id : null} />
      {sheet.kind === "editItem" && <ItemEditor key={sheet.id ?? "new"} id={sheet.id} prefill={sheet.prefill} lookup={sheet.lookup} />}
      {sheet.kind === "scan" && (
        <Suspense fallback={null}>
          <Scanner onDetected={onDetected} onClose={closeSheet} />
        </Suspense>
      )}
    </>
  );
}

// ---- Detail ------------------------------------------------------------------

function ItemDetail({ id }: { id: string | null }) {
  const item = useItem(id);
  const locations = useLocations() ?? [];
  const users = useUsers();
  const open = id != null && item != null;

  // Closed because the item was used up here or deleted on another device.
  useEffect(() => {
    if (id && item === null) closeSheet();
  }, [id, item]);

  if (!open || !item) return <Sheet open={false} onClose={closeSheet}>{null}</Sheet>;
  const location = locations.find((l) => l.id === item.locationId);
  const step = qtyStep(item.unit, item.quantity);
  const level = expiryLevel(item.expiresOn);
  const by = users.find((u) => u.id === item._by)?.name;

  const finish = async () => {
    const snap = item;
    closeSheet();
    reportQty(await useUp(snap));
  };

  return (
    <Sheet open onClose={closeSheet} title={item.name}>
      <p className="-mt-1 mb-4 text-sm text-muted">
        {item.category} · {location?.name ?? "Unknown place"}
      </p>

      <div className="flex items-center justify-between rounded-2xl border border-line bg-surface p-2">
        <button
          type="button"
          aria-label="Decrease"
          onClick={() => adjustQuantity(item, -step).then(reportQty)}
          className="flex size-14 items-center justify-center rounded-xl bg-surface-2 active:opacity-70"
        >
          <Minus className="size-6" />
        </button>
        <div className="text-center">
          <div className="text-3xl font-bold tabular-nums">{formatQty(item.quantity, item.unit)}</div>
          {item.minQuantity != null && <div className="text-xs text-muted">Keep at least {formatQty(item.minQuantity, item.unit)}</div>}
        </div>
        <button
          type="button"
          aria-label="Increase"
          onClick={() => adjustQuantity(item, step).then(reportQty)}
          className="flex size-14 items-center justify-center rounded-xl bg-surface-2 active:opacity-70"
        >
          <Plus className="size-6" />
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-muted">Expires</dt>
          <dd className={cx("mt-0.5 font-semibold", level === "expired" && "text-danger", level === "urgent" && "text-warn")}>
            {item.expiresOn ? (
              <>
                {relativeDay(item.expiresOn)}
                <span className="block text-xs font-normal text-muted">{longDate.format(parseISODate(item.expiresOn))}</span>
              </>
            ) : (
              "No date"
            )}
          </dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-muted">Opened</dt>
          <dd className="mt-0.5 font-semibold">
            {item.openedOn ? (
              relativeDay(item.openedOn)
            ) : (
              <button type="button" className="font-semibold text-accent" onClick={() => updateItem(item.id, { openedOn: today() })}>
                Mark opened
              </button>
            )}
          </dd>
        </div>
        <div className="col-span-2 rounded-xl bg-surface p-3 text-muted">
          Added {relativeDay(item.addedOn)}
          {by && item._at ? ` · last changed by ${by} ${relativeTime(item._at)}` : ""}
          {item.barcode && (
            <span className="mt-1 flex items-center gap-1.5 text-xs">
              <Barcode className="size-3.5" /> {item.barcode}
            </span>
          )}
        </div>
        {item.notes && <div className="col-span-2 rounded-xl bg-surface p-3 whitespace-pre-wrap">{item.notes}</div>}
      </dl>

      {locations.length > 1 && (
        <div className="mt-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted">
            <ArrowRightLeft className="size-4" /> Move to
          </p>
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
            {locations
              .filter((l) => l.id !== item.locationId)
              .map((l) => (
                <Chip
                  key={l.id}
                  onClick={async () => {
                    await updateItem(item.id, { locationId: l.id });
                    toast(`Moved to ${l.name}`);
                  }}
                >
                  {l.name}
                </Chip>
              ))}
          </div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="primary" onClick={finish}>
          <PackageOpen className="size-5" /> Used up
        </Button>
        <Button
          variant="soft"
          onClick={async () => {
            const added = await ensureOnList(item);
            toast(added ? `${item.name} added to list` : `${item.name} is already on the list`);
          }}
        >
          <ShoppingBasket className="size-5" /> To list
        </Button>
        <Button onClick={() => openItemEditor(item.id)}>
          <Pencil className="size-4" /> Edit
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            const snap = item;
            closeSheet();
            await deleteItem(snap.id);
            toast(`Deleted ${snap.name}`, { actions: [{ label: "Undo", onClick: () => void restoreItem(snap) }] });
          }}
        >
          <Trash2 className="size-4" /> Delete
        </Button>
      </div>
    </Sheet>
  );
}

// ---- Add / edit -----------------------------------------------------------------

const EXPIRY_PRESETS: [string, number | null][] = [
  ["None", null],
  ["3 days", 3],
  ["1 week", 7],
  ["2 weeks", 14],
  ["1 month", 30],
  ["3 months", 90],
  ["6 months", 182],
  ["1 year", 365],
];

function ItemEditor({ id, prefill, lookup }: { id: string | null; prefill?: Partial<ItemInput>; lookup?: boolean }) {
  const editing = useItem(id);
  const locations = useLocations();
  const products = useProducts() ?? [];
  const [form, setForm] = useState<ItemInput | null>(null);
  const [qtyText, setQtyText] = useState("1");
  const [staple, setStaple] = useState(false);
  const [touched, setTouched] = useState({ category: false, location: false, expiry: false, unit: false });
  const [showSuggest, setShowSuggest] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lookupState, setLookupState] = useState<"idle" | "busy" | "found" | "missing" | "failed">("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialise once the data we need has loaded.
  useEffect(() => {
    if (form || !locations) return;
    if (id && editing === undefined) return;
    if (editing) {
      setForm({
        name: editing.name,
        locationId: editing.locationId,
        quantity: editing.quantity,
        unit: editing.unit,
        category: editing.category,
        expiresOn: editing.expiresOn,
        minQuantity: editing.minQuantity,
        barcode: editing.barcode,
        notes: editing.notes,
      });
      setQtyText(String(editing.quantity));
      setStaple(editing.minQuantity != null);
      setTouched({ category: true, location: true, expiry: true, unit: true });
      return;
    }
    const preLoc = prefill?.locationId;
    setForm({
      name: prefill?.name ?? "",
      locationId: locations.find((l) => l.id === preLoc)?.id ?? locations[0]?.id ?? "",
      quantity: prefill?.quantity ?? 1,
      unit: prefill?.unit ?? "",
      category: prefill?.category ?? "Other",
      expiresOn: prefill?.expiresOn ?? null,
      minQuantity: null,
      barcode: prefill?.barcode ?? null,
      notes: "",
    });
    setQtyText(String(prefill?.quantity ?? 1));
    setTouched({ category: !!prefill?.category, location: !!prefill?.locationId, expiry: !!prefill?.expiresOn, unit: !!prefill?.unit });
  }, [form, locations, editing, id, prefill]);

  const set = (patch: Partial<ItemInput>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const applyProduct = useCallback(
    (p: Row<"products">) => {
      setForm((f) => {
        if (!f) return f;
        return {
          ...f,
          name: p.name,
          category: touched.category ? f.category : p.category,
          unit: touched.unit ? f.unit : p.unit,
          locationId: !touched.location && p.locationId && locations?.some((l) => l.id === p.locationId) ? p.locationId : f.locationId,
          expiresOn: touched.expiry ? f.expiresOn : (suggestedExpiry(p.shelfLifeDays) ?? f.expiresOn),
          barcode: f.barcode ?? p.barcode,
        };
      });
      setShowSuggest(false);
    },
    [touched, locations],
  );

  const runLookup = useCallback(
    async (code: string) => {
      const local = await findProductByBarcode(code);
      if (local) {
        applyProduct(local);
        set({ barcode: code });
        setLookupState("found");
        return;
      }
      setLookupState("busy");
      try {
        const res = await api<BarcodeLookup>(`/api/lookup/${encodeURIComponent(code)}`, { timeoutMs: 9000 });
        if (res.found && res.name) {
          const category = res.category ?? guessCategory(res.name);
          const locId = !touched.location ? await locationForCategory(category) : null;
          setForm((f) =>
            f
              ? {
                  ...f,
                  name: f.name || res.name!,
                  category: touched.category ? f.category : category,
                  locationId: locId ?? f.locationId,
                  barcode: code,
                }
              : f,
          );
          setLookupState("found");
        } else {
          set({ barcode: code });
          setLookupState("missing");
        }
      } catch {
        set({ barcode: code });
        setLookupState("failed");
      }
    },
    [applyProduct, touched],
  );

  useEffect(() => {
    if (lookup && prefill?.barcode && form && lookupState === "idle") void runLookup(prefill.barcode);
  }, [lookup, prefill, form, lookupState, runLookup]);

  const suggestions = useMemo(() => {
    const q = nameKey(form?.name ?? "");
    if (!q) return [];
    const starts = products.filter((p) => p.nameKey.startsWith(q) && p.nameKey !== q);
    const contains = products.filter((p) => !p.nameKey.startsWith(q) && p.nameKey.includes(q));
    return [...starts, ...contains].slice(0, 5);
  }, [form?.name, products]);

  if (!form || !locations) {
    return (
      <Sheet open onClose={closeSheet} title={id ? "Edit item" : "Add item"}>
        <div className="flex justify-center py-10 text-muted">
          <Spinner />
        </div>
      </Sheet>
    );
  }

  const onNameBlur = () => {
    setTimeout(() => setShowSuggest(false), 150);
    const exact = products.find((p) => p.nameKey === nameKey(form.name));
    if (exact) return applyProduct(exact);
    if (!touched.category && form.name.trim()) {
      const category = guessCategory(form.name);
      set({ category });
      if (!touched.location) void locationForCategory(category).then((locId) => locId && set({ locationId: locId }));
    }
  };

  const save = async () => {
    const quantity = Number(qtyText.replace(",", "."));
    if (!form.name.trim()) return setError("Give it a name");
    if (!Number.isFinite(quantity) || quantity <= 0) return setError("Quantity must be more than zero");
    if (!locations.some((l) => l.id === form.locationId)) return setError("Choose where it's kept");
    setError(null);
    setSaving(true);
    try {
      const data: ItemInput = { ...form, name: form.name.trim(), quantity, minQuantity: staple ? (form.minQuantity ?? 1) : null };
      if (id) {
        await updateItem(id, data);
        closeSheet();
        openItem(id);
      } else {
        await addItem(data);
        closeSheet();
        const where = locations.find((l) => l.id === data.locationId)?.name;
        toast(`Added ${data.name}${where ? ` to ${where}` : ""}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const units = UNITS.includes(form.unit as (typeof UNITS)[number]) ? UNITS : [...UNITS, form.unit];

  return (
    <Sheet
      open
      onClose={closeSheet}
      title={id ? "Edit item" : "Add item"}
      footer={
        <Button variant="primary" size="lg" className="w-full" onClick={save} disabled={saving}>
          {saving ? <Spinner /> : id ? "Save changes" : "Add to stock"}
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="relative">
          <Field label="Name" group>
            <div className="flex gap-2">
              <Input
                aria-label="Name"
                autoFocus={!id && !prefill?.barcode}
                value={form.name}
                placeholder="e.g. Greek yoghurt"
                autoComplete="off"
                autoCapitalize="sentences"
                enterKeyHint="done"
                onChange={(e) => {
                  set({ name: e.target.value });
                  setShowSuggest(true);
                }}
                onFocus={() => setShowSuggest(true)}
                onBlur={onNameBlur}
              />
              <Button aria-label="Scan barcode" className="w-11 shrink-0 px-0" onClick={() => setScanning(true)}>
                <ScanLine className="size-5" />
              </Button>
            </div>
          </Field>
          {showSuggest && suggestions.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyProduct(p)}
                    className="flex w-full items-center justify-between px-3.5 py-2.5 text-left active:bg-surface-2"
                  >
                    <span>{p.name}</span>
                    <span className="text-xs text-muted">{p.category}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lookupState !== "idle" && (
            <p className="mt-1.5 flex items-center gap-2 text-xs text-muted">
              {lookupState === "busy" && (
                <>
                  <Spinner className="size-3.5" /> Looking up barcode…
                </>
              )}
              {lookupState === "found" && `Barcode ${form.barcode} recognised`}
              {lookupState === "missing" && `Barcode ${form.barcode} isn't in the product database. Name it once and Larder will remember.`}
              {lookupState === "failed" && `Couldn't look up ${form.barcode} right now. Name it and Larder will remember.`}
            </p>
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Quantity" group>
            <div className="flex items-center gap-1">
              <Button
                aria-label="Less"
                className="w-11 shrink-0 px-0"
                onClick={() => setQtyText((q) => String(Math.max(0, (Number(q) || 0) - qtyStep(form.unit, Number(q) || 0))))}
              >
                <Minus className="size-4" />
              </Button>
              <Input aria-label="Quantity" inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value)} className="text-center" />
              <Button
                aria-label="More"
                className="w-11 shrink-0 px-0"
                onClick={() => setQtyText((q) => String((Number(q) || 0) + qtyStep(form.unit, Number(q) || 0)))}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </Field>
          <Field label="Unit">
            <Select
              value={form.unit}
              onChange={(e) => {
                set({ unit: e.target.value });
                setTouched((t) => ({ ...t, unit: true }));
              }}
              className="w-28"
            >
              {units.map((u) => (
                <option key={u} value={u}>
                  {u || "items"}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Kept in" group>
          {locations.length === 0 && (
            <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
              This device hasn't downloaded your household yet. Connect once and your fridge, freezer and cupboards will appear.
            </p>
          )}
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
            {locations.map((l) => (
              <Chip
                key={l.id}
                active={form.locationId === l.id}
                onClick={() => {
                  set({ locationId: l.id });
                  setTouched((t) => ({ ...t, location: true }));
                }}
              >
                {l.name}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Expires" group>
          <div className="no-scrollbar -mx-5 mb-2 flex gap-2 overflow-x-auto px-5">
            {EXPIRY_PRESETS.map(([label, days]) => {
              const value = days == null ? null : addDays(today(), days);
              return (
                <Chip
                  key={label}
                  active={form.expiresOn === value}
                  onClick={() => {
                    set({ expiresOn: value });
                    setTouched((t) => ({ ...t, expiry: true }));
                  }}
                >
                  {label}
                </Chip>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              aria-label="Expiry date"
              value={form.expiresOn ?? ""}
              onChange={(e) => {
                set({ expiresOn: e.target.value || null });
                setTouched((t) => ({ ...t, expiry: true }));
              }}
            />
            {form.expiresOn && <ExpiryBadge expiresOn={form.expiresOn} className="shrink-0" />}
          </div>
        </Field>

        <Field label="Category">
          <Select
            value={form.category}
            onChange={(e) => {
              set({ category: e.target.value });
              setTouched((t) => ({ ...t, category: true }));
            }}
          >
            {(CATEGORIES.includes(form.category as (typeof CATEGORIES)[number]) ? CATEGORIES : [...CATEGORIES, form.category]).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>

        <div className="rounded-2xl border border-line bg-surface p-3.5">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="font-medium">Always keep in stock</p>
              <p className="text-xs text-muted">Adds it to the shopping list when it runs low</p>
            </div>
            <Toggle checked={staple} onChange={setStaple} label="Always keep in stock" />
          </div>
          {staple && (
            <Field label="Running low at or below" className="mt-3">
              <Input
                inputMode="decimal"
                value={form.minQuantity ?? 1}
                onChange={(e) => set({ minQuantity: Number(e.target.value.replace(",", ".")) || 0 })}
              />
            </Field>
          )}
        </div>

        <Field label="Notes">
          <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional" rows={2} />
        </Field>

        {error && <p className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{error}</p>}
        <button type="submit" hidden />
      </form>

      {scanning && (
        <Suspense fallback={null}>
          <Scanner
            onClose={() => setScanning(false)}
            onDetected={(code) => {
              setScanning(false);
              void runLookup(code);
            }}
          />
        </Suspense>
      )}
    </Sheet>
  );
}
