"use client";
import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const control = "rounded-md border border-line-strong bg-bg text-fg placeholder:text-fg-subtle px-2.5 text-sm disabled:opacity-60 disabled:cursor-not-allowed";
const w = (c?: string) => (c && /(^|\s)w-/.test(c) ? "" : "w-full");
const h = (c: string | undefined, d: string) => (c && /(^|\s)h-/.test(c) ? "" : d);

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, w(className), h(className, "h-9"), className)} {...p} />;
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, w(className), h(className, "h-9"), "cursor-pointer", className)} {...p}>{children}</select>;
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, w(className), "py-2 min-h-24", className)} {...p} />;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" };
export function Button({ variant = "secondary", size = "md", className, type = "button", ...p }: BtnProps) {
  return (
    <button type={type}
      className={cn("inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-accent text-accent-fg hover:opacity-90",
        variant === "secondary" && "border border-line-strong bg-bg hover:bg-hover",
        variant === "ghost" && "hover:bg-hover text-fg-muted hover:text-fg",
        variant === "danger" && "bg-danger text-white hover:opacity-90", className)} {...p} />
  );
}
export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-fg-subtle">{hint}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
export function Alert({ kind = "error", children }: { kind?: "error" | "info" | "ok" | "warn"; children: ReactNode }) {
  return <div role={kind === "error" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-sm",
    kind === "error" && "bg-danger-soft border-danger/30 text-danger", kind === "info" && "bg-muted border-line text-fg-muted",
    kind === "ok" && "bg-ok-soft border-ok/30 text-ok", kind === "warn" && "bg-warn-soft border-warn/30 text-warn")}>{children}</div>;
}
export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "danger" | "warn" | "ok" | "accent"; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4",
    tone === "neutral" && "bg-muted text-fg-muted", tone === "danger" && "bg-danger-soft text-danger", tone === "warn" && "bg-warn-soft text-warn",
    tone === "ok" && "bg-ok-soft text-ok", tone === "accent" && "bg-accent-soft text-accent", className)}>{children}</span>;
}
export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  let hash = 0; for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return <span aria-hidden title={name} style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hash % 360} 38% 42%)` }}
    className="inline-flex shrink-0 items-center justify-center rounded-full text-white font-semibold">{initials}</span>;
}
