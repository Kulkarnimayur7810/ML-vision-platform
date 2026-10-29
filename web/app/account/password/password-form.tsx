"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Alert, Button, Field, Input } from "@/components/ui/form";

export function PasswordForm({ forced }: { forced: boolean }) {
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (next !== again) return setError("The new passwords don't match.");
    setBusy(true);
    try { const r = await api<{ next: string }>("/api/auth/password", { body: { current, next } }); window.location.assign(r.next); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Field label={forced ? "Temporary password" : "Current password"} htmlFor="cur"><Input id="cur" type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus /></Field>
      <Field label="New password" htmlFor="new" hint="At least 10 characters; must not contain your name or email."><Input id="new" type="password" required value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
      <Field label="Repeat new password" htmlFor="again"><Input id="again" type="password" required value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></Field>
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save password"}</Button>
    </form>
  );
}
