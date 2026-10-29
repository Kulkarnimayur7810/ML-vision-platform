"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";
import { Bell, ChevronsUpDown, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, KeyRound } from "lucide-react";
import { NAV } from "./nav";
import { cn } from "@/lib/cn";
import { api, fetcher } from "@/lib/client/api";
import { Avatar } from "@/components/ui/form";
import { ROLE_LABEL, type Role } from "@/lib/authz";

type Props = { slug: string; workspaceName: string; role: Role; user: { id: string; name: string; email: string }; workspaces: { slug: string; name: string }[]; children: ReactNode };
type Notifs = { items: { id: number; title: string; href: string | null; read: boolean; at: string }[]; unread: number };

function useDismiss(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, close]);
}

export function Shell({ slug, workspaceName, role, user, workspaces, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/w/${slug}`;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menu, setMenu] = useState<null | "bell" | "user" | "ws">(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [q, setQ] = useState("");
  const { data: notifs, mutate } = useSWR<Notifs>(`/api/w/${slug}/notifications`, fetcher, { refreshInterval: 30000 });
  useDismiss(!!menu, () => setMenu(null));
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("wv-nav") === "1"); } catch {}
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);
  useEffect(() => { setMobileOpen(false); setMenu(null); }, [pathname]);

  function toggleTheme() {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t); document.documentElement.dataset.theme = t;
    try { localStorage.setItem("wv-theme", t); } catch {}
  }
  function toggleNav() { setCollapsed((c) => { try { localStorage.setItem("wv-nav", c ? "0" : "1"); } catch {} return !c; }); }
  async function signOut() { await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {}); location.assign("/login"); }

  const active = NAV.find((n) => n.href !== "" && pathname.startsWith(base + n.href)) ?? NAV[0];
  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="relative px-2 py-2">
        <button onClick={() => setMenu(menu === "ws" ? null : "ws")} aria-haspopup="menu" aria-expanded={menu === "ws"}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover cursor-pointer">
          <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent text-accent-fg text-xs font-bold">W</span>
          {!collapsed && <><span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">{workspaceName}</span><ChevronsUpDown size={14} className="text-fg-subtle" /></>}
        </button>
        {menu === "ws" && (
          <div role="menu" className="absolute left-2 top-12 z-30 w-56 rounded-md border border-line bg-bg p-1 shadow-lg">
            {workspaces.map((w) => <Link role="menuitem" key={w.slug} href={`/w/${w.slug}`} className="block rounded px-2 py-1.5 text-sm hover:bg-hover">{w.name}</Link>)}
          </div>
        )}
      </div>
      <ul className="flex-1 space-y-0.5 px-2 py-1">
        {NAV.map((n) => {
          const on = n.key === active.key;
          return (
            <li key={n.key}>
              <Link href={base + n.href} aria-current={on ? "page" : undefined} title={collapsed ? n.label : undefined}
                className={cn("flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px]", on ? "bg-muted font-medium text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}>
                <n.icon size={16} aria-hidden /> {!collapsed && n.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="hidden border-t border-line p-2 md:block">
        <button onClick={toggleNav} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover cursor-pointer">
          {collapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /> Collapse</>}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex h-dvh bg-bg text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-bg focus:p-2">Skip to content</a>
      <aside className={cn("hidden shrink-0 border-r border-line bg-subtle md:block", collapsed ? "w-14" : "w-56")}>{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-label="Navigation">
          <button aria-label="Close navigation" className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-64 border-r border-line bg-subtle">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
          <button className="rounded p-2 hover:bg-hover md:hidden cursor-pointer" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={18} /></button>
          <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[13px] text-fg-muted sm:flex">
            <Link href={base} className="truncate hover:text-fg">{workspaceName}</Link>
            {active.key !== "overview" && <><span aria-hidden>/</span><Link href={base + active.href} className="text-fg">{active.label}</Link></>}
          </nav>
          <form className="mx-auto hidden max-w-sm flex-1 md:block" role="search" onSubmit={(e) => { e.preventDefault(); router.push(`${base}/kanban?q=${encodeURIComponent(q)}`); }}>
            <label className="relative block">
              <span className="sr-only">Search tasks</span>
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks by title or #number" className="h-8 w-full rounded-md border border-line bg-subtle pl-8 pr-2 text-[13px]" />
            </label>
          </form>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} className="rounded p-2 hover:bg-hover cursor-pointer">{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>
            <div className="relative">
              <button onClick={() => setMenu(menu === "bell" ? null : "bell")} aria-label={`Notifications${notifs?.unread ? `, ${notifs.unread} unread` : ""}`} aria-expanded={menu === "bell"} className="relative rounded p-2 hover:bg-hover cursor-pointer">
                <Bell size={16} />{!!notifs?.unread && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">{notifs.unread}</span>}
              </button>
              {menu === "bell" && (
                <div className="absolute right-0 top-10 z-30 w-80 max-w-[calc(100vw-24px)] rounded-md border border-line bg-bg shadow-lg">
                  <div className="flex items-center justify-between border-b border-line px-3 py-2"><span className="text-sm font-medium">Notifications</span>
                    {!!notifs?.unread && <button className="text-xs text-accent cursor-pointer" onClick={async () => { await api(`/api/w/${slug}/notifications`, { body: {} }); mutate(); }}>Mark all read</button>}</div>
                  <ul className="max-h-80 overflow-y-auto">
                    {!notifs?.items.length && <li className="px-3 py-6 text-center text-sm text-fg-subtle">Nothing yet. You'll be notified when tasks are assigned to you.</li>}
                    {notifs?.items.map((n) => (
                      <li key={n.id}><Link href={n.href ?? base} onClick={() => api(`/api/w/${slug}/notifications`, { body: { ids: [n.id] } }).then(() => mutate())} className={cn("block border-b border-line px-3 py-2 text-[13px] hover:bg-hover", !n.read && "bg-accent-soft")}>
                        {n.title}<span className="block text-xs text-fg-subtle">{new Date(n.at).toLocaleString()}</span></Link></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="relative">
              <button onClick={() => setMenu(menu === "user" ? null : "user")} aria-label="Account menu" aria-expanded={menu === "user"} className="rounded-full p-1 hover:bg-hover cursor-pointer"><Avatar name={user.name} size={26} /></button>
              {menu === "user" && (
                <div role="menu" className="absolute right-0 top-10 z-30 w-60 rounded-md border border-line bg-bg p-1 shadow-lg">
                  <div className="px-2 py-1.5"><div className="truncate text-sm font-medium">{user.name}</div><div className="truncate text-xs text-fg-subtle">{user.email}</div><div className="mt-0.5 text-xs text-fg-subtle">{ROLE_LABEL[role]}</div></div>
                  <hr className="my-1 border-line" />
                  <Link role="menuitem" href="/account/password" className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-hover"><KeyRound size={14} /> Change password</Link>
                  <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-hover cursor-pointer"><LogOut size={14} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
