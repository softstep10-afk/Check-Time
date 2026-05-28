import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const workerShell = read("src/components/worker/WorkerShell.tsx");
const workerProjects = read("src/components/worker/WorkerProjectsList.tsx");
const workerProjectView = read("src/components/worker/WorkerProjectView.tsx");
const clockPage = read("src/components/worker/ClockPage.tsx");
const tasksPage = read("src/components/worker/TasksPage.tsx");
const messagesPage = read("src/components/worker/WorkerMessagesPage.tsx");
const notificationBell = read("src/components/worker/NotificationBell.tsx");
const journalPage = read("src/components/worker/JournalPage.tsx");
const gpsConsent = read("src/components/worker/GpsConsentModal.tsx");
const safetyBrief = read("src/components/worker/SafetyBriefModal.tsx");
const checkoutModal = read("src/components/worker/CheckoutModal.tsx");

describe("worker mobile critical path audit source guards", () => {
  it("keeps worker shell navigation, offline status, GPS consent, and Safety Brief paths present", () => {
    expect(workerShell).toContain('data-testid="worker-mobile-top-nav"');
    expect(workerShell).toContain('data-testid="worker-offline-status-bar"');
    expect(workerShell).toContain("<GpsConsentModal");
    expect(workerProjectView).toContain("<SafetyBriefModal");
    expect(workerShell).toContain("queueTaskClaim");
    expect(workerShell).toContain("drainOfflineQueue");
    expect(gpsConsent).toContain("canConfirmGpsConsent(agreed, signedName)");
    expect(safetyBrief).toContain("createPortal");
    expect(safetyBrief).toContain("height: \"100dvh\"");
  });

  it("keeps project open, navigation, active badge, media, notes, and checkout visible in worker project flow", () => {
    expect(workerProjects).toContain('data-testid="worker-project-card-main-link"');
    expect(workerProjects).toContain("href={`/project/${project.id}`}");
    expect(workerProjects).toContain("<ProjectNavigationActions");
    expect(workerProjects).toContain("workerProject.activeShiftHere");
    expect(workerProjectView).toContain("<ProjectNavigationActions");
    expect(workerProjectView).toContain('data-testid="active-project-checkout-button"');
    expect(workerProjectView).toContain("<ProjectMediaLibrary");
    expect(workerProjectView).toContain('data-testid="worker-project-public-notes"');
    expect(workerProjectView).toContain("accept={ACCEPT_ALL_UPLOADS}");
    expect(checkoutModal).toContain('data-testid="checkout-confirm"');
    expect(clockPage).toContain("<CheckoutModal open={checkoutOpen}");
  });

  it("keeps task, material, message, journal, and upload paths guarded", () => {
    expect(tasksPage).toContain("/api/worker/claim-task");
    expect(tasksPage).toContain("queueTaskClaim(taskId)");
    expect(tasksPage).toContain("worker-task-mark-done-card");
    expect(tasksPage).toContain("isMaterialTask(task)");
    expect(messagesPage).toContain("buildPrivateMessageParticipantFilter");
    expect(messagesPage).toContain('filter: `sender_id=eq.${shell.profile.id}`');
    expect(messagesPage).toContain('filter: `recipient_id=eq.${shell.profile.id}`');
    expect(notificationBell).toContain("markMessagesReadById");
    expect(journalPage).toContain("<MediaViewerModal");
    expect(journalPage).toContain("accept={ACCEPT_ALL_UPLOADS}");
  });
});
