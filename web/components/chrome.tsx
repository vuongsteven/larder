import { CloudOff, Home, ListChecks, Package, RefreshCw, Settings, ShoppingBasket, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { useGrocery, usePendingCount, useSyncStatus } from "../lib/hooks.ts";
import { syncEngine } from "../lib/sync.ts";
import { cx } from "../lib/util.ts";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="pt-safe sticky top-0 z-30 bg-bg/90 backdrop-blur-md">
      <div className="flex h-14 items-center gap-1 pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] leading-tight font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
        <SyncBadge />
        {actions}
      </div>
    </header>
  );
}

/** Shows only when there's something to say: offline, unsynced changes, or an error. */
export function SyncBadge() {
  const status = useSyncStatus();
  const pending = usePendingCount();
  let content: ReactNode = null;
  if (status.state === "offline") {
    content = (
      <>
        <CloudOff className="size-4" /> {pending > 0 ? `${pending} waiting` : "Offline"}
      </>
    );
  } else if (status.state === "error") {
    content = (
      <>
        <TriangleAlert className="size-4" /> Sync issue
      </>
    );
  } else if (pending > 0) {
    content = (
      <>
        <RefreshCw className={cx("size-4", status.state === "syncing" && "animate-spin")} /> {pending}
      </>
    );
  }
  if (!content) return null;
  return (
    <button
      type="button"
      onClick={() => void syncEngine.syncNow()}
      title={status.error ?? "Sync now"}
      className={cx(
        "mr-1 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold",
        status.state === "error" ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted",
      )}
    >
      {content}
    </button>
  );
}

export function BottomNav() {
  const grocery = useGrocery();
  const toBuy = grocery?.filter((g) => !g.checked).length ?? 0;
  const tabs = [
    { to: "/", label: "Home", icon: Home, end: true },
    { to: "/stock", label: "Stock", icon: Package },
    { to: "/list", label: "List", icon: ShoppingBasket, badge: toBuy },
    { to: "/tasks", label: "Tasks", icon: ListChecks },
    { to: "/more", label: "More", icon: Settings },
  ];
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur-md">
      <div className="mx-auto grid max-w-xl grid-cols-5">
        {tabs.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx("relative flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", isActive ? "text-accent" : "text-muted")
            }
          >
            <span className="relative">
              <Icon className="size-6" strokeWidth={1.9} />
              {badge ? (
                <span className="absolute -top-1.5 -right-2.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] leading-[18px] font-bold text-accent-ink">
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </span>
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
