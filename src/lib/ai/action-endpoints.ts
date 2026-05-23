import type { AssistantAction } from "@/lib/ai/types";

export type AssistantWriteActionKind = Exclude<AssistantAction["kind"], "navigate">;

export type AssistantActionEndpoint = {
  url: string;
  successIdKey: "projectId" | "taskId";
};

export type AssistantActionEndpointResult = {
  error?: string;
  projectId?: string | null;
  taskId?: string | null;
};

export function getAssistantActionEndpoint(
  action: AssistantAction,
): AssistantActionEndpoint | null {
  switch (action.kind) {
    case "create_project":
      return {
        url: "/api/ai/actions/create-project",
        successIdKey: "projectId",
      };
    case "create_task":
      return {
        url: "/api/ai/actions/create-task",
        successIdKey: "taskId",
      };
    case "navigate":
      return null;
    default:
      return null;
  }
}

export function getAssistantActionSuccessId(
  endpoint: AssistantActionEndpoint,
  result: AssistantActionEndpointResult,
): string | null {
  const value = result[endpoint.successIdKey];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function isSupportedAssistantWriteAction(action: AssistantAction): boolean {
  return action.kind !== "navigate" && getAssistantActionEndpoint(action) !== null;
}
