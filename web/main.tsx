import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider, ScrollRestoration } from "react-router";
import { useRegisterSW } from "virtual:pwa-register/react";
import { BottomNav } from "./components/chrome.tsx";
import { ItemSheets } from "./components/ItemSheets.tsx";
import { Toaster } from "./components/Toaster.tsx";
import { Spinner } from "./components/ui.tsx";
import { AuthProvider, useAuth } from "./lib/auth.tsx";
import { applyTheme } from "./lib/theme.ts";
import { toast } from "./lib/ui-store.ts";
import { Login, Setup, Unreachable } from "./routes/Auth.tsx";
import Home from "./routes/Home.tsx";
import List from "./routes/List.tsx";
import More from "./routes/More.tsx";
import Stock from "./routes/Stock.tsx";
import Tasks from "./routes/Tasks.tsx";
import "./styles.css";

applyTheme();

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Check for a new version hourly and whenever the app comes back to the foreground.
      if (!reg) return;
      setInterval(() => void reg.update(), 3_600_000);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void reg.update());
    },
  });
  useEffect(() => {
    if (needRefresh) {
      toast("A new version of Larder is ready", {
        actions: [{ label: "Reload", onClick: () => void updateServiceWorker(true) }],
        durationMs: 60_000,
      });
    }
  }, [needRefresh, updateServiceWorker]);
  return null;
}

function Shell() {
  const { state } = useAuth();
  if (state.status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  if (state.status === "setup") return <Setup />;
  if (state.status === "signed-out") return <Login expired={state.expired} />;
  if (state.status === "unreachable") return <Unreachable />;
  return (
    <div className="min-h-dvh">
      <main className="mx-auto max-w-xl" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)" }}>
        <Outlet />
      </main>
      <BottomNav />
      <ItemSheets />
      <ScrollRestoration />
    </div>
  );
}

function Root() {
  return (
    <AuthProvider>
      <Shell />
      <Toaster />
      <UpdatePrompt />
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/stock", element: <Stock /> },
      { path: "/list", element: <List /> },
      { path: "/tasks", element: <Tasks /> },
      { path: "/more", element: <More /> },
      { path: "*", element: <Home /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
