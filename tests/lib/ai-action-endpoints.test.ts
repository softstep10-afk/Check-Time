import { describe, expect, it } from "vitest";
import {
  getAssistantActionEndpoint,
  getAssistantActionSuccessId,
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

  it("requires a real result id before reporting a confirmed write as successful", () => {
    const projectEndpoint = getAssistantActionEndpoint({
      kind: "create_project",
      label: "Create project",
      payload: { name: "QA Project" },
    });
    const taskEndpoint = getAssistantActionEndpoint({
      kind: "create_task",
      label: "Create task",
      payload: { title: "Check tile", assignedTo: "worker-1" },
    });

    expect(projectEndpoint).not.toBeNull();
    expect(taskEndpoint).not.toBeNull();
    expect(getAssistantActionSuccessId(projectEndpoint!, { projectId: "project-1" })).toBe("project-1");
    expect(getAssistantActionSuccessId(taskEndpoint!, { taskId: "task-1" })).toBe("task-1");
    expect(getAssistantActionSuccessId(projectEndpoint!, { projectId: null })).toBeNull();
    expect(getAssistantActionSuccessId(projectEndpoint!, { projectId: "" })).toBeNull();
    expect(getAssistantActionSuccessId(taskEndpoint!, { projectId: "wrong-id" })).toBeNull();
  });
});
