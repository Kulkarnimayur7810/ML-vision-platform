"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Alert, Button, Field, Input } from "@/components/ui/form";

export function LoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ next: string; mustChangePassword: boolean }>("/api/auth/login", { body: { email, password } });
      window.location.assign(r.mustChangePassword ? r.next : next ?? r.next);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
      <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Button type="submit" variant="primary" className="w-full" disabled={busy || !email || !password}>{busy ? "Signing in…" : "Sign in"}</Button>
      <p className="text-xs text-fg-subtle">Forgot your password? Ask a workspace admin for a new temporary one — no email is involved.</p>
    </form>
  );
}
