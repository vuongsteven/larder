import { Check, ChevronDown, ListChecks, Repeat, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import type { Row } from "../../shared/schema.ts";
import { PageHeader } from "../components/chrome.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { Button, Card, Chip, Empty, Field, Input, Section, Select, Textarea } from "../components/ui.tsx";
import { completeTask, reopenTask } from "../lib/actions.ts";
import { useTasks } from "../lib/hooks.ts";
import { remove, save } from "../lib/store.ts";
import { toast } from "../lib/ui-store.ts";
import { addDays, cx, daysUntil, relativeDay, today } from "../lib/util.ts";

const REPEATS: [string, number | null][] = [
  ["Doesn't repeat", null],
  ["Every day", 1],
  ["Every 3 days", 3],
  ["Every week", 7],
  ["Every 2 weeks", 14],
  ["Every month", 30],
  ["Every 3 months", 91],
];

function repeatLabel(days: number) {
  return REPEATS.find(([, d]) => d === days)?.[0] ?? `Every ${days} days`;
}

export async function completeTaskWithToast(t: Row<"tasks">) {
  await completeTask(t);
  if (t.repeatDays) toast(`Done · next due ${relativeDay(addDays(today(), t.repeatDays))}`);
  else toast(`Done: ${t.title}`, { actions: [{ label: "Undo", onClick: () => void reopenTask(t) }] });
}

export function TaskRow({ task, onToggle, onOpen }: { task: Row<"tasks">; onToggle: () => void; onOpen: () => void }) {
  const done = task.doneAt != null;
  const overdue = !done && task.dueOn != null && daysUntil(task.dueOn) < 0;
  const dueToday = !done && task.dueOn != null && daysUntil(task.dueOn) === 0;
  return (
    <div className="flex items-center border-b border-line last:border-b-0">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark ${task.title} not done` : `Complete ${task.title}`}
        onClick={onToggle}
        className="flex size-12 shrink-0 items-center justify-center"
      >
        <span
          className={cx(
            "flex size-6 items-center justify-center rounded-full border-2",
            done ? "border-accent bg-accent text-accent-ink" : overdue ? "border-danger" : "border-muted/60",
          )}
        >
          {done && <Check className="size-4" strokeWidth={3} />}
        </span>
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-3 pr-4 text-left active:bg-surface-2">
        <span className={cx("block truncate font-medium", done && "text-muted line-through")}>{task.title}</span>
        {(task.dueOn || task.repeatDays) && (
          <span className={cx("mt-0.5 flex items-center gap-1.5 text-[13px]", overdue ? "text-danger" : dueToday ? "text-warn" : "text-muted")}>
            {task.dueOn && !done && (overdue ? `Overdue · ${relativeDay(task.dueOn)}` : `Due ${relativeDay(task.dueOn)}`)}
            {task.repeatDays && (
              <span className="inline-flex items-center gap-1 text-muted">
                <Repeat className="size-3.5" /> {repeatLabel(task.repeatDays).toLowerCase()}
              </span>
            )}
          </span>
        )}
      </button>
    </div>
  );
}

export default function Tasks() {
  const tasks = useTasks();
  const [params, setParams] = useSearchParams();
  const [title, setTitle] = useState("");
  const [showDone, setShowDone] = useState(false);
  const openId = params.get("open");
  const editing = openId === "new" ? null : (tasks?.find((t) => t.id === openId) ?? undefined);

  const groups = useMemo(() => {
    const open = (tasks ?? []).filter((t) => !t.doneAt);
    const byDue = (a: Row<"tasks">, b: Row<"tasks">) => (a.dueOn ?? "").localeCompare(b.dueOn ?? "") || a.title.localeCompare(b.title);
    const t = today();
    return {
      overdue: open.filter((x) => x.dueOn && x.dueOn < t).sort(byDue),
      today: open.filter((x) => x.dueOn === t).sort(byDue),
      upcoming: open.filter((x) => x.dueOn && x.dueOn > t).sort(byDue),
      someday: open.filter((x) => !x.dueOn).sort((a, b) => a._at - b._at),
      done: (tasks ?? []).filter((x) => x.doneAt).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, 30),
    };
  }, [tasks]);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    await save("tasks", null, { title: t });
    setTitle("");
  };

  const open = (id: string) => setParams({ open: id }, { replace: false });
  const close = () => setParams({}, { replace: true });

  const list = (label: string, items: Row<"tasks">[], tone?: string) =>
    items.length > 0 && (
      <Section title={<span className={tone}>{label}</span>}>
        <Card>
          {items.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={() => void completeTaskWithToast(t)} onOpen={() => open(t.id)} />
          ))}
        </Card>
      </Section>
    );

  const empty = tasks && tasks.length === 0;

  return (
    <>
      <PageHeader title="Tasks" />
      <form
        className="flex gap-2 px-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task, e.g. Defrost chicken" enterKeyHint="done" />
        <Button type="submit" variant="primary" disabled={!title.trim()}>
          Add
        </Button>
      </form>

      {empty ? (
        <Empty icon={<ListChecks className="size-7" />} title="No tasks yet">
          Kitchen jobs like "clean out the fridge" or "defrost dinner". Set them to repeat and they'll come back when due.
        </Empty>
      ) : (
        <>
          {list("Overdue", groups.overdue, "text-danger")}
          {list("Today", groups.today)}
          {list("Upcoming", groups.upcoming)}
          {list("Any time", groups.someday)}
          {groups.done.length > 0 && (
            <Section>
              <button type="button" onClick={() => setShowDone((s) => !s)} className="mb-2 flex items-center gap-1 px-4 text-sm font-medium text-muted">
                <ChevronDown className={cx("size-4 transition-transform", !showDone && "-rotate-90")} /> Done ({groups.done.length})
              </button>
              {showDone && (
                <Card>
                  {groups.done.map((t) => (
                    <TaskRow key={t.id} task={t} onToggle={() => void reopenTask(t)} onOpen={() => open(t.id)} />
                  ))}
                </Card>
              )}
            </Section>
          )}
        </>
      )}

      {editing !== undefined && openId && <TaskEditor key={openId} task={editing} onClose={close} />}
    </>
  );
}

function TaskEditor({ task, onClose }: { task: Row<"tasks"> | null; onClose: () => void }) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [dueOn, setDueOn] = useState<string | null>(task?.dueOn ?? null);
  const [repeat, setRepeat] = useState<number | null>(task?.repeatDays ?? null);
  const [custom, setCustom] = useState(task?.repeatDays != null && !REPEATS.some(([, d]) => d === task.repeatDays));

  useEffect(() => {
    if (repeat && !dueOn) setDueOn(addDays(today(), repeat));
  }, [repeat, dueOn]);

  const submit = async () => {
    if (!title.trim()) return;
    const data = { title: title.trim(), notes, dueOn, repeatDays: repeat };
    await save("tasks", task?.id ?? null, data);
    onClose();
  };

  const presets: [string, string | null][] = [
    ["No date", null],
    ["Today", today()],
    ["Tomorrow", addDays(today(), 1)],
    ["In a week", addDays(today(), 7)],
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      title={task ? "Edit task" : "New task"}
      footer={
        <div className="flex gap-2">
          {task && (
            <Button
              variant="danger"
              aria-label="Delete task"
              className="w-12 px-0"
              onClick={async () => {
                await remove("tasks", task.id);
                onClose();
                toast(`Deleted ${task.title}`);
              }}
            >
              <Trash2 className="size-5" />
            </Button>
          )}
          <Button variant="primary" size="lg" className="flex-1" onClick={submit} disabled={!title.trim()}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Task">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!task} />
        </Field>
        <Field label="Due" group>
          <div className="no-scrollbar -mx-5 mb-2 flex gap-2 overflow-x-auto px-5">
            {presets.map(([label, value]) => (
              <Chip key={label} active={dueOn === value} onClick={() => setDueOn(value)}>
                {label}
              </Chip>
            ))}
          </div>
          <Input type="date" aria-label="Due date" value={dueOn ?? ""} onChange={(e) => setDueOn(e.target.value || null)} />
        </Field>
        <Field label="Repeat" group hint={repeat ? "When you tick it off, it comes back this long after." : undefined}>
          <Select
            aria-label="Repeat"
            value={custom ? "custom" : String(repeat ?? "")}
            onChange={(e) => {
              if (e.target.value === "custom") {
                setCustom(true);
                setRepeat(repeat ?? 10);
              } else {
                setCustom(false);
                setRepeat(e.target.value ? Number(e.target.value) : null);
              }
            }}
          >
            {REPEATS.map(([label, d]) => (
              <option key={label} value={d ?? ""}>
                {label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </Select>
          {custom && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-muted">Every</span>
              <Input aria-label="Repeat every N days" inputMode="numeric" className="w-20" value={repeat ?? ""} onChange={(e) => setRepeat(Math.min(366, Math.max(1, Number(e.target.value) || 1)))} />
              <span className="text-sm text-muted">days</span>
            </div>
          )}
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional" />
        </Field>
      </div>
    </Sheet>
  );
}
