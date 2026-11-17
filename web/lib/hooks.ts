import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { PublicUser, Row } from "../../shared/schema.ts";
import { api } from "./api.ts";
import { db } from "./db.ts";
import { syncEngine } from "./sync.ts";
import { expiryLevel } from "./util.ts";

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export function useLocations(): Row<"locations">[] | undefined {
  return useLiveQuery(() => db.locations.toArray().then((l) => l.sort((a, b) => a.sort - b.sort || byName(a, b))), []);
}

export function useItems(): Row<"items">[] | undefined {
  return useLiveQuery(() => db.items.toArray(), []);
}

/**
 * undefined while loading, null if it doesn't exist. useLiveQuery keeps returning the
 * previous result while a new id loads, so results are tagged to avoid reading a stale
 * "not found" as "deleted".
 */
export function useItem(id: string | null | undefined): Row<"items"> | null | undefined {
  const res = useLiveQuery(async () => ({ id, item: id ? ((await db.items.get(id)) ?? null) : null }), [id]);
  return res && res.id === id ? res.item : undefined;
}

export function useGrocery(): Row<"grocery">[] | undefined {
  return useLiveQuery(() => db.grocery.toArray(), []);
}

export function useTasks(): Row<"tasks">[] | undefined {
  return useLiveQuery(() => db.tasks.toArray(), []);
}

export function useProducts(): Row<"products">[] | undefined {
  return useLiveQuery(() => db.products.toArray().then((p) => p.sort(byName)), []);
}

export function usePendingCount(): number {
  return useLiveQuery(() => db.outbox.count(), [], 0);
}

export function useSyncStatus() {
  return useSyncExternalStore(syncEngine.subscribe, syncEngine.getStatus);
}

export function isLow(i: Row<"items">) {
  return i.minQuantity != null && i.quantity <= i.minQuantity;
}

export function isExpiringSoon(i: Row<"items">) {
  const l = expiryLevel(i.expiresOn);
  return l === "expired" || l === "urgent" || l === "soon";
}

/** Household members, cached so names still show offline. */
export function useUsers(): PublicUser[] {
  const [users, setUsers] = useState<PublicUser[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("larder.users") ?? "[]") as PublicUser[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    api<{ users: PublicUser[] }>("/api/users")
      .then(({ users }) => {
        setUsers(users);
        try {
          localStorage.setItem("larder.users", JSON.stringify(users));
        } catch {
          // storage full or blocked: names just won't be cached
        }
      })
      .catch(() => {});
  }, []);
  return users;
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
