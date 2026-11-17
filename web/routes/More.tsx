import { ArrowDown, ArrowUp, Database, Download, LogOut, MapPin, Moon, Plus, RefreshCw, Share, Smartphone, Trash2, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { LOCATION_KINDS, type LocationKind, type PublicUser, type Row } from "../../shared/schema.ts";
import { PageHeader } from "../components/chrome.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { Button, Card, Field, Input, Section, Select } from "../components/ui.tsx";
import { deleteLocation } from "../lib/actions.ts";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { useItems, useLocations, usePendingCount, useSyncStatus } from "../lib/hooks.ts";
import { clearLocalData, save } from "../lib/store.ts";
import { syncEngine } from "../lib/sync.ts";
import { getTheme, setTheme, type ThemePref } from "../lib/theme.ts";
import { toast } from "../lib/ui-store.ts";
import { cx, relativeTime } from "../lib/util.ts";

function Row({ icon, label, detail, onClick, danger }: { icon: React.ReactNode; label: string; detail?: React.ReactNode; onClick?: () => void; danger?: boolean }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cx("flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0", onClick && "active:bg-surface-2", danger && "text-danger")}
    >
      <span className={cx("shrink-0", danger ? "text-danger" : "text-muted")}>{icon}</span>
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      {detail && <span className="shrink-0 text-sm text-muted">{detail}</span>}
    </Comp>
  );
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export default function More() {
  const { user, signOut } = useAuth();
  const status = useSyncStatus();
  const pending = usePendingCount();
  const [theme, setThemeState] = useState<ThemePref>(getTheme());
  const [sheet, setSheet] = useState<null | "password" | "member" | "location" | "signout" | "reset">(null);
  const [editLoc, setEditLoc] = useState<Row<"locations"> | null>(null);
  const [members, setMembers] = useState<PublicUser[]>([]);
  const locations = useLocations() ?? [];
  const items = useItems() ?? [];
  const isOwner = user?.role === "owner";

  const loadMembers = () => api<{ users: PublicUser[] }>("/api/users").then((r) => setMembers(r.users), () => {});
  useEffect(() => {
    void loadMembers();
  }, []);

  const move = async (index: number, dir: -1 | 1) => {
    const other = locations[index + dir];
    const me = locations[index];
    if (!other) return;
    // Renumber everything so ties from older data can't stick.
    const order = locations.map((l) => l.id);
    order.splice(index, 1);
    order.splice(index + dir, 0, me.id);
    for (const [i, id] of order.entries()) await save("locations", id, { sort: i });
  };

  const syncLabel =
    status.state === "offline"
      ? "Offline"
      : status.state === "error"
        ? "Problem"
        : status.state === "syncing"
          ? "Syncing…"
          : status.lastSyncAt
            ? relativeTime(status.lastSyncAt)
            : "Not yet";

  return (
    <>
      <PageHeader title="More" />

      <Section title="You">
        <Card>
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft font-bold text-accent">{user?.name.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{user?.name}</p>
              <p className="truncate text-sm text-muted">
                @{user?.username} · {user?.role === "owner" ? "Owner" : "Member"}
              </p>
            </div>
          </div>
          <Row icon={<RefreshCw className="size-5" />} label="Change password" onClick={() => setSheet("password")} />
          <Row icon={<LogOut className="size-5" />} label="Sign out" onClick={() => setSheet("signout")} danger />
        </Card>
      </Section>

      <Section
        title="Household"
        action={
          isOwner && (
            <button type="button" className="flex items-center gap-1 text-sm font-medium text-accent" onClick={() => setSheet("member")}>
              <UserPlus className="size-4" /> Add
            </button>
          )
        }
      >
        <Card>
          {members.length === 0 && <Row icon={<Users className="size-5" />} label="Members" detail="Connect to see" />}
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <Users className="size-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {m.name} {m.id === user?.id && <span className="text-muted">(you)</span>}
                </p>
                <p className="text-sm text-muted">@{m.username}</p>
              </div>
              {isOwner && m.role === "member" && (
                <button
                  type="button"
                  aria-label={`Remove ${m.name}`}
                  className="flex size-9 items-center justify-center rounded-full text-danger active:bg-danger-soft"
                  onClick={async () => {
                    if (!confirm(`Remove ${m.name} from the household? They'll be signed out everywhere.`)) return;
                    try {
                      await api(`/api/users/${m.id}`, { method: "DELETE" });
                      await loadMembers();
                    } catch (e) {
                      toast((e as Error).message, { tone: "error" });
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </Card>
      </Section>

      <Section
        title="Storage places"
        action={
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-medium text-accent"
            onClick={() => {
              setEditLoc(null);
              setSheet("location");
            }}
          >
            <Plus className="size-4" /> Add
          </button>
        }
      >
        <Card>
          {locations.map((l, i) => (
            <div key={l.id} className="flex items-center border-b border-line last:border-b-0">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
                onClick={() => {
                  setEditLoc(l);
                  setSheet("location");
                }}
              >
                <MapPin className="size-5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
                <span className="text-sm text-muted">{items.filter((x) => x.locationId === l.id).length}</span>
              </button>
              <button type="button" aria-label={`Move ${l.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="flex size-10 items-center justify-center text-muted disabled:opacity-30">
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${l.name} down`}
                disabled={i === locations.length - 1}
                onClick={() => move(i, 1)}
                className="mr-1 flex size-10 items-center justify-center text-muted disabled:opacity-30"
              >
                <ArrowDown className="size-4" />
              </button>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Appearance">
        <Card className="p-1.5">
          <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Theme">
            {(["system", "light", "dark"] as ThemePref[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={theme === t}
                onClick={() => {
                  setTheme(t);
                  setThemeState(t);
                }}
                className={cx("flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-medium capitalize", theme === t ? "bg-accent text-accent-ink" : "text-muted")}
              >
                {t === "dark" && <Moon className="size-4" />}
                {t === "system" ? "Automatic" : t}
              </button>
            ))}
          </div>
        </Card>
      </Section>

      <Section title="Sync & data">
        <Card>
          <Row icon={<RefreshCw className={cx("size-5", status.state === "syncing" && "animate-spin")} />} label="Sync now" detail={syncLabel} onClick={() => void syncEngine.syncNow()} />
          <Row icon={<Database className="size-5" />} label="Changes waiting to sync" detail={pending} />
          {status.error && status.state !== "idle" && <p className="border-b border-line px-4 py-2 text-sm text-danger">{status.error}</p>}
          <a href="/api/export" download className="flex items-center gap-3 border-b border-line px-4 py-3 active:bg-surface-2">
            <Download className="size-5 text-muted" />
            <span className="flex-1 font-medium">Export everything (JSON)</span>
          </a>
          {isOwner && (
            <a href="/api/backup" download className="flex items-center gap-3 border-b border-line px-4 py-3 active:bg-surface-2">
              <Database className="size-5 text-muted" />
              <span className="flex-1 font-medium">Download database backup</span>
            </a>
          )}
          <Row icon={<Trash2 className="size-5" />} label="Clear this device's copy" onClick={() => setSheet("reset")} danger />
        </Card>
      </Section>

      {!isStandalone() && (
        <Section title="Install">
          <Card className="p-4">
            <p className="flex items-center gap-2 font-medium">
              <Smartphone className="size-5 text-accent" /> Put Larder on your home screen
            </p>
            <p className="mt-1 text-sm text-muted">
              {isIOS() ? (
                <>
                  In Safari, tap <Share className="inline size-4 align-text-bottom" /> Share, then <b>Add to Home Screen</b>. It opens full-screen and keeps working offline.
                </>
              ) : (
                <>Use your browser's menu and choose Install app or Add to Home screen. It opens full-screen and keeps working offline.</>
              )}
            </p>
          </Card>
        </Section>
      )}

      <p className="mt-8 mb-4 text-center text-xs text-muted">Larder 1.0 · self-hosted</p>

      {sheet === "password" && <PasswordSheet onClose={() => setSheet(null)} />}
      {sheet === "member" && <MemberSheet onClose={() => setSheet(null)} onAdded={loadMembers} />}
      {sheet === "location" && <LocationSheet loc={editLoc} locations={locations} itemCount={editLoc ? items.filter((x) => x.locationId === editLoc.id).length : 0} onClose={() => setSheet(null)} />}
      {sheet === "signout" && (
        <ConfirmSheet
          title="Sign out?"
          body={
            pending > 0
              ? `${pending} change${pending === 1 ? " hasn't" : "s haven't"} synced yet and will be lost. Connect first if you want to keep ${pending === 1 ? "it" : "them"}.`
              : "This device's copy of the household's data will be removed. It comes back when you sign in again."
          }
          action="Sign out"
          onConfirm={signOut}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "reset" && (
        <ConfirmSheet
          title="Clear this device's copy?"
          body={
            pending > 0
              ? `${pending} unsynced change${pending === 1 ? "" : "s"} will be lost. Everything else downloads again from the server.`
              : "Everything downloads again from the server. Use this if something looks out of date."
          }
          action="Clear and re-download"
          onConfirm={async () => {
            syncEngine.stop();
            await clearLocalData();
            await syncEngine.start();
            await syncEngine.syncNow();
            toast("Re-downloaded from the server");
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}

function ConfirmSheet({ title, body, action, onConfirm, onClose }: { title: string; body: string; action: string; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title={title}>
      <p className="text-[15px] text-muted">{body}</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
              onClose();
            }
          }}
        >
          {action}
        </Button>
      </div>
    </Sheet>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      await api("/api/auth/password", { body: { current, next } });
      toast("Password changed. Other devices have been signed out.");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Sheet open onClose={onClose} title="Change password" footer={<Button variant="primary" size="lg" className="w-full" onClick={submit} disabled={!current || next.length < 8}>Change password</Button>}>
      <div className="space-y-4">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 8 characters">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        {error && <p className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}

function MemberSheet({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      await api("/api/users", { body: { name, username, password } });
      toast(`${name} can now sign in as @${username.toLowerCase()}`);
      onAdded();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Add a household member"
      footer={
        <Button variant="primary" size="lg" className="w-full" onClick={submit} disabled={!name || !username || password.length < 8}>
          Add member
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">They'll share everything in this larder. Give them the username and password; they can change the password after signing in.</p>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Username">
          <Input autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <Input type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}

const KIND_LABEL: Record<LocationKind, string> = { pantry: "Cupboard / pantry", fridge: "Fridge", freezer: "Freezer", other: "Other" };

function LocationSheet({ loc, locations, itemCount, onClose }: { loc: Row<"locations"> | null; locations: Row<"locations">[]; itemCount: number; onClose: () => void }) {
  const [name, setName] = useState(loc?.name ?? "");
  const [kind, setKind] = useState<LocationKind>(loc?.kind ?? "pantry");
  const others = locations.filter((l) => l.id !== loc?.id);
  const [moveTo, setMoveTo] = useState<string>(others[0]?.id ?? "");

  const submit = async () => {
    if (!name.trim()) return;
    await save("locations", loc?.id ?? null, loc ? { name: name.trim(), kind } : { name: name.trim(), kind, sort: locations.length });
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={loc ? `Edit ${loc.name}` : "New storage place"}
      footer={
        <Button variant="primary" size="lg" className="w-full" onClick={submit} disabled={!name.trim()}>
          Save
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Garage freezer" autoFocus={!loc} />
        </Field>
        <Field label="Kind" hint="Used to suggest where new things go">
          <Select value={kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
            {LOCATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        {loc && others.length > 0 && (
          <div className="rounded-2xl border border-line bg-surface p-3.5">
            <p className="font-medium">Delete {loc.name}</p>
            {itemCount > 0 && (
              <Field label={`Move its ${itemCount} item${itemCount === 1 ? "" : "s"} to`} className="mt-2">
                <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                  <option value="">Delete them too</option>
                </Select>
              </Field>
            )}
            <Button
              variant="danger"
              className="mt-3 w-full"
              onClick={async () => {
                await deleteLocation(loc.id, itemCount > 0 ? moveTo || null : null);
                toast(`Deleted ${loc.name}`);
                onClose();
              }}
            >
              <Trash2 className="size-4" /> Delete place
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
