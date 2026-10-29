import type { ReactNode } from "react";
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh grid place-items-center px-4 py-10 bg-subtle">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center gap-2">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-fg text-sm font-bold">W</span>
          <span className="font-semibold">WasteVision AI</span>
        </div>
        <div className="rounded-lg border border-line bg-bg p-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        <p className="mt-4 text-center text-xs text-fg-subtle">Private workspace — access is by invitation only.</p>
      </div>
    </main>
  );
}
