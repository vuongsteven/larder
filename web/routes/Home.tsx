import { CalendarClock, ChefHat, ListPlus, PackagePlus, ScanLine, TrendingDown } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "../components/chrome.tsx";
import { ItemRow } from "../components/ItemRow.tsx";
import { Button, Card, Section } from "../components/ui.tsx";
import { ensureOnList } from "../lib/actions.ts";
import { useAuth } from "../lib/auth.tsx";
import { isExpiringSoon, isLow, useGrocery, useItems, useLocations, useTasks } from "../lib/hooks.ts";
import { openItemEditor, openScanner, toast } from "../lib/ui-store.ts";
import { cx, daysUntil, expiryLevel, today } from "../lib/util.ts";
import { completeTaskWithToast, TaskRow } from "./Tasks.tsx";

const dateLine = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Home() {
  const { user } = useAuth();
  const items = useItems();
  const locations = useLocations() ?? [];
  const grocery = useGrocery() ?? [];
  const tasks = useTasks() ?? [];
  const navigate = useNavigate();

  const locName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const soon = useMemo(
    () => (items ?? []).filter(isExpiringSoon).sort((a, b) => (a.expiresOn ?? "").localeCompare(b.expiresOn ?? "")),
    [items],
  );
  const low = useMemo(() => (items ?? []).filter(isLow).sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const expired = soon.filter((i) => expiryLevel(i.expiresOn) === "expired").length;
  const threeDays = soon.filter((i) => daysUntil(i.expiresOn!) <= 3 && daysUntil(i.expiresOn!) >= 0).length;
  const toBuy = grocery.filter((g) => !g.checked).length;
  const dueTasks = tasks
    .filter((t) => !t.doneAt && t.dueOn && t.dueOn <= today())
    .sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));

  const stats = [
    { label: "Expired", value: expired, to: "/stock?filter=expiring", tone: expired ? "text-danger" : "" },
    { label: "Use within 3 days", value: threeDays, to: "/stock?filter=expiring", tone: threeDays ? "text-warn" : "" },
    { label: "Running low", value: low.length, to: "/stock?filter=low", tone: "" },
    { label: "On the list", value: toBuy, to: "/list", tone: "" },
  ];

  const addLowToList = async () => {
    let n = 0;
    for (const i of low) if (await ensureOnList(i)) n++;
    toast(n ? `Added ${n} item${n === 1 ? "" : "s"} to the list` : "They're all on the list already");
  };

  return (
    <>
      <PageHeader title={`${greeting()}${user ? `, ${user.name.split(" ")[0]}` : ""}`} subtitle={dateLine.format(new Date())} />

      <div className="grid grid-cols-3 gap-2 px-4 pt-2">
        <Button variant="primary" className="h-auto flex-col py-3 text-sm" onClick={() => openItemEditor(null)}>
          <PackagePlus className="size-6" /> Add item
        </Button>
        <Button className="h-auto flex-col py-3 text-sm" onClick={openScanner}>
          <ScanLine className="size-6" /> Scan
        </Button>
        <Button className="h-auto flex-col py-3 text-sm" onClick={() => navigate("/list?focus=1")}>
          <ListPlus className="size-6" /> To list
        </Button>
      </div>

      {items && items.length === 0 ? (
        <Card className="mt-6 p-5">
          <ChefHat className="mb-2 size-8 text-accent" />
          <p className="text-lg font-semibold">Welcome to your larder</p>
          <p className="mt-1 text-[15px] text-muted">
            Add what's in your pantry, fridge and freezer. Larder will tell you what to use first, build your shopping list as things run out,
            and keep everyone in the house in sync, even with no signal.
          </p>
        </Card>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 px-4">
          {stats.map((s) => (
            <Link key={s.label} to={s.to} className="rounded-2xl border border-line bg-surface p-3.5 active:bg-surface-2">
              <div className={cx("text-2xl font-bold tabular-nums", s.tone)}>{s.value}</div>
              <div className="text-[13px] text-muted">{s.label}</div>
            </Link>
          ))}
        </div>
      )}

      {soon.length > 0 && (
        <Section
          title={
            <span className="flex items-center gap-1.5">
              <CalendarClock className="size-4" /> Use soon
            </span>
          }
          action={
            soon.length > 6 && (
              <Link to="/stock?filter=expiring" className="text-sm font-medium text-accent">
                All {soon.length}
              </Link>
            )
          }
        >
          <Card>
            {soon.slice(0, 6).map((i) => (
              <ItemRow key={i.id} item={i} locationName={locName.get(i.locationId)} />
            ))}
          </Card>
        </Section>
      )}

      {low.length > 0 && (
        <Section
          title={
            <span className="flex items-center gap-1.5">
              <TrendingDown className="size-4" /> Running low
            </span>
          }
          action={
            <button type="button" onClick={addLowToList} className="text-sm font-medium text-accent">
              Add all to list
            </button>
          }
        >
          <Card>
            {low.slice(0, 6).map((i) => (
              <ItemRow key={i.id} item={i} locationName={locName.get(i.locationId)} />
            ))}
          </Card>
        </Section>
      )}

      {dueTasks.length > 0 && (
        <Section
          title="Tasks due"
          action={
            <Link to="/tasks" className="text-sm font-medium text-accent">
              All tasks
            </Link>
          }
        >
          <Card>
            {dueTasks.slice(0, 5).map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onToggle={() => void completeTaskWithToast(t)}
                onOpen={() => navigate(`/tasks?open=${t.id}`)}
              />
            ))}
          </Card>
        </Section>
      )}

      {items && items.length > 0 && soon.length === 0 && low.length === 0 && (
        <p className="mt-8 px-8 text-center text-sm text-muted">Nothing's about to go off and nothing's running low. Nice.</p>
      )}
    </>
  );
}
