"use client";

import { useCallback, useRef } from "react";
import type { HTMLAttributes, MouseEvent as ReactMouseEvent } from "react";

import { shouldDismissOnBackdrop } from "@/lib/backdrop-dismiss";

type ModalBackdropProps = Omit<HTMLAttributes<HTMLDivElement>, "onClick" | "onMouseDown"> & {
  /** Called when the backdrop itself is clicked (press started AND released on it). */
  onClose: () => void;
};

/**
 * Full-screen modal backdrop that dismisses ONLY when the press both started and
 * was released directly on the backdrop. This prevents a text-selection drag that
 * begins inside an input (and releases over the dark area) from closing the dialog
 * and discarding unsaved edits. See {@link shouldDismissOnBackdrop}.
 *
 * Drop-in replacement for `<div className="fixed inset-0 …" onClick={close}>` —
 * swap the element for `<ModalBackdrop … onClose={close}>` and keep the inner
 * dialog's `onClick={(e) => e.stopPropagation()}` as-is.
 */
export function ModalBackdrop({ onClose, children, ...rest }: ModalBackdropProps) {
  // Drag state lives in a ref and is only ever touched inside the event handlers
  // (never during render), so a stray mouseup over the backdrop can't close it.
  const startedOnBackdropRef = useRef(false);

  const handleMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    startedOnBackdropRef.current = event.target === event.currentTarget;
  }, []);

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const releasedOnBackdrop = event.target === event.currentTarget;
      const dismiss = shouldDismissOnBackdrop(startedOnBackdropRef.current, releasedOnBackdrop);
      startedOnBackdropRef.current = false;
      if (dismiss) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <div {...rest} onMouseDown={handleMouseDown} onClick={handleClick}>
      {children}
    </div>
  );
}
