/**
 * Shared logic for "click the backdrop to close a modal" that does NOT fire on a
 * text-selection drag.
 *
 * The bug: a backdrop rendered as `<div className="fixed inset-0" onClick={close}>`
 * closes the dialog when the user drag-selects text inside an input and releases
 * the mouse over the dark area. The browser dispatches the resulting `click` on
 * the nearest common ancestor of the mousedown and mouseup targets — the backdrop
 * — so the inner `stopPropagation` never sees it and the dialog closes, reverting
 * unsaved edits.
 *
 * The fix: dismiss ONLY when the press both STARTED and was RELEASED directly on
 * the backdrop element (`target === currentTarget` for both mousedown and click).
 */

/** A minimal mouse-event shape — only the two fields the guard inspects. */
export type BackdropPointerEvent = {
  target: unknown;
  currentTarget: unknown;
};

/**
 * Close only when the press both started and was released on the backdrop itself.
 * A drag that began inside the dialog (e.g. selecting text in an input) leaves
 * `startedOnBackdrop` false, so the dialog stays open.
 */
export function shouldDismissOnBackdrop(
  startedOnBackdrop: boolean,
  releasedOnBackdrop: boolean,
): boolean {
  return startedOnBackdrop && releasedOnBackdrop;
}

/**
 * Build stateful mousedown/click handlers for a backdrop element. The returned
 * object is framework-agnostic so it can be unit-tested without a DOM; in React
 * it is created once per modal instance and reused across renders.
 */
export function createBackdropDismissHandlers(onClose: () => void) {
  let startedOnBackdrop = false;

  return {
    handleMouseDown(event: BackdropPointerEvent) {
      startedOnBackdrop = event.target === event.currentTarget;
    },
    handleClick(event: BackdropPointerEvent) {
      const releasedOnBackdrop = event.target === event.currentTarget;
      const dismiss = shouldDismissOnBackdrop(startedOnBackdrop, releasedOnBackdrop);
      startedOnBackdrop = false;
      if (dismiss) {
        onClose();
      }
    },
  };
}
