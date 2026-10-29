"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CloudCheck,
  CloudOff,
  Maximize,
  Redo2,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Alert, Badge, Button, Textarea } from "@/components/ui/form";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { can, type Role } from "@/lib/authz";

type Box = { classIndex: number; cx: number; cy: number; w: number; h: number };
type Cls = { index: number; name: string; guideline: string };
export type AnnotationData = {
  dataset: { id: string; name: string; taskType: "detect" | "classify" };
  image: {
    id: string;
    filename: string;
    width: number;
    height: number;
    status: string;
    classIndex: number | null;
    isBackground: boolean;
    version: number;
    labeler: string | null;
    reviewer: string | null;
    reviewNote: string | null;
    url: string;
    driveFileId?: string | null;
    driveSyncStatus?: string | null;
  };
  boxes: Box[];
  classes: Cls[];
  prevId: string | null;
  nextId: string | null;
  position: number;
  total: number;
};
type Snap = { boxes: Box[]; bg: boolean };
type Drag =
  | { kind: "draw"; x0: number; y0: number }
  | { kind: "move"; i: number; dx: number; dy: number }
  | { kind: "resize"; i: number; handle: string }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number };

const COLORS = [
  "#e11d48", // rose
  "#2563eb", // blue
  "#16a34a", // green
  "#d97706", // amber
  "#9333ea", // purple
  "#0891b2", // cyan
  "#db2777", // pink
  "#65a30d", // lime
  "#ea580c", // orange
  "#4f46e5", // indigo
];
const colorOf = (i: number) => COLORS[i % COLORS.length];
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const HANDLES: [string, number, number][] = [
  ["nw", 0, 0],
  ["n", 0.5, 0],
  ["ne", 1, 0],
  ["e", 1, 0.5],
  ["se", 1, 1],
  ["s", 0.5, 1],
  ["sw", 0, 1],
  ["w", 0, 0.5],
];

