"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Native <dialog>: browser-provided focus trap, Esc to close, inert background. */
export function Dialog({ open, onClose, title, children, wide, side }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; side?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={title}
      className={cn("bg-bg border border-line rounded-lg p-0 shadow-xl m-auto backdrop:bg-black/40",
        side ? "mr-0 ml-auto h-dvh max-h-dvh w-full max-w-[640px] rounded-none" : wide ? "w-[min(720px,calc(100vw-24px))]" : "w-[min(460px,calc(100vw-24px))]")}>
      {open && (
        <div className={cn("flex flex-col", side && "h-dvh")}>
          <div className="flex items-center justify-between border-b border-line px-4 h-12 shrink-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            <button aria-label="Close" onClick={onClose} className="rounded p-1.5 hover:bg-hover cursor-pointer"><X size={16} /></button>
          </div>
          <div className={cn("p-4", side && "overflow-y-auto flex-1")}>{children}</div>
        </div>
      )}
    </dialog>
  );
}
