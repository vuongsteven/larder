import { dismissToast, useToasts } from "../lib/ui-store.ts";
import { cx } from "../lib/util.ts";

export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[60] mx-auto flex max-w-xl flex-col items-center gap-2 px-3"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.25rem)" }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            "animate-toast pointer-events-auto flex w-full items-center gap-2 rounded-2xl py-2 pr-2 pl-4 text-[15px] shadow-lg",
            t.tone === "error" ? "bg-danger text-bg" : "bg-ink text-bg",
          )}
        >
          <span className="min-w-0 flex-1 py-1.5">{t.message}</span>
          {t.actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className="shrink-0 rounded-lg px-3 py-1.5 font-semibold text-(--toast-action) active:opacity-70"
              onClick={() => {
                dismissToast(t.id);
                a.onClick();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
