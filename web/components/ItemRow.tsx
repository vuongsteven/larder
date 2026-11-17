import { Minus, Plus } from "lucide-react";
import type { Row } from "../../shared/schema.ts";
import { adjustQuantity, ensureOnList, restoreItem, type QtyResult } from "../lib/actions.ts";
import { isLow } from "../lib/hooks.ts";
import { openItem, toast } from "../lib/ui-store.ts";
import { cx, expiryLevel, formatQty, qtyStep, relativeDay, type ExpiryLevel } from "../lib/util.ts";

const levelStyle: Record<ExpiryLevel, string> = {
  expired: "bg-danger-soft text-danger",
  urgent: "bg-warn-soft text-warn",
  soon: "bg-caution-soft text-caution",
  ok: "bg-surface-2 text-muted",
  none: "",
};

const levelBar: Record<ExpiryLevel, string> = {
  expired: "bg-danger",
  urgent: "bg-warn",
  soon: "bg-caution",
  ok: "bg-transparent",
  none: "bg-transparent",
};

export function ExpiryBadge({ expiresOn, className }: { expiresOn: string | null; className?: string }) {
  if (!expiresOn) return null;
  const level = expiryLevel(expiresOn);
  const label = level === "expired" ? `Expired ${relativeDay(expiresOn)}` : `Exp ${relativeDay(expiresOn)}`;
  return <span className={cx("inline-flex h-5 items-center rounded-md px-1.5 text-xs font-semibold whitespace-nowrap", levelStyle[level], className)}>{label}</span>;
}

/** Toast after a quantity change, with undo and (for used-up items) add-to-list. */
export function reportQty(r: QtyResult) {
  if (!r.usedUp && !r.addedToList) return;
  const msg = r.usedUp ? `Used up ${r.snapshot.name}` : `${r.snapshot.name} is running low`;
  const extra = r.addedToList ? " · added to list" : "";
  const actions = [];
  if (r.usedUp) actions.push({ label: "Undo", onClick: () => void restoreItem(r.snapshot) });
  if (r.usedUp && !r.addedToList) {
    actions.push({
      label: "Add to list",
      onClick: () =>
        void ensureOnList(r.snapshot).then((added) =>
          toast(added ? `${r.snapshot.name} added to list` : `${r.snapshot.name} is already on the list`),
        ),
    });
  }
  toast(msg + extra, { actions });
}

export function ItemRow({ item, locationName }: { item: Row<"items">; locationName?: string }) {
  const level = expiryLevel(item.expiresOn);
  const step = qtyStep(item.unit, item.quantity);
  const low = isLow(item);
  return (
    <div role="group" aria-label={item.name} className="relative flex items-center gap-1 border-b border-line last:border-b-0">
      <span className={cx("absolute inset-y-2 left-0 w-1 rounded-r-full", levelBar[level])} aria-hidden />
      <button type="button" onClick={() => openItem(item.id)} className="flex min-w-0 flex-1 flex-col items-start py-3 pr-1 pl-4 text-left active:bg-surface-2">
        <span className="w-full truncate font-medium">{item.name}</span>
        <span className="mt-0.5 flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          {locationName && <span>{locationName}</span>}
          <ExpiryBadge expiresOn={item.expiresOn} />
          {item.openedOn && <span className="text-xs">Opened {relativeDay(item.openedOn)}</span>}
          {low && <span className="inline-flex h-5 items-center rounded-md bg-accent-soft px-1.5 text-xs font-semibold text-accent">Low</span>}
        </span>
      </button>
      <div className="flex shrink-0 items-center pr-2">
        <button
          type="button"
          aria-label={`Use some ${item.name}`}
          onClick={() => adjustQuantity(item, -step).then(reportQty)}
          className="flex size-9 items-center justify-center rounded-full text-muted active:bg-surface-2"
        >
          <Minus className="size-4" />
        </button>
        <span className="min-w-[3.25rem] text-center text-[15px] font-semibold tabular-nums">{formatQty(item.quantity, item.unit)}</span>
        <button
          type="button"
          aria-label={`Add more ${item.name}`}
          onClick={() => adjustQuantity(item, step).then(reportQty)}
          className="flex size-9 items-center justify-center rounded-full text-muted active:bg-surface-2"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}
