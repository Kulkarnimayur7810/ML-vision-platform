"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Alert, Button, Field, Input } from "@/components/ui/form";
export function NewWorkspaceForm() {
  const [name, setName] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(null); try { const r = await api<{ slug: string }>("/api/workspaces", { body: { name } }); location.assign(`/w/${r.slug}`); } catch (er) { setError((er as Error).message); setBusy(false); } }}>
      {error && <Alert>{error}</Alert>}
      <Field label="Workspace name" htmlFor="n"><Input id="n" required value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Button type="submit" variant="primary" className="w-full" disabled={busy || name.trim().length < 2}>Create workspace</Button>
    </form>
  );
}
