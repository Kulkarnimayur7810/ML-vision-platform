"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Alert, Button, Field, Input } from "@/components/ui/form";

export function InviteForm({ token, fixedEmail }: { token: string; fixedEmail: string | null }) {
  const [email, setEmail] = useState(fixedEmail ?? "");
  const [displayName, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api<{ next: string }>(`/api/auth/invite/${token}`, { body: { email, displayName, password } }); window.location.assign(r.next); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Field label="Your name" htmlFor="name"><Input id="name" required value={displayName} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus /></Field>
      <Field label="Email" htmlFor="email"><Input id="email" type="email" required value={email} readOnly={!!fixedEmail} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></Field>
      <Field label="Password" htmlFor="pw" hint="At least 10 characters; must not contain your name or email."><Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
    </form>
  );
}
