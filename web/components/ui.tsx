import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "../lib/util.ts";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink active:opacity-85 disabled:opacity-50",
  secondary: "bg-surface text-ink border border-line active:bg-surface-2 disabled:opacity-50",
  soft: "bg-accent-soft text-accent active:opacity-80 disabled:opacity-50",
  ghost: "text-ink active:bg-surface-2 disabled:opacity-40",
  danger: "bg-danger-soft text-danger active:opacity-80 disabled:opacity-50",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-colors",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-11 px-4",
        size === "lg" && "h-12 px-5 text-[17px]",
        variants[variant],
        className,
      )}
    />
  );
}

export function IconButton({ label, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink transition-colors active:bg-surface-2 disabled:opacity-40",
        className,
      )}
    />
  );
}

const fieldBase =
  "w-full rounded-xl border border-line bg-surface px-3.5 text-ink placeholder:text-muted/70 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={cx(fieldBase, "h-11", className)} />;
});

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldBase, "h-11 appearance-none bg-[length:16px] pr-8", className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldBase, "min-h-20 py-2.5", className)} />;
}

/**
 * A labelled form control. Use `group` when it holds several controls (chips,
 * stepper buttons): a wrapping <label> would otherwise name only the first one.
 */
export function Field({
  label,
  hint,
  children,
  className,
  group,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  group?: boolean;
}) {
  const id = useId();
  const caption = (
    <span id={`${id}-label`} className="mb-1.5 block text-sm font-medium text-muted">
      {label}
    </span>
  );
  const help = hint && <span className="mt-1 block text-xs text-muted">{hint}</span>;
  if (group) {
    return (
      <div role="group" aria-labelledby={`${id}-label`} className={cx("block", className)}>
        {caption}
        {children}
        {help}
      </div>
    );
  }
  return (
    <label className={cx("block", className)}>
      {caption}
      {children}
      {help}
    </label>
  );
}

export function Chip({
  active,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...props}
      className={cx(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors",
        active ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink active:bg-surface-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mt-6", className)}>
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between px-4">
          <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-4 overflow-hidden rounded-2xl border border-line bg-surface", className)}>{children}</div>;
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 py-14 text-center">
      <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-surface-2 text-muted">{icon}</div>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-line")}
    >
      <span className={cx("absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform", checked && "translate-x-5")} />
    </button>
  );
}
