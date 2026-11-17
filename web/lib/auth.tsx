import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthStatus, PublicUser } from "../../shared/schema.ts";
import { ApiError, api } from "./api.ts";
import { disablePush } from "./push.ts";
import { clearLocalData } from "./store.ts";
import { syncEngine } from "./sync.ts";
import { toast } from "./ui-store.ts";

type State =
  | { status: "loading" }
  | { status: "setup" }
  | { status: "signed-out"; expired?: boolean }
  | { status: "unreachable" }
  | { status: "signed-in"; user: PublicUser };

interface AuthApi {
  state: State;
  user: PublicUser | null;
  signedIn: (user: PublicUser) => void;
  signOut: () => Promise<void>;
  retry: () => void;
}

const Ctx = createContext<AuthApi | null>(null);
const USER_KEY = "larder.user";

function cachedUser(): PublicUser | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? "null") as PublicUser | null;
  } catch {
    return null;
  }
}

function rememberUser(user: PublicUser | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // private mode: we just won't open offline next time
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const check = useCallback(() => {
    setState({ status: "loading" });
    api<AuthStatus>("/api/auth/status", { timeoutMs: 6000 })
      .then((s) => {
        if (s.setupRequired) setState({ status: "setup" });
        else if (s.user) {
          rememberUser(s.user);
          setState({ status: "signed-in", user: s.user });
        } else setState({ status: "signed-out", expired: cachedUser() != null });
      })
      .catch((err) => {
        // Offline or VPN down: open with the local copy if this device was signed in.
        const user = cachedUser();
        if (user && (!(err instanceof ApiError) || err.status === 0 || err.status >= 500)) setState({ status: "signed-in", user });
        else setState({ status: "unreachable" });
      });
  }, []);

  useEffect(check, [check]);

  useEffect(() => {
    syncEngine.onSignedOut = () => setState({ status: "signed-out", expired: true });
    syncEngine.onRejected = (reason) => toast(`A change couldn't be saved (${reason}). Reverted.`, { tone: "error" });
  }, []);

  useEffect(() => {
    if (state.status !== "signed-in") return;
    void syncEngine.start();
    void navigator.storage?.persist?.().catch(() => {});
    return () => syncEngine.stop();
  }, [state.status]);

  const signedIn = useCallback((user: PublicUser) => {
    rememberUser(user);
    setState({ status: "signed-in", user });
  }, []);

  const signOut = useCallback(async () => {
    syncEngine.stop();
    // A shared device shouldn't keep getting this household's reminders.
    await disablePush().catch(() => {});
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
    await clearLocalData();
    rememberUser(null);
    localStorage.removeItem("larder.users");
    setState({ status: "signed-out" });
  }, []);

  const user = state.status === "signed-in" ? state.user : null;
  return <Ctx.Provider value={{ state, user, signedIn, signOut, retry: check }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
