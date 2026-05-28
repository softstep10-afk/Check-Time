import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { WorkerTaskDetailModal } from "@/components/worker/WorkerTaskDetailModal";

describe("WorkerTaskDetailModal completion mode", () => {
  it("renders the visible completion comment textarea in completion mode", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(WorkerTaskDetailModal, {
          task: {
            id: "task-1",
            project_id: "project-1",
            projectName: "Home",
            assigned_to: "worker-1",
            title: "Install trim",
            description: "Finish the trim.",
            priority: "medium",
            status: "in_progress",
            due_date: null,
            metadata: {},
          },
          initialMode: "completion",
          profileId: "worker-1",
          busy: false,
          onClose: vi.fn(),
          onStart: vi.fn(),
          onDone: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('data-testid="worker-task-completion-modal"');
    expect(html).toContain('data-testid="worker-task-completion-note"');
    expect(html).toContain("Комментарий о выполнении");
    expect(html).toContain(
      "Напишите, что сделали, что осталось или что нужно знать менеджеру...",
    );
  });

  it("renders material specification items from metadata", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(WorkerTaskDetailModal, {
          task: {
            id: "task-1",
            project_id: "project-1",
            projectName: "Home",
            assigned_to: "worker-1",
            title: "Material run",
            description: null,
            priority: "medium",
            status: "pending",
            due_date: null,
            metadata: {
              category: "material",
              materialItems: [
                { name: "Screws", quantity: "2", unit: "boxes", notes: "deck screws" },
              ],
            },
          },
          profileId: "worker-1",
          busy: false,
          onClose: vi.fn(),
          onStart: vi.fn(),
          onDone: vi.fn(),
        }),
      ),
    );

    expect(html).toContain("Задача по материалам");
    expect(html).toContain("Screws");
    expect(html).toContain("deck screws");
  });
});