export function Annotator({
  slug,
  role,
  data,
  mode,
}: {
  slug: string;
  role: Role;
  data: AnnotationData;
  mode: "label" | "review";
}) {
  const router = useRouter();
  const { image, dataset, classes } = data;
  const detect = dataset.taskType === "detect";

  const [boxes, setBoxes] = useState<Box[]>(data.boxes);
  const [bg, setBg] = useState(image.isBackground);
  const [classIndex, setClassIndex] = useState<number | null>(image.classIndex);
  const [version, setVersion] = useState(image.version);
  const [status, setStatus] = useState(image.status);
  const [reviewNote, setReviewNote] = useState(image.reviewNote);
  const [driveSyncStatus, setDriveSyncStatus] = useState(image.driveSyncStatus ?? "synced");
  const [sel, setSel] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [past, setPast] = useState<Snap[]>([]);
  const [future, setFuture] = useState<Snap[]>([]);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, w: Math.max(image.width || 1280, 100), h: Math.max(image.height || 720, 100) });
  const [draft, setDraft] = useState<Box | null>(null);
  const [note, setNote] = useState("");
  const [spaceDown, setSpaceDown] = useState(false);

  // Daily target tracking (persisted in localStorage)
  const [dailyDone, setDailyDone] = useState(0);
  useEffect(() => {
    try {
      const todayKey = `wv_annotated_${new Date().toISOString().slice(0, 10)}`;
      const val = parseInt(localStorage.getItem(todayKey) || "0", 10);
      setDailyDone(val);
    } catch {}
  }, []);

  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const draftRef = useRef<Box | null>(null);
  const boxesRef = useRef<Box[]>(boxes);
  boxesRef.current = boxes;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const versionRef = useRef(version);
  versionRef.current = version;
  const preDrag = useRef<Snap | null>(null);

  const baseUrl = `/api/w/${slug}/datasets/${dataset.id}`;
  const back = `/w/${slug}/datasets/${dataset.id}`;
  const canLabel = can(role, "annotate");
  const canReview = can(role, "review");
  const frozen = !canLabel;

  // Reconcile with server on mount or router cache
  useEffect(() => {
    let live = true;
    api<AnnotationData>(`${baseUrl}/images/${image.id}/annotation`)
      .then((fresh) => {
        if (!live || dirtyRef.current || fresh.image.version === versionRef.current) return;
        setBoxes(fresh.boxes);
        setBg(fresh.image.isBackground);
        setClassIndex(fresh.image.classIndex);
        setVersion(fresh.image.version);
        setStatus(fresh.image.status);
        setReviewNote(fresh.image.reviewNote);
        setDriveSyncStatus(fresh.image.driveSyncStatus ?? "synced");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [baseUrl, image.id]);

  // High-throughput preloading: silently fetch next image data so navigation is instantaneous
  useEffect(() => {
    if (data.nextId) {
      api<AnnotationData>(`${baseUrl}/images/${data.nextId}/annotation`)
        .then((nextData) => {
          if (nextData?.image?.url) {
            const prefetch = new window.Image();
            prefetch.src = nextData.image.url;
          }
        })
        .catch(() => {});
    }
  }, [data.nextId, baseUrl]);

  const snapshot = useCallback((): Snap => ({ boxes: boxesRef.current, bg }), [bg]);

  const commit = useCallback(
    (nb: Box[], nbg = bg) => {
      setPast((p) => [...p.slice(-99), { boxes: boxesRef.current, bg }]);
      setFuture([]);
      setBoxes(nb);
      boxesRef.current = nb;
      setBg(nbg);
      setDirty(true);
      setState("saved");
    },
    [bg]
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      setFuture((f) => [snapshot(), ...f]);
      const s = p[p.length - 1];
      setBoxes(s.boxes);
      boxesRef.current = s.boxes;
      setBg(s.bg);
      setDirty(true);
      setSel(null);
      return p.slice(0, -1);
    });
  }, [snapshot]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      setPast((p) => [...p, snapshot()]);
      const s = f[0];
      setBoxes(s.boxes);
      boxesRef.current = s.boxes;
      setBg(s.bg);
      setDirty(true);
      setSel(null);
      return f.slice(1);
    });
  }, [snapshot]);

  const save = useCallback(
    async (override?: { classIndex?: number | null }): Promise<boolean> => {
      if (frozen) return true;
      setState("saving");
      setErr(null);
      try {
        const body = detect
          ? { version, boxes: boxesRef.current, isBackground: bg }
          : {
              version,
              classIndex:
                override && "classIndex" in override ? override.classIndex : classIndex,
            };
        const r = await api<{ version: number; status: string; driveSyncStatus?: string }>(
          `${baseUrl}/images/${image.id}/annotation`,
          { method: "PUT", body }
        );
        setVersion(r.version);
        setStatus(r.status);
        if (r.driveSyncStatus) setDriveSyncStatus(r.driveSyncStatus);
        setReviewNote(null);
        setDirty(false);
        setState("saved");

        // Increment daily counter
        try {
          const todayKey = `wv_annotated_${new Date().toISOString().slice(0, 10)}`;
          const count = parseInt(localStorage.getItem(todayKey) || "0", 10) + 1;
          localStorage.setItem(todayKey, count.toString());
          setDailyDone(count);
        } catch {}

        return true;
      } catch (e) {
        if (e instanceof ApiError && e.code === "conflict") setState("conflict");
        else setState("error");
        setErr((e as Error).message);
        return false;
      }
    },
    [frozen, detect, version, bg, classIndex, baseUrl, image.id]
  );

  const go = useCallback(
    async (id: string | null, saved = false) => {
      if (!id) return;
      if (!saved && dirty && !(await save())) return;
      router.push(
        `/w/${slug}/datasets/${dataset.id}/annotate/${id}${
          mode === "review" ? "?mode=review" : ""
        }`
      );
    },
    [dirty, save, router, slug, dataset.id, mode]
  );

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // ── Coordinates and Transformation ──────────────────────────────────────────
  const toImg = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const s = svg.current;
      if (!s) return { x: 0, y: 0 };
      try {
        const ctm = s.getScreenCTM();
        if (ctm) {
          const pt = s.createSVGPoint();
          pt.x = e.clientX;
          pt.y = e.clientY;
          const p = pt.matrixTransform(ctm.inverse());
          return {
            x: clamp(p.x, 0, image.width),
            y: clamp(p.y, 0, image.height),
          };
        }
      } catch {}
      const rect = s.getBoundingClientRect();
      const rx = (e.clientX - rect.left) / rect.width;
      const ry = (e.clientY - rect.top) / rect.height;
      return {
        x: clamp(view.x + rx * view.w, 0, image.width),
        y: clamp(view.y + ry * view.h, 0, image.height),
      };
    },
    [image.width, image.height, view]
  );

  const px = useCallback(
    (b: Box) => ({
      x: (b.cx - b.w / 2) * image.width,
      y: (b.cy - b.h / 2) * image.height,
      w: b.w * image.width,
      h: b.h * image.height,
    }),
    [image.width, image.height]
  );

  const fromRect = useCallback(
    (x1: number, y1: number, x2: number, y2: number, cIdx: number): Box => {
      const l = clamp(Math.min(x1, x2), 0, image.width);
      const r = clamp(Math.max(x1, x2), 0, image.width);
      const t = clamp(Math.min(y1, y2), 0, image.height);
      const b = clamp(Math.max(y1, y2), 0, image.height);
      return {
        classIndex: cIdx,
        cx: (l + r) / 2 / (image.width || 1),
        cy: (t + b) / 2 / (image.height || 1),
        w: (r - l) / (image.width || 1),
        h: (b - t) / (image.height || 1),
      };
    },
    [image.width, image.height]
  );

  const zoomBy = useCallback(
    (f: number, at?: { x: number; y: number }) =>
      setView((v) => {
        const nw = clamp(v.w * f, image.width / 64, image.width * 2);
        const k = nw / v.w;
        const c = at ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 };
        return {
          x: c.x - (c.x - v.x) * k,
          y: c.y - (c.y - v.y) * k,
          w: nw,
          h: v.h * k,
        };
      }),
    [image.width]
  );

  const fit = useCallback(() => {
    setView({ x: 0, y: 0, w: image.width, h: image.height });
  }, [image.width, image.height]);

  // ── Pointer Interaction ───────────────────────────────────────────────────
  function onDown(e: React.PointerEvent<SVGSVGElement>) {
    // Middle button, space bar, or Shift+click (in non-detect) triggers pan
    if (e.button === 1 || spaceDown || (e.shiftKey && !detect)) {
      drag.current = {
        kind: "pan",
        sx: e.clientX,
        sy: e.clientY,
        vx: view.x,
        vy: view.y,
      };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    if (!detect || frozen || e.button !== 0) return;

    e.preventDefault();
    const p = toImg(e);
    const t = e.target as SVGElement;
    const handle = t.getAttribute("data-handle");
    const bi = t.getAttribute("data-box");

    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    // Clicked on a resize handle of the selected box
    if (handle != null && sel != null) {
      preDrag.current = { boxes: [...boxesRef.current], bg };
      drag.current = { kind: "resize", i: sel, handle };
      return;
    }

    // Clicked on an existing box to select or move
    if (bi != null) {
      const i = Number(bi);
      setSel(i);
      const r = px(boxesRef.current[i]);
      preDrag.current = { boxes: [...boxesRef.current], bg };
      drag.current = { kind: "move", i, dx: p.x - r.x, dy: p.y - r.y };
      return;
    }

    // Clicked on empty canvas: initiate new box drawing
    setSel(null);
    drag.current = { kind: "draw", x0: p.x, y0: p.y };
    const initialDraft = fromRect(p.x, p.y, p.x, p.y, active);
    draftRef.current = initialDraft;
    setDraft(initialDraft);
  }

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;

    if (d.kind === "pan") {
      const s = svg.current?.getBoundingClientRect();
      if (!s) return;
      setView((v) => ({
        ...v,
        x: d.vx - (e.clientX - d.sx) * (v.w / s.width),
        y: d.vy - (e.clientY - d.sy) * (v.h / s.height),
      }));
      return;
    }

    const p = toImg(e);

    if (d.kind === "draw") {
      const currentDraft = fromRect(d.x0, d.y0, p.x, p.y, active);
      draftRef.current = currentDraft;
      setDraft(currentDraft);
    } else if (d.kind === "move") {
      const updated = boxesRef.current.map((b, i) => {
        if (i !== d.i) return b;
        const r = px(b);
        const x = clamp(p.x - d.dx, 0, image.width - r.w);
        const y = clamp(p.y - d.dy, 0, image.height - r.h);
        return {
          ...b,
          cx: (x + r.w / 2) / image.width,
          cy: (y + r.h / 2) / image.height,
        };
      });
      boxesRef.current = updated;
      setBoxes(updated);
    } else if (d.kind === "resize") {
      const updated = boxesRef.current.map((b, i) => {
        if (i !== d.i) return b;
        const r = px(b);
        let { x, y } = r;
        let x2 = r.x + r.w;
        let y2 = r.y + r.h;
        if (d.handle.includes("w")) x = p.x;
        if (d.handle.includes("e")) x2 = p.x;
        if (d.handle.includes("n")) y = p.y;
        if (d.handle.includes("s")) y2 = p.y;
        return fromRect(x, y, x2, y2, b.classIndex);
      });
      boxesRef.current = updated;
      setBoxes(updated);
    }
  }

  function onUp(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    const pre = preDrag.current;
    drag.current = null;
    preDrag.current = null;

    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {}

    if (!d) return;

    if (d.kind === "draw") {
      const p = toImg(e);
      // Calculate final box directly from release point, eliminating async state lag
      const finalBox = fromRect(d.x0, d.y0, p.x, p.y, active);
      draftRef.current = null;
      setDraft(null);

      // Support small objects: at least 2 screen pixels or physical ~2cm
      const isReal =
        finalBox.w * image.width >= 2 && finalBox.h * image.height >= 2;
      if (isReal) {
        const nextBoxes = [...boxesRef.current, finalBox];
        commit(nextBoxes, false);
        setSel(nextBoxes.length - 1);
      }
    } else if (d.kind === "move" || d.kind === "resize") {
      if (pre && JSON.stringify(pre.boxes) !== JSON.stringify(boxesRef.current)) {
        setPast((p) => [...p.slice(-99), pre]);
        setFuture([]);
        setDirty(true);
      }
    }
  }

  function onCancel(e: React.PointerEvent<SVGSVGElement>) {
    drag.current = null;
    draftRef.current = null;
    setDraft(null);
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {}
  }

  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 1) return;
    zoomBy(e.deltaY < 0 ? 0.85 : 1.18, toImg(e));
  }

  useEffect(() => {
    const s = svg.current;
    if (!s) return;
    const h = (e: WheelEvent) => e.preventDefault();
    s.addEventListener("wheel", h, { passive: false });
    return () => s.removeEventListener("wheel", h);
  }, []);

  // ── Keyboard Shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === " ") {
        setSpaceDown(true);
        e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Escape") {
        setSel(null);
        setDraft(null);
        draftRef.current = null;
        drag.current = null;
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        sel != null &&
        detect &&
        !frozen
      ) {
        e.preventDefault();
        commit(boxesRef.current.filter((_, i) => i !== sel), bg);
        setSel(null);
        return;
      }
      if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") {
        void go(data.nextId);
        return;
      }
      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") {
        void go(data.prevId);
        return;
      }
      if (e.key.toLowerCase() === "n" && detect && !frozen && boxesRef.current.length === 0) {
        commit([], !bg);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx >= classes.length || frozen) return;
        if (detect) {
          setActive(idx);
          if (sel != null) {
            commit(
              boxesRef.current.map((b, i) => (i === sel ? { ...b, classIndex: idx } : b))
            );
          }
        } else {
          setClassIndex(idx);
          setDirty(true);
          void save({ classIndex: idx }).then((ok) => {
            if (ok && data.nextId) void go(data.nextId, true);
          });
        }
      }
      if (e.key === "+" || e.key === "=") zoomBy(0.8);
      if (e.key === "-") zoomBy(1.25);
      if (e.key === "0") fit();
    }
    const up = (e: KeyboardEvent) => e.key === " " && setSpaceDown(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", up);
    };
  }, [detect, frozen, sel, bg, classes.length, active, zoomBy, fit, save, undo, redo, go, data.nextId, data.prevId, commit]);

  const labelStatus = useMemo(
    () =>
      ({
        unlabeled: ["Unlabeled", "neutral"],
        labeled: ["Labeled — awaiting review", "accent"],
        approved: ["Approved", "ok"],
        needs_fixes: ["Needs fixes", "warn"],
      } as const)[status as "unlabeled"] ?? ["", "neutral"],
    [status]
  );
  const strokeW = Math.max(1.5, view.w / 450);
  const handleR = Math.max(4, view.w / 140);

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col md:flex-row">
      {/* ── Main Canvas Area ── */}
      <div className="relative min-h-0 flex-1 bg-muted overflow-hidden">
        <svg
          ref={svg}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className={cn(
            "absolute inset-0 h-full w-full touch-none select-none",
            detect && !frozen ? "cursor-crosshair" : "",
            spaceDown && "cursor-grab"
          )}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onWheel={onWheel}
          data-testid="canvas"
          role="img"
          aria-label={`${image.filename}, ${boxes.length} boxes`}
        >
          {/* Background image without browser drag interference */}
          <image
            href={image.url}
            x={0}
            y={0}
            width={image.width}
            height={image.height}
            preserveAspectRatio="none"
            style={{ pointerEvents: "none", userSelect: "none" }}
          />

          {/* Saved and active bounding boxes */}
          {detect &&
            boxes.map((b, i) => {
              const r = px(b);
              const c = colorOf(b.classIndex);
              const on = sel === i;
              return (
                <g key={i}>
                  <rect
                    data-box={i}
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    fill={c}
                    fillOpacity={on ? 0.25 : 0.12}
                    stroke={c}
                    strokeWidth={on ? strokeW * 2 : strokeW}
                    className={frozen ? "" : "cursor-move"}
                  />
                  <text
                    x={r.x + strokeW * 2}
                    y={Math.max(r.y - strokeW * 2, view.w / 60)}
                    fontSize={Math.max(11, view.w / 55)}
                    fill={c}
                    fontWeight="600"
                    stroke="#fff"
                    strokeWidth={view.w / 900}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {classes[b.classIndex]?.name ?? "?"}
                  </text>
                  {/* 8 Control Handles for Resizing */}
                  {on &&
                    !frozen &&
                    HANDLES.map(([h, fx, fy]) => (
                      <rect
                        key={h}
                        data-handle={h}
                        x={r.x + r.w * fx - handleR}
                        y={r.y + r.h * fy - handleR}
                        width={handleR * 2}
                        height={handleR * 2}
                        fill="#fff"
                        stroke={c}
                        strokeWidth={strokeW}
                        className={
                          h === "n" || h === "s"
                            ? "cursor-ns-resize"
                            : h === "e" || h === "w"
                            ? "cursor-ew-resize"
                            : h === "nw" || h === "se"
                            ? "cursor-nwse-resize"
                            : "cursor-nesw-resize"
                        }
                      />
                    ))}
                </g>
              );
            })}

          {/* Live drafting rectangle while drawing */}
          {draft &&
            (() => {
              const r = px(draft);
              const dc = colorOf(draft.classIndex);
              return (
                <g pointerEvents="none">
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    fill={dc}
                    fillOpacity={0.2}
                    stroke={dc}
                    strokeWidth={strokeW * 1.5}
                    strokeDasharray={`${strokeW * 4} ${strokeW * 3}`}
                  />
                  <text
                    x={r.x + strokeW * 2}
                    y={Math.max(r.y - strokeW * 2, view.w / 60)}
                    fontSize={Math.max(11, view.w / 55)}
                    fill={dc}
                    fontWeight="600"
                    stroke="#fff"
                    strokeWidth={view.w / 900}
                    paintOrder="stroke"
                  >
                    {classes[draft.classIndex]?.name}
                  </text>
                </g>
              );
            })()}
        </svg>

        {/* Zoom & Fit Toolbar Overlay */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-md border border-line bg-bg p-1 shadow">
          <button
            aria-label="Zoom in"
            className="rounded p-1.5 hover:bg-hover cursor-pointer"
            onClick={() => zoomBy(0.8)}
            title="Zoom in (+)"
          >
            <ZoomIn size={15} />
          </button>
          <button
            aria-label="Zoom out"
            className="rounded p-1.5 hover:bg-hover cursor-pointer"
            onClick={() => zoomBy(1.25)}
            title="Zoom out (-)"
          >
            <ZoomOut size={15} />
          </button>
          <button
            aria-label="Fit to screen"
            className="rounded p-1.5 hover:bg-hover cursor-pointer"
            onClick={fit}
            title="Fit to screen (0)"
          >
            <Maximize size={15} />
          </button>
          <span className="px-1.5 text-xs text-fg-subtle">
            {Math.round((image.width / view.w) * 100)}%
          </span>
        </div>
      </div>

      {/* ── Sidebar Tools & Metadata ── */}
      <aside
        className="flex max-h-[45dvh] w-full shrink-0 flex-col overflow-y-auto border-t border-line bg-bg md:max-h-none md:w-80 md:border-l md:border-t-0"
        aria-label="Annotation tools"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <Link href={back} className="text-[13px] text-fg-muted hover:text-fg">
            ← {dataset.name}
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg-subtle" data-testid="position">
              {data.position} / {data.total}
            </span>
            <span
              className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-fg-muted"
              title="Daily progress target (1,000 images/day)"
            >
              Today: {dailyDone}/1000
            </span>
          </div>
        </div>

        <div className="space-y-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium" title={image.filename}>
              {image.filename}
            </span>
            <div className="flex items-center gap-1.5">
              <Badge tone={labelStatus[1] as never}>{labelStatus[0]}</Badge>
              {image.driveFileId && (
                <span
                  title={
                    driveSyncStatus === "synced"
                      ? "Labels synced to Google Drive"
                      : "Pending write to Google Drive"
                  }
                  className="inline-flex items-center text-xs text-fg-subtle"
                >
                  {driveSyncStatus === "synced" ? (
                    <CloudCheck size={14} className="text-ok" />
                  ) : (
                    <CloudOff size={14} className="text-warn" />
                  )}
                </span>
              )}
            </div>
          </div>

          {status === "needs_fixes" && reviewNote && (
            <Alert kind="warn">Reviewer note: {reviewNote}</Alert>
          )}
          {frozen && <Alert kind="info">Your role can view labels but not change them.</Alert>}
          {state === "conflict" && (
            <Alert>
              {err}{" "}
              <button className="underline cursor-pointer" onClick={() => router.refresh()}>
                Reload labels
              </button>
            </Alert>
          )}
          {state === "error" && <Alert>{err}</Alert>}

          {/* Class Selector */}
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              {detect ? "Draw with class" : "This image shows"}
            </h3>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Classes">
              {classes.map((c, i) => {
                const on = detect ? active === i : classIndex === i;
                return (
                  <button
                    key={c.index}
                    disabled={frozen}
                    aria-pressed={on}
                    title={c.guideline || undefined}
                    onClick={() => {
                      if (detect) {
                        setActive(i);
                        if (sel != null) {
                          commit(
                            boxesRef.current.map((b, k) => (k === sel ? { ...b, classIndex: i } : b))
                          );
                        }
                      } else {
                        setClassIndex(i);
                        setDirty(true);
                        void save({ classIndex: i }).then((ok) => {
                          if (ok && data.nextId) void go(data.nextId, true);
                        });
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] cursor-pointer disabled:cursor-default transition-colors",
                      on
                        ? "border-fg bg-muted font-medium ring-1 ring-fg"
                        : "border-line hover:bg-hover"
                    )}
                  >
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: colorOf(i) }}
                    />
                    {c.name}
                    <kbd className="text-[10px] text-fg-subtle">{i < 9 ? i + 1 : ""}</kbd>
                  </button>
                );
              })}
            </div>
            {detect && (
              <p className="mt-1.5 text-xs text-fg-subtle">
                Drag on the image to draw a box. Click a box to move, resize, or delete it.
              </p>
            )}
          </div>

          {/* Bounding Box List & Edit Controls */}
          {detect && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                Boxes ({boxes.length})
              </h3>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto" data-testid="box-list">
                {boxes.map((b, i) => (
                  <li key={i}>
                    <button
                      onClick={() => setSel(i)}
                      aria-pressed={sel === i}
                      className={cn(
                        "flex w-full items-center justify-between rounded px-2 py-1 text-left text-[13px] cursor-pointer",
                        sel === i ? "bg-muted font-medium" : "hover:bg-hover"
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ background: colorOf(b.classIndex) }}
                        />
                        {classes[b.classIndex]?.name}
                      </span>
                      <span className="text-xs text-fg-subtle">
                        {Math.round(b.w * image.width)}×{Math.round(b.h * image.height)}px
                      </span>
                    </button>
                  </li>
                ))}
                {!boxes.length && (
                  <li className="px-2 py-1 text-[13px] text-fg-subtle">No boxes yet.</li>
                )}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={frozen || sel == null}
                  onClick={() => {
                    commit(boxesRef.current.filter((_, i) => i !== sel));
                    setSel(null);
                  }}
                  title="Delete selected box (Del)"
                >
                  <Trash2 size={14} />
                  Delete
                </Button>
                <Button
                  size="sm"
                  disabled={!past.length}
                  onClick={undo}
                  aria-label="Undo"
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 size={14} />
                </Button>
                <Button
                  size="sm"
                  disabled={!future.length}
                  onClick={redo}
                  aria-label="Redo"
                  title="Redo (Ctrl+Y)"
                >
                  <Redo2 size={14} />
                </Button>
              </div>
              <label
                className={cn(
                  "mt-2 flex items-center gap-2 text-[13px]",
                  boxes.length || frozen ? "opacity-50" : ""
                )}
              >
                <input
                  type="checkbox"
                  checked={bg}
                  disabled={boxes.length > 0 || frozen}
                  onChange={(e) => commit([], e.target.checked)}
                />
                No objects in this image <kbd className="text-[10px] text-fg-subtle">N</kbd>
              </label>
            </div>
          )}

          {/* Save & Save & Next controls */}
          {canLabel && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => save()}
                  disabled={state === "saving" || (!dirty && state !== "error")}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  onClick={() => go(data.nextId)}
                  disabled={!data.nextId}
                  title="Save and advance to next image (D / →)"
                >
                  Save &amp; next <ArrowRight size={14} />
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs" role="status" data-testid="save-state">
                <span>
                  {state === "saving" ? (
                    "Saving…"
                  ) : dirty ? (
                    <span className="text-warn">Unsaved changes</span>
                  ) : state === "saved" ? (
                    <span className="text-ok">All changes saved</span>
                  ) : (
                    ""
                  )}
                </span>
                {image.driveFileId && (
                  <span className="text-[11px] text-fg-subtle">
                    {driveSyncStatus === "synced" ? "Drive: Saved" : "Drive: Pending"}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Review Workflow Section */}
          {canReview &&
            (status === "labeled" || mode === "review") &&
            status !== "unlabeled" && (
              <div className="space-y-2 border-t border-line pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                  Review
                </h3>
                <Textarea
                  aria-label="Review note"
                  placeholder="What needs fixing? (required to send back)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={dirty}
                    onClick={async () => {
                      try {
                        await api(`${baseUrl}/images/${image.id}/review`, {
                          body: { decision: "approve" },
                        });
                        setErr(null);
                        await go(data.nextId, true);
                        router.refresh();
                      } catch (e) {
                        setErr((e as Error).message);
                        setState("error");
                      }
                    }}
                  >
                    <Check size={14} />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    disabled={dirty}
                    onClick={async () => {
                      try {
                        await api(`${baseUrl}/images/${image.id}/review`, {
                          body: { decision: "needs_fixes", note },
                        });
                        await go(data.nextId, true);
                        router.refresh();
                      } catch (e) {
                        setErr((e as Error).message);
                        setState("error");
                      }
                    }}
                  >
                    Needs fixes
                  </Button>
                </div>
                {dirty && <p className="text-xs text-fg-subtle">Save your changes before reviewing.</p>}
              </div>
            )}

          {/* Navigation Controls */}
          <div className="flex items-center justify-between border-t border-line pt-3">
            <Button
              size="sm"
              onClick={() => go(data.prevId)}
              disabled={!data.prevId}
              aria-label="Previous image"
              title="Previous image (A / ←)"
            >
              <ArrowLeft size={14} />
              Prev
            </Button>
            <Button
              size="sm"
              onClick={() => go(data.nextId)}
              disabled={!data.nextId}
              aria-label="Next image"
              title="Next image (D / →)"
            >
              Next
              <ArrowRight size={14} />
            </Button>
          </div>

          <details className="text-xs text-fg-muted">
            <summary className="cursor-pointer font-medium">Keyboard shortcuts</summary>
            <ul className="mt-1.5 space-y-0.5">
              <li>
                <kbd>1–9</kbd> choose class / reclass box
              </li>
              <li>
                <kbd>Ctrl/⌘+S</kbd> save
              </li>
              <li>
                <kbd>Ctrl/⌘+Z</kbd> undo · <kbd>Ctrl+Shift+Z</kbd> redo
              </li>
              <li>
                <kbd>Del</kbd> / <kbd>Backspace</kbd> delete selected box
              </li>
              <li>
                <kbd>D</kbd> / <kbd>→</kbd> save &amp; next · <kbd>A</kbd> / <kbd>←</kbd> previous
              </li>
              <li>
                <kbd>N</kbd> mark “no objects”
              </li>
              <li>
                <kbd>Space</kbd>+drag pan · <kbd>+</kbd>/<kbd>−</kbd>/<kbd>0</kbd> zoom
              </li>
            </ul>
          </details>
        </div>
      </aside>
    </div>
  );
}
