import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("review queue and audit clarity source guards", () => {
  const overviewPage = readSource("src/app/(manager)/overview/page.tsx");
  const timelinePage = readSource("src/app/(manager)/timeline/page.tsx");
  const ackButton = readSource("src/components/manager/ShiftReviewAckButton.tsx");
  const teamMemberPage = readSource("src/components/manager/TeamMemberPage.tsx");
  const auditPage = readSource("src/app/(manager)/admin/audit/page.tsx");

  it("keeps the Overview map out of the main dashboard body", () => {
    expect(overviewPage).not.toContain("FullscreenMapWrapper");
    expect(overviewPage).not.toContain("activeWorkerMarkers");
  });

  it("stores review queue state as an explicit reversible metadata flag", () => {
    expect(ackButton).toContain("const reviewedAt = new Date().toISOString()");
    expect(ackButton).toContain("event_time: reviewedAt");
    expect(ackButton).toContain("reviewed_at: reviewedAt");
    expect(ackButton).toContain("reviewed: nextReviewed");
    expect(ackButton).toContain("review_state: nextReviewed ? \"reviewed\" : \"needs_review\"");
    expect(overviewPage).toContain("reviewed={session.reviewed}");
    expect(timelinePage).toContain("reviewed={reviewed}");
  });

  it("forces dashboard refreshes to read fresh review acknowledgements", () => {
    expect(overviewPage).toContain("export const revalidate = 0;");
    expect(ackButton).toContain("router.refresh()");
  });

  it("keeps the dashboard review queue active-only while Timeline keeps reviewed history", () => {
    expect(overviewPage).toContain("const closedShiftReviewQueue = closedShiftReviewCandidates.filter");
    expect(overviewPage).toContain("isShiftReviewRiskActive(session.review, session.reviewAck)");
    expect(overviewPage).toContain("const closedShiftAlerts = closedShiftReviewQueue.slice(0, 8);");
    expect(overviewPage).toContain("shiftReview.closedShiftQueueEmpty");
    expect(timelinePage).toContain("reviewed && ack");
    expect(timelinePage).toContain("ShiftReviewAckButton");
  });

  it("records manual hour audit before and after values without changing payroll math", () => {
    expect(teamMemberPage).toContain("before_unpaid_minutes");
    expect(teamMemberPage).toContain("after_unpaid_minutes");
    expect(teamMemberPage).toContain("reason");
    expect(auditPage).toContain("buildHourAuditDetail");
    expect(auditPage).toContain("Changed by");
    expect(auditPage).toContain("Before");
    expect(auditPage).toContain("After");
  });
});
