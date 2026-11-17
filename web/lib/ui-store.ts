// Tiny global stores for app-wide UI: toasts and the item/scan sheets that
// several screens open.
import { useSyncExternalStore } from "react";
import type { ItemInput } from "./actions.ts";

function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: T | ((s: T) => T)) {
      state = typeof next === "function" ? (next as (s: T) => T)(state) : next;
      listeners.forEach((l) => l());
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function useStore<T>(store: ReturnType<typeof createStore<T>>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

// ---- Toasts --------------------------------------------------------------

export interface Toast {
  id: number;
  message: string;
  tone: "default" | "error";
  actions: { label: string; onClick: () => void }[];
}

const toasts = createStore<Toast[]>([]);
let toastSeq = 0;

export function toast(message: string, opts: { tone?: Toast["tone"]; actions?: Toast["actions"]; durationMs?: number } = {}) {
  const id = ++toastSeq;
  const t: Toast = { id, message, tone: opts.tone ?? "default", actions: opts.actions ?? [] };
  toasts.set((all) => [...all.slice(-2), t]);
  setTimeout(() => dismissToast(id), opts.durationMs ?? (t.actions.length ? 6000 : 3500));
  return id;
}

export function dismissToast(id: number) {
  toasts.set((all) => all.filter((t) => t.id !== id));
}

export const useToasts = () => useStore(toasts);

// ---- Sheets ----------------------------------------------------------------

export type SheetState =
  | { kind: "none" }
  | { kind: "item"; id: string }
  | { kind: "editItem"; id: string | null; prefill?: Partial<ItemInput>; lookup?: boolean }
  | { kind: "scan" };

const sheet = createStore<SheetState>({ kind: "none" });

export const useSheet = () => useStore(sheet);
export const openItem = (id: string) => sheet.set({ kind: "item", id });
export const openItemEditor = (id: string | null, prefill?: Partial<ItemInput>, lookup?: boolean) =>
  sheet.set({ kind: "editItem", id, prefill, lookup });
export const openScanner = () => sheet.set({ kind: "scan" });
export const closeSheet = () => sheet.set({ kind: "none" });
