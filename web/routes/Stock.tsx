import { Package, Plus, ScanLine, Search, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { CATEGORIES, type Row } from "../../shared/schema.ts";
import { PageHeader } from "../components/chrome.tsx";
import { ItemRow } from "../components/ItemRow.tsx";
import { Card, Chip, Empty, IconButton, Input, Section } from "../components/ui.tsx";
import { isExpiringSoon, isLow, useItems, useLocations } from "../lib/hooks.ts";
import { openItemEditor, openScanner } from "../lib/ui-store.ts";
import { cx } from "../lib/util.ts";

type Sort = "expiry" | "name" | "category" | "recent";
const SORTS: [Sort, string][] = [
  ["expiry", "Expiry"],
  ["category", "Category"],
  ["name", "A–Z"],
  ["recent", "Newest"],
];

const byExpiry = (a: Row<"items">, b: Row<"items">) => {
  if (a.expiresOn && b.expiresOn) return a.expiresOn.localeCompare(b.expiresOn) || a.name.localeCompare(b.name);
  if (a.expiresOn) return -1;
  if (b.expiresOn) return 1;
  return a.name.localeCompare(b.name);
};

export default function Stock() {
  const items = useItems();
  const locations = useLocations() ?? [];
  const [params, setParams] = useSearchParams();
  const loc = params.get("loc") ?? "all";
  const sort = (params.get("sort") as Sort) || "expiry";
  const q = params.get("q") ?? "";
  const filter = params.get("filter"); // "expiring" | "low" from the home screen

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  // App shortcut / deep link: /stock?add=1
  useEffect(() => {
    if (params.get("add")) {
      update({ add: null });
      openItemEditor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items ?? []) m.set(i.locationId, (m.get(i.locationId) ?? 0) + 1);
    return m;
  }, [items]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = (items ?? []).filter((i) => loc === "all" || i.locationId === loc);
    if (filter === "expiring") list = list.filter(isExpiringSoon);
    if (filter === "low") list = list.filter(isLow);
    if (needle) list = list.filter((i) => i.name.toLowerCase().includes(needle) || i.category.toLowerCase().includes(needle) || i.notes.toLowerCase().includes(needle));
    switch (sort) {
      case "name":
        return [...list].sort((a, b) => a.name.localeCompare(b.name));
      case "recent":
        return [...list].sort((a, b) => b.addedOn.localeCompare(a.addedOn) || b._at - a._at);
      default:
        return [...list].sort(byExpiry);
    }
  }, [items, loc, filter, q, sort]);

  const grouped = useMemo(() => {
    if (sort !== "category") return null;
    const order = new Map<string, number>(CATEGORIES.map((c, i) => [c, i]));
    const groups = new Map<string, Row<"items">[]>();
    for (const i of visible) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);
    return [...groups.entries()].sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b));
  }, [visible, sort]);

  const showLoc = loc === "all";

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle={items ? `${items.length} item${items.length === 1 ? "" : "s"}` : undefined}
        actions={
          <IconButton label="Scan barcode" onClick={openScanner}>
            <ScanLine className="size-6" />
          </IconButton>
        }
      />

      <div className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-20 space-y-2 bg-bg/90 pt-1 pb-2 backdrop-blur-md">
        <div className="relative px-4">
          <Search className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2 text-muted" />
          <Input type="search" placeholder="Search stock" value={q} onChange={(e) => update({ q: e.target.value })} className="pl-9" />
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4">
          <Chip active={loc === "all"} onClick={() => update({ loc: null })}>
            All
          </Chip>
          {locations.map((l) => (
            <Chip key={l.id} active={loc === l.id} onClick={() => update({ loc: l.id })}>
              {l.name}
              <span className={cx("text-xs", loc === l.id ? "opacity-80" : "text-muted")}>{counts.get(l.id) ?? 0}</span>
            </Chip>
          ))}
        </div>
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto px-4 text-sm">
          <span className="mr-1 text-muted">Sort</span>
          {SORTS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => update({ sort: key === "expiry" ? null : key })}
              className={cx("rounded-lg px-2.5 py-1 font-medium", sort === key ? "bg-surface-2 text-ink" : "text-muted")}
            >
              {label}
            </button>
          ))}
        </div>
        {filter && (
          <div className="px-4">
            <Chip active onClick={() => update({ filter: null })}>
              {filter === "low" ? "Running low" : "Expiring soon"} <X className="size-4" />
            </Chip>
          </div>
        )}
      </div>

      {items && visible.length === 0 ? (
        items.length === 0 ? (
          <Empty icon={<Package className="size-7" />} title="Nothing in stock yet">
            Tap + to add what you have, or scan a barcode.
          </Empty>
        ) : (
          <Empty icon={<Search className="size-7" />} title="No matches">
            Try another search or location.
          </Empty>
        )
      ) : grouped ? (
        grouped.map(([cat, list]) => (
          <Section key={cat} title={`${cat} · ${list.length}`} className="mt-3">
            <Card>
              {list.map((i) => (
                <ItemRow key={i.id} item={i} locationName={showLoc ? locName.get(i.locationId) : undefined} />
              ))}
            </Card>
          </Section>
        ))
      ) : (
        <Card className="mt-1">
          {visible.map((i) => (
            <ItemRow key={i.id} item={i} locationName={showLoc ? locName.get(i.locationId) : undefined} />
          ))}
        </Card>
      )}

      {/* Room to scroll the last row clear of the add button. */}
      <div className="h-16" />
      <button
        type="button"
        aria-label="Add item"
        onClick={() => openItemEditor(null, loc !== "all" ? { locationId: loc } : undefined)}
        className="fixed right-4 z-30 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-lg active:opacity-85"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}
      >
        <Plus className="size-7" />
      </button>
    </>
  );
}
