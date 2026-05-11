"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type RenderState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

type RenderNode = React.ReactNode | ((state: RenderState) => React.ReactNode);

type CollapsibleSectionProps = {
  id: string;
  projectId: string;
  defaultOpen?: boolean;
  summary: RenderNode;
  headerAction?: RenderNode;
  actions?: RenderNode;
  children: React.ReactNode;
  dataTestid?: string;
  className?: string;
  contentClassName?: string;
};

const memoryState = new Map<string, boolean>();

function readSectionState(key: string): boolean | null {
  if (typeof window === "undefined") {
    return memoryState.get(key) ?? null;
  }

  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored === "open") return true;
    if (stored === "closed") return false;
  } catch {
    return memoryState.get(key) ?? null;
  }

  return memoryState.get(key) ?? null;
}

function writeSectionState(key: string, open: boolean) {
  memoryState.set(key, open);

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(key, open ? "open" : "closed");
  } catch {
    // The in-memory map above is the fallback for blocked sessionStorage.
  }
}

function hashMatches(id: string) {
  if (typeof window === "undefined") return false;
  return window.location.hash.replace(/^#/, "") === id;
}

function scrollSectionIntoView(section: HTMLElement | null) {
  if (!section) return;
  window.requestAnimationFrame(() => {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

export function CollapsibleSection({
  id,
  projectId,
  defaultOpen = false,
  summary,
  headerAction,
  actions,
  children,
  dataTestid,
  className = "",
  contentClassName = "",
}: CollapsibleSectionProps) {
  const panelId = useId();
  const sectionRef = useRef<HTMLElement | null>(null);
  const storageKey = `cs:${projectId}:${id}`;
  const [open, setOpenState] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(false);

  const controls = useMemo<RenderState>(
    () => ({
      open,
      setOpen: setOpenState,
      toggle: () => setOpenState((current) => !current),
    }),
    [open],
  );

  useEffect(() => {
    const shouldScroll = hashMatches(id);
    const nextOpen = hashMatches(id)
      ? true
      : readSectionState(storageKey) ?? defaultOpen;
    const frame = window.requestAnimationFrame(() => {
      setOpenState(nextOpen);
      setHydrated(true);

      if (shouldScroll) {
        scrollSectionIntoView(sectionRef.current);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [defaultOpen, id, storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    writeSectionState(storageKey, open);
  }, [hydrated, open, storageKey]);

  useEffect(() => {
    function handleHashChange() {
      if (!hashMatches(id)) return;
      setOpenState(true);
      scrollSectionIntoView(sectionRef.current);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [id]);

  const summaryNode =
    typeof summary === "function" ? summary(controls) : summary;
  const headerActionNode =
    typeof headerAction === "function" ? headerAction(controls) : headerAction;
  const actionsNode =
    headerActionNode ??
    (typeof actions === "function" ? actions(controls) : actions);

  return (
    <section
      id={id}
      ref={sectionRef}
      data-testid={dataTestid}
      className={`surface-card scroll-mt-4 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={controls.toggle}
          className="-m-1 flex min-w-0 flex-1 items-start gap-3 rounded-[var(--radius-sm)] p-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand-yellow)]"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-default)] text-sm font-bold text-[var(--text-secondary)]"
          >
            {open ? "▾" : "▸"}
          </span>
          <span className="min-w-0 flex-1">{summaryNode}</span>
        </button>
        {actionsNode ? (
          <div
            className="flex shrink-0 flex-wrap items-center justify-end gap-2"
            onClick={(event) => event.stopPropagation()}
          >
            {actionsNode}
          </div>
        ) : null}
      </div>

      {open ? (
        <div id={panelId} className={`mt-4 ${contentClassName}`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
