import { describe, expect, it, vi } from "vitest";

import {
  createBackdropDismissHandlers,
  shouldDismissOnBackdrop,
} from "@/lib/backdrop-dismiss";

// Stand-ins for DOM nodes. The guard only compares identity (target ===
// currentTarget), so opaque objects are enough — no DOM needed.
const backdrop = { id: "backdrop" };
const inputInsideDialog = { id: "lat-lng-input" };

/** A click/mousedown whose currentTarget is always the backdrop element. */
function eventOn(target: unknown) {
  return { target, currentTarget: backdrop };
}

describe("shouldDismissOnBackdrop", () => {
  it("dismisses only when the press both started and was released on the backdrop", () => {
    expect(shouldDismissOnBackdrop(true, true)).toBe(true);
    expect(shouldDismissOnBackdrop(false, true)).toBe(false);
    expect(shouldDismissOnBackdrop(true, false)).toBe(false);
    expect(shouldDismissOnBackdrop(false, false)).toBe(false);
  });
});

describe("createBackdropDismissHandlers", () => {
  it("closes on a plain backdrop click (press starts and releases on the backdrop)", () => {
    const onClose = vi.fn();
    const { handleMouseDown, handleClick } = createBackdropDismissHandlers(onClose);

    handleMouseDown(eventOn(backdrop));
    handleClick(eventOn(backdrop));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when a text-selection drag starts in an input and releases on the backdrop", () => {
    const onClose = vi.fn();
    const { handleMouseDown, handleClick } = createBackdropDismissHandlers(onClose);

    // User presses inside the lat/lng input and drags to select text...
    handleMouseDown(eventOn(inputInsideDialog));
    // ...then releases over the dark area; the browser fires the click on the
    // backdrop (the common ancestor of the down/up targets).
    handleClick(eventOn(backdrop));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open when the click lands on dialog content", () => {
    const onClose = vi.fn();
    const { handleMouseDown, handleClick } = createBackdropDismissHandlers(onClose);

    handleMouseDown(eventOn(inputInsideDialog));
    handleClick(eventOn(inputInsideDialog));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not get stuck: a real backdrop click after a drag-out still closes", () => {
    const onClose = vi.fn();
    const { handleMouseDown, handleClick } = createBackdropDismissHandlers(onClose);

    // First interaction: drag out of the input — must not close.
    handleMouseDown(eventOn(inputInsideDialog));
    handleClick(eventOn(backdrop));
    expect(onClose).not.toHaveBeenCalled();

    // Second interaction: genuine backdrop press+release — must close.
    handleMouseDown(eventOn(backdrop));
    handleClick(eventOn(backdrop));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
