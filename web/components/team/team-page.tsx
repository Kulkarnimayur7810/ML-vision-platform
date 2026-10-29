"use client";
import { useState } from "react";
import useSWR from "swr";
import { Copy, KeyRound, Trash2, UserPlus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Avatar, Badge, Button, Field, Input, Select } from "@/components/ui/form";
import { api, fetcher } from "@/lib/client/api";
import { can, ROLE_LABEL, type Role } from "@/lib/authz";

type Member = { id: string; name: string; email: string; role: Role; joinedAt: string };
type Invite = { id: string; email: string | null; role: string; expiresAt: string };
const ASSIGNABLE: Role[] = ["admin", "ml_engineer", "annotator", "member"];
const DESC: Record<Role, string> = {
  owner: "Full control of the workspace.", admin: "Manages members and board settings; everything an ML Engineer can do.",
  ml_engineer: "Datasets, annotation, training and models; can edit any task.", annotator: "Labels images; edits tasks they created or are assigned to.", member: "Views the project and works on tasks they created or are assigned to.",
};

export function TeamPage({ slug, role, me }: { slug: string; role: Role; me: string }) {
  const { data, error, mutate } = useSWR<{ members: Member[]; invites: Invite[] }>(`/api/w/${slug}/members`, fetcher, { refreshInterval: 20000 });
  const manage = can(role, "members.manage");
  const [dlg, setDlg] = useState<null | "invite" | "create">(null);
  const [secret, setSecret] = useState<{ title: string; body: string; value: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (body: Record<string, unknown>) => { setErr(null); try { const r = await api<Record<string, string>>(`/api/w/${slug}/members`, { body }); await mutate(); return r; } catch (e) { setErr((e as Error).message); } };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-lg font-semibold">Team</h1><p className="text-sm text-fg-muted">Everyone with access to this private workspace.</p></div>
        {can(role, "invites.create") && <div className="flex gap-2"><Button onClick={() => setDlg("invite")}><UserPlus size={14} />Invite link</Button><Button variant="primary" onClick={() => setDlg("create")}>Create account</Button></div>}
      </div>
      {(error || err) && <Alert>{err ?? (error as Error).message}</Alert>}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[560px] text-left text-[13px]" data-testid="members">
          <thead className="bg-subtle text-xs text-fg-subtle"><tr><th className="px-3 py-2 font-medium">Member</th><th className="font-medium">Role</th><th className="font-medium">Joined</th><th /></tr></thead>
          <tbody className="divide-y divide-line">
            {data?.members.map((m) => {
              const locked = m.role === "owner" || (m.role === "admin" && role !== "owner");
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2"><span className="flex items-center gap-2"><Avatar name={m.name} size={26} /><span><span className="font-medium">{m.name}</span>{m.id === me && <Badge className="ml-1.5">You</Badge>}<span className="block text-xs text-fg-subtle">{m.email}</span></span></span></td>
                  <td>{manage && !locked && m.id !== me
                    ? <Select aria-label={`Role for ${m.name}`} className="h-8 w-40 text-[13px]" value={m.role} onChange={(e) => act({ action: "role", userId: m.id, role: e.target.value })}>{ASSIGNABLE.filter((r) => r !== "admin" || role === "owner").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
                    : <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>}</td>
                  <td className="text-fg-muted">{new Date(m.joinedAt).toLocaleDateString()}</td>
                  <td className="pr-3 text-right">
                    {manage && !locked && m.id !== me && <span className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" aria-label={`Reset password for ${m.name}`} onClick={async () => { if (!confirm(`Reset ${m.name}'s password? They will be signed out.`)) return; const r = await act({ action: "reset", userId: m.id }); if (r?.tempPassword) setSecret({ title: "Temporary password", body: `Give this to ${m.name}. They must choose a new password at their next sign-in. It is shown only once.`, value: r.tempPassword }); }}><KeyRound size={14} /></Button>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${m.name}`} onClick={() => confirm(`Remove ${m.name} from this workspace?`) && act({ action: "remove", userId: m.id })}><Trash2 size={14} /></Button></span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!!data?.invites.length && (
        <section><h2 className="mb-2 text-sm font-semibold">Pending invitations</h2>
          <ul className="divide-y divide-line rounded-lg border border-line">{data.invites.map((i) => (
            <li key={i.id} className="flex items-center justify-between px-3 py-2 text-sm"><span>{i.email ?? "Anyone with the link"} · {ROLE_LABEL[i.role as Role]} <span className="text-xs text-fg-subtle">expires {new Date(i.expiresAt).toLocaleDateString()}</span></span>
              <Button size="sm" variant="ghost" onClick={() => act({ action: "revoke", inviteId: i.id })}>Revoke</Button></li>))}</ul>
          <p className="mt-1 text-xs text-fg-subtle">Invite links are shown only when created. Revoke and recreate one if it was lost.</p></section>
      )}
      <section><h2 className="mb-2 text-sm font-semibold">What each role can do</h2>
        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[10rem_1fr]">{(["owner", ...ASSIGNABLE] as Role[]).map((r) => <div key={r} className="contents"><dt className="font-medium">{ROLE_LABEL[r]}</dt><dd className="text-fg-muted">{DESC[r]}</dd></div>)}</dl>
        <p className="mt-2 text-xs text-fg-subtle">These rules are enforced by the server, not just hidden in the interface.</p></section>

      <InviteDialog open={dlg === "invite"} onClose={() => setDlg(null)} isOwner={role === "owner"} onCreate={async (r, email) => { const x = await act({ action: "invite", role: r, email: email || null }); if (x?.token) { setDlg(null); setSecret({ title: "Invitation link", body: "Send this link to your teammate. It works once, expires in 7 days and needs no email confirmation. It is shown only once.", value: `${location.origin}/invite/${x.token}` }); } }} />
      <CreateDialog open={dlg === "create"} onClose={() => setDlg(null)} isOwner={role === "owner"} onCreate={async (b) => { const x = await act({ action: "create", ...b }); if (x) { setDlg(null); setSecret(x.tempPassword ? { title: "Account created", body: `Give ${b.email} this temporary password. They must change it at first sign-in. It is shown only once.`, value: x.tempPassword } : { title: "Added", body: "That person already had an account and now has access to this workspace.", value: "" }); } }} />
      <Dialog open={!!secret} onClose={() => setSecret(null)} title={secret?.title ?? ""}>
        <div className="space-y-3"><p className="text-sm text-fg-muted">{secret?.body}</p>
          {secret?.value && <div className="flex gap-2"><Input readOnly aria-label="Secret value" value={secret.value} onFocus={(e) => e.target.select()} className="font-mono text-xs" /><Button onClick={() => navigator.clipboard?.writeText(secret.value)}><Copy size={14} />Copy</Button></div>}
          <div className="flex justify-end"><Button variant="primary" onClick={() => setSecret(null)}>Done</Button></div></div>
      </Dialog>
    </div>
  );
}

function InviteDialog({ open, onClose, onCreate, isOwner }: { open: boolean; onClose: () => void; onCreate: (role: string, email: string) => void; isOwner: boolean }) {
  const [r, setR] = useState("member"); const [email, setEmail] = useState("");
  return <Dialog open={open} onClose={onClose} title="Create invitation link"><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onCreate(r, email); }}>
    <Field label="Role" htmlFor="i-role"><Select id="i-role" value={r} onChange={(e) => setR(e.target.value)}>{ASSIGNABLE.filter((x) => x !== "admin" || isOwner).map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</Select></Field>
    <Field label="Restrict to email (optional)" htmlFor="i-email" hint="If set, only this email can use the link."><Input id="i-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
    <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary">Create link</Button></div></form></Dialog>;
}
function CreateDialog({ open, onClose, onCreate, isOwner }: { open: boolean; onClose: () => void; onCreate: (b: { email: string; displayName: string; role: string }) => void; isOwner: boolean }) {
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [r, setR] = useState("member");
  return <Dialog open={open} onClose={onClose} title="Create team account"><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onCreate({ email, displayName: name, role: r }); }}>
    <Field label="Name" htmlFor="a-name"><Input id="a-name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field label="Email" htmlFor="a-email"><Input id="a-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
    <Field label="Role" htmlFor="a-role"><Select id="a-role" value={r} onChange={(e) => setR(e.target.value)}>{ASSIGNABLE.filter((x) => x !== "admin" || isOwner).map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</Select></Field>
    <p className="text-xs text-fg-subtle">A temporary password is generated and shown once. No email is sent or required.</p>
    <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary">Create account</Button></div></form></Dialog>;
}
