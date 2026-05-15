export function isLiveRefreshBlocked(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;

  const tagName = active.tagName.toLowerCase();
  return (
    active.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    active.closest("[data-live-refresh-blocker='true']") !== null
  );
}
