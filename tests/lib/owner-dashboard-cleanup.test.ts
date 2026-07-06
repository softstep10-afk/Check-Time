import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACK_FALLBACK_PATH,
  resolveBackTarget,
} from "@/lib/nav-back";
import {
  buildShiftReviewAckEventIds,
  isShiftReviewAcknowledged,
} from "@/lib/shift-review";

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const overviewSource = readSource("src/app/(manager)/overview/page.tsx");
const commandCenterSource = readSource("src/app/(manager)/command-center/page.tsx");
const layoutSource = readSource("src/app/(manager)/layout.tsx");
const backButtonSource = readSource("src/components/shared/AppBackButton.tsx");

describe("global back button", () => {
  it("uses real history when there is somewhere to go back to", () => {
    expect(resolveBackTarget(3)).toEqual({ action: "history-back" });
    expect(resolveBackTarget(2)).toEqual({ action: "history-back" });
  });

  it("falls back to the owner dashboard when there is no history", () => {
    expect(resolveBackTarget(1)).toEqual({ action: "fallback", path: "/overview" });
    expect(resolveBackTarget(0)).toEqual({ action: "fallback", path: BACK_FALLBACK_PATH });
    expect(resolveBackTarget(null)).toEqual({ action: "fallback", path: "/overview" });
    expect(resolveBackTarget(undefined)).toEqual({ action: "fallback", path: "/overview" });
  });

  it("is mounted in the manager app shell on desktop and mobile, not on /login", () => {
    // Rendered twice: mobile sticky header + desktop top-right bar.
    const occurrences = layoutSource.split("<AppBackButton").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(layoutSource).toContain('import { AppBackButton } from "@/components/shared/AppBackButton";');
    // (manager) layout never wraps the (auth)/login route, so the button
    // cannot block login.
  });

  it("wires the button to router.back with a fallback push", () => {
    expect(backButtonSource).toContain("resolveBackTarget");
    expect(backButtonSource).toContain("router.back()");
    expect(backButtonSource).toContain("router.push(target.path)");
    expect(backButtonSource).toContain('t("nav.back")');
  });
});

describe("closed-shift review acknowledgement", () => {
  const clockOut = { id: "co-1", event_type: "clock_out", metadata: null, event_time: "2026-05-30T10:00:00Z" };

  function ackEvent(reviewed: boolean, at: string) {
    return {
      event_type: "adjust",
      event_time: at,
      metadata: {
        shift_review_ack: {
          status: "needs_review",
          reviewed_event_id: "co-1",
          reviewed_at: at,
          reviewed_by: "mgr-1",
          reviewed,
          review_state: reviewed ? "reviewed" : "needs_review",
        },
      },
    };
  }

  it("marks a closed shift reviewed once the owner acknowledges it", () => {
    const events = [clockOut, ackEvent(true, "2026-05-30T11:00:00Z")];
    const reviewedIds = buildShiftReviewAckEventIds(events);
    expect(reviewedIds.has("co-1")).toBe(true);
    expect(isShiftReviewAcknowledged(events[1].metadata)).toBe(true);
  });

  it("keeps an un-acknowledged shift out of the reviewed set", () => {
    const events = [clockOut, ackEvent(false, "2026-05-30T11:00:00Z")];
    expect(buildShiftReviewAckEventIds(events).has("co-1")).toBe(false);
  });

  it("honours the latest toggle so re-opening a review drops it from reviewed", () => {
    const events = [
      clockOut,
      ackEvent(true, "2026-05-30T11:00:00Z"),
      ackEvent(false, "2026-05-30T12:00:00Z"),
    ];
    expect(buildShiftReviewAckEventIds(events).has("co-1")).toBe(false);
  });

  it("keeps the overview closed-shift band red by excluding reviewed shifts upstream", () => {
    // Reviewed shifts leave the block entirely (dropped in the flaggedClosedShifts
    // filter), so the section always renders in the alert (red) state. The old
    // section-level green "all-reviewed/calm" branch and its unreviewed-count flag
    // were unreachable-by-design and have been removed.
    expect(overviewSource).toContain(
      '.filter((session) => session.review.status !== "normal" && !session.reviewed)',
    );
    expect(overviewSource).toContain('background: "rgba(212, 81, 94, 0.06)"');
    expect(overviewSource).toContain('borderColor: "rgba(212, 81, 94, 0.24)"');
    // the dead green section styling and its flag are gone
    expect(overviewSource).not.toContain('"rgba(15, 168, 120, 0.22)"');
    expect(overviewSource).not.toContain("const hasUnreviewedClosed");
    // the explicit reversible reviewed flag stays wired to the ack button
    expect(overviewSource).toContain("reviewed={session.reviewed}");
  });

  it("opens the best work context: project detail first, worker page as fallback", () => {
    // project detail is the primary target (closed shifts carry a projectId
    // but no task id, and there is no shift-detail route)
    expect(overviewSource).toContain("const shiftContextHref = session.projectId");
    expect(overviewSource).toContain("? `/projects/${session.projectId}`");
    expect(overviewSource).toContain(": `/team/${session.profileId}`;");
    expect(overviewSource).toContain("href={shiftContextHref}");
    // worker name still links to the team member page (who / why flagged)
    expect(overviewSource).toContain('href={`/team/${session.profileId}`}');
  });
});

describe("dashboard payroll / clock safety (must stay untouched)", () => {
  it("keeps overview hour + payroll math sourced from the existing util", () => {
    expect(overviewSource).toContain("getOverviewStats");
    // No ad-hoc time_events writes were introduced on the dashboard.
    expect(overviewSource).not.toContain('.from("time_events").insert');
    expect(commandCenterSource).not.toContain('.from("time_events").insert');
  });

  it("leaves the force-checkout control and its close flow in place", () => {
    expect(overviewSource).toContain("<ForceCheckoutButton");
  });
});

describe("removes the duplicate on-site roster", () => {
  it("drops the condensed live-crew card but keeps the detailed on-site table", () => {
    expect(overviewSource).toContain('{t("overview.currentlyOnSite")}');
    expect(overviewSource).not.toContain('{t("overview.liveCrew")}');
    expect(overviewSource).not.toContain("liveProfiles");
  });
});

describe("recent messages stay on the command center", () => {
  it("keeps the bulk message composer with read/unread history", () => {
    expect(commandCenterSource).toContain("BulkMessageComposer");
    expect(commandCenterSource).toContain("historyLimit={COMMAND_CENTER_RECENT_MESSAGE_LIMIT}");
  });
});
