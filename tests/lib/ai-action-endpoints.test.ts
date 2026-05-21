import { describe, expect, it } from "vitest";
import {
  getAssistantActionEndpoint,
  isSupportedAssistantWriteAction,
} from "@/lib/ai/action-endpoints";
import type { AssistantAction } from "@/lib/ai/types";

describe("Jarvis action endpoint mapping", () => {
  it("maps supported Jarvis write actions to real confirmation endpoints", () => {
    expect(
      getAssistantActionEndpoint({
        kind: "create_project",
        label: "Create project",
        payload: { name: "QA Project" },
      }),
    ).toEqual({
      url: "/api/ai/actions/create-project",
      successIdKey: "projectId",
    });

    expect(
      getAssistantActionEndpoint({
        kind: "create_task",
        label: "Create task",
        payload: { title: "Check tile", assignedTo: "worker-1" },
      }),
    ).toEqual({
      url: "/api/ai/actions/create-task",
      successIdKey: "taskId",
    });
  });

  it("does not invent endpoints for navigation or unsupported actions", () => {
    expect(
      getAssistantActionEndpoint({
        kind: "navigate",
        label: "Open tasks",
        href: "/tasks",
      }),
    ).toBeNull();

    const unsupported = {
      kind: "send_message",
      label: "Send message",
      payload: { recipientId: "worker-1", text: "Hello" },
    } as unknown as AssistantAction;

    expect(getAssistantActionEndpoint(unsupported)).toBeNull();
    expect(isSupportedAssistantWriteAction(unsupported)).toBe(false);
  });
});
