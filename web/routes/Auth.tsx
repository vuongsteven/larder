import { WifiOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { PublicUser } from "../../shared/schema.ts";
import { Button, Field, Input, Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";

function Logo() {
  return <img src="/favicon.svg" alt="" className="mx-auto mb-4 size-16 rounded-2xl" />;
}

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="pt-safe pb-safe flex min-h-dvh flex-col justify-center px-6">
      <div className="mx-auto w-full max-w-sm">
        <Logo />
        <h1 className="text-center text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-center text-[15px] text-muted">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

export function Login({ expired }: { expired?: boolean }) {
  const { signedIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: PublicUser }>("/api/auth/login", { body: { username, password } });
      signedIn(user);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Shell title="Larder" subtitle={expired ? "Your session ended. Sign in to carry on syncing; nothing on this device is lost." : "Sign in to your household"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Username">
          <Input autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <p className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : "Sign in"}
        </Button>
      </form>
    </Shell>
  );
}

export function Setup() {
  const { signedIn } = useAuth();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: PublicUser }>("/api/auth/setup", { body: { name, username, password } });
      signedIn(user);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Shell title="Set up Larder" subtitle="Create the owner account. You can add the rest of the household afterwards.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name">
          <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Username" hint="Letters, numbers, dots, dashes">
          <Input autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        {error && <p className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : "Create household"}
        </Button>
      </form>
    </Shell>
  );
}

export function Unreachable() {
  const { retry } = useAuth();
  return (
    <Shell title="Can't reach Larder" subtitle="Check you're connected to your home network or VPN, then try again.">
      <div className="flex flex-col items-center gap-4">
        <WifiOff className="size-10 text-muted" />
        <Button variant="primary" size="lg" className="w-full" onClick={retry}>
          Try again
        </Button>
      </div>
    </Shell>
  );
}
