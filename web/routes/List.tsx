import { Check, MoreHorizontal, PackageCheck, ShoppingBasket, Trash2, TrendingDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { defaultLocationKind } from "../../shared/categorize.ts";
import { CATEGORIES, nameKey, UNITS, type Row } from "../../shared/schema.ts";
import { PageHeader } from "../components/chrome.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { Button, Card, Chip, Empty, Field, Input, Section, Select } from "../components/ui.tsx";
import {
  addGroceryFromText,
  clearChecked,
  deleteGrocery,
  putAway,
  suggestedExpiry,
  toggleGrocery,
  updateGrocery,
  type PutAwayEntry,
} from "../lib/actions.ts";
import { isLow, useGrocery, useItems, useLocations, useProducts } from "../lib/hooks.ts";
import { fields, save as saveRecord } from "../lib/store.ts";
import { toast } from "../lib/ui-store.ts";
import { addDays, cx, formatQty, today } from "../lib/util.ts";

export default function List() {
  const grocery = useGrocery();
  const products = useProducts() ?? [];
  const items = useItems() ?? [];
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState<Row<"grocery"> | null>(null);
  const [puttingAway, setPuttingAway] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (params.get("focus")) {
      input.current?.focus();
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const { open, checked } = useMemo(() => {
    const all = grocery ?? [];
    return {
      open: all.filter((g) => !g.checked),
      checked: all.filter((g) => g.checked).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [grocery]);

  const grouped = useMemo(() => {
    const order = new Map<string, number>(CATEGORIES.map((c, i) => [c, i]));
    const groups = new Map<string, Row<"grocery">[]>();
    for (const g of [...open].sort((a, b) => a.name.localeCompare(b.name))) groups.set(g.category, [...(groups.get(g.category) ?? []), g]);
    return [...groups.entries()].sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b));
  }, [open]);

  const onList = useMemo(() => new Set(open.map((g) => nameKey(g.name))), [open]);

  const suggestions = useMemo(() => {
    const q = nameKey(text);
    if (q) {
      return products
        .filter((p) => p.nameKey.includes(q) && p.nameKey !== q && !onList.has(p.nameKey))
        .sort((a, b) => Number(b.nameKey.startsWith(q)) - Number(a.nameKey.startsWith(q)))
        .slice(0, 6)
        .map((p) => p.name);
    }
    // With an empty box, offer staples that are running low.
    return items.filter((i) => isLow(i) && !onList.has(nameKey(i.name))).map((i) => i.name);
  }, [text, products, items, onList]);

  const add = async (value: string) => {
    if (!value.trim()) return;
    const res = await addGroceryFromText(value);
    if (!res.added) toast(`${res.name} is already on the list`);
    setText("");
    input.current?.focus();
  };

  return (
    <>
      <PageHeader title="Shopping list" subtitle={open.length ? `${open.length} to buy` : undefined} />

      <div className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-20 bg-bg/90 px-4 pt-1 pb-2 backdrop-blur-md">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add(text);
          }}
        >
          <Input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="Add item, e.g. 2 milk"
            enterKeyHint="enter"
            autoComplete="off"
            aria-label="Add to shopping list"
          />
          <Button type="submit" variant="primary" disabled={!text.trim()}>
            Add
          </Button>
        </form>
        {(focused || !text) && suggestions.length > 0 && (
          <div className="no-scrollbar mt-2 flex items-center gap-2 overflow-x-auto">
            {!text && (
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted">
                <TrendingDown className="size-3.5" /> Low:
              </span>
            )}
            {suggestions.map((s) => (
              <Chip key={s} onMouseDown={(e) => e.preventDefault()} onClick={() => void add(s)}>
                + {s}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {grocery && grocery.length === 0 && (
        <Empty icon={<ShoppingBasket className="size-7" />} title="Your list is empty">
          Add things above. Items you use up can go straight onto the list, and staples add themselves when they run low.
        </Empty>
      )}

      {grouped.map(([cat, list]) => (
        <Section key={cat} title={cat} className="mt-3">
          <Card>
            {list.map((g) => (
              <GroceryRow key={g.id} g={g} onEdit={() => setEditing(g)} />
            ))}
          </Card>
        </Section>
      ))}

      {checked.length > 0 && (
        <Section
          title={`In the basket · ${checked.length}`}
          action={
            <button
              type="button"
              className="text-sm font-medium text-muted"
              onClick={async () => {
                const n = await clearChecked();
                toast(`Removed ${n} item${n === 1 ? "" : "s"}`);
              }}
            >
              Clear
            </button>
          }
        >
          <Card>
            {checked.map((g) => (
              <GroceryRow key={g.id} g={g} onEdit={() => setEditing(g)} />
            ))}
          </Card>
          <div className="px-4 pt-3">
            <Button variant="primary" size="lg" className="w-full" onClick={() => setPuttingAway(true)}>
              <PackageCheck className="size-5" /> Put away {checked.length} item{checked.length === 1 ? "" : "s"}
            </Button>
          </div>
        </Section>
      )}

      {editing && <GroceryEditor g={editing} onClose={() => setEditing(null)} />}
      {puttingAway && <PutAwaySheet items={checked} onClose={() => setPuttingAway(false)} />}
    </>
  );
}

function GroceryRow({ g, onEdit }: { g: Row<"grocery">; onEdit: () => void }) {
  return (
    <div className="flex items-center border-b border-line last:border-b-0">
      <button
        type="button"
        role="checkbox"
        aria-checked={g.checked}
        onClick={() => void toggleGrocery(g)}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left active:bg-surface-2"
      >
        <span
          className={cx(
            "flex size-6 shrink-0 items-center justify-center rounded-lg border-2",
            g.checked ? "border-accent bg-accent text-accent-ink" : "border-muted/60",
          )}
        >
          {g.checked && <Check className="size-4" strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate font-medium", g.checked && "text-muted line-through")}>
            {g.name}
            {g.quantity != null && <span className="ml-2 font-normal text-muted">{formatQty(g.quantity, g.unit)}</span>}
          </span>
          {g.note && <span className="block truncate text-[13px] text-muted">{g.note}</span>}
        </span>
      </button>
      <button type="button" aria-label={`Edit ${g.name}`} onClick={onEdit} className="flex size-12 shrink-0 items-center justify-center text-muted">
        <MoreHorizontal className="size-5" />
      </button>
    </div>
  );
}

function GroceryEditor({ g, onClose }: { g: Row<"grocery">; onClose: () => void }) {
  const [name, setName] = useState(g.name);
  const [qty, setQty] = useState(g.quantity == null ? "" : String(g.quantity));
  const [unit, setUnit] = useState(g.unit);
  const [category, setCategory] = useState(g.category);
  const [note, setNote] = useState(g.note);

  const save = async () => {
    if (!name.trim()) return;
    const q = qty.trim() ? Number(qty.replace(",", ".")) : null;
    await updateGrocery(g.id, { name: name.trim(), quantity: q != null && Number.isFinite(q) && q > 0 ? q : null, unit, category, note });
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit list item"
      footer={
        <div className="flex gap-2">
          <Button
            variant="danger"
            aria-label="Remove from list"
            className="w-12 px-0"
            onClick={async () => {
              await deleteGrocery(g.id);
              onClose();
              toast(`Removed ${g.name}`, { actions: [{ label: "Undo", onClick: () => void saveRecord("grocery", null, fields(g)) }] });
            }}
          >
            <Trash2 className="size-5" />
          </Button>
          <Button variant="primary" size="lg" className="flex-1" onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">
            <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Any" />
          </Field>
          <Field label="Unit">
            <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {(UNITS.includes(unit as (typeof UNITS)[number]) ? UNITS : [...UNITS, unit]).map((u) => (
                <option key={u} value={u}>
                  {u || "items"}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Aisle">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {(CATEGORIES.includes(category as (typeof CATEGORIES)[number]) ? CATEGORIES : [...CATEGORIES, category]).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. the big tub, or brand" />
        </Field>
      </div>
    </Sheet>
  );
}

const PUTAWAY_EXPIRY: [string, number | null][] = [
  ["No date", null],
  ["3d", 3],
  ["1w", 7],
  ["2w", 14],
  ["1m", 30],
  ["3m", 90],
  ["1y", 365],
];

function PutAwaySheet({ items, onClose }: { items: Row<"grocery">[]; onClose: () => void }) {
  const locations = useLocations() ?? [];
  const products = useProducts() ?? [];
  const [plan, setPlan] = useState<Record<string, { locationId: string; expiresOn: string | null }>>({});
  const [saving, setSaving] = useState(false);

  // Default each item to where the household kept it last time, else by category.
  useEffect(() => {
    if (!locations.length) return;
    setPlan((prev) => {
      const next = { ...prev };
      for (const g of items) {
        if (next[g.id]) continue;
        const product = products.find((p) => p.nameKey === nameKey(g.name));
        const byKind = locations.find((l) => l.kind === defaultLocationKind(g.category))?.id;
        const locationId =
          (product?.locationId && locations.some((l) => l.id === product.locationId) ? product.locationId : undefined) ?? byKind ?? locations[0].id;
        next[g.id] = { locationId, expiresOn: suggestedExpiry(product?.shelfLifeDays) };
      }
      return next;
    });
  }, [items, locations, products]);

  const confirm = async () => {
    setSaving(true);
    const entries: PutAwayEntry[] = items.filter((g) => plan[g.id]).map((g) => ({ grocery: g, ...plan[g.id] }));
    await putAway(entries);
    setSaving(false);
    onClose();
    toast(`Put away ${entries.length} item${entries.length === 1 ? "" : "s"}`);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Put away"
      footer={
        <Button variant="primary" size="lg" className="w-full" onClick={confirm} disabled={saving || !locations.length}>
          Add {items.length} to stock
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted">Where is each one going? Add a use-by date if it has one.</p>
      <div className="space-y-3">
        {items.map((g) => {
          const p = plan[g.id];
          return (
            <div key={g.id} className="rounded-2xl border border-line bg-surface p-3">
              <p className="font-medium">
                {g.name}
                {g.quantity != null && <span className="ml-2 font-normal text-muted">{formatQty(g.quantity, g.unit)}</span>}
              </p>
              <div className="no-scrollbar -mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3">
                {locations.map((l) => (
                  <Chip
                    key={l.id}
                    active={p?.locationId === l.id}
                    className="h-8 px-3"
                    onClick={() => setPlan((s) => ({ ...s, [g.id]: { ...s[g.id], locationId: l.id } }))}
                  >
                    {l.name}
                  </Chip>
                ))}
              </div>
              <div className="no-scrollbar -mx-3 mt-2 flex items-center gap-1.5 overflow-x-auto px-3">
                {PUTAWAY_EXPIRY.map(([label, days]) => {
                  const value = days == null ? null : addDays(today(), days);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setPlan((s) => ({ ...s, [g.id]: { ...s[g.id], expiresOn: value } }))}
                      className={cx(
                        "h-7 shrink-0 rounded-full px-2.5 text-xs font-medium",
                        p?.expiresOn === value ? "bg-ink text-bg" : "bg-surface-2 text-muted",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
                <input
                  type="date"
                  aria-label={`Use-by date for ${g.name}`}
                  value={p?.expiresOn ?? ""}
                  onChange={(e) => setPlan((s) => ({ ...s, [g.id]: { ...s[g.id], expiresOn: e.target.value || null } }))}
                  className="h-7 shrink-0 rounded-full bg-surface-2 px-2 text-xs text-muted"
                />
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
