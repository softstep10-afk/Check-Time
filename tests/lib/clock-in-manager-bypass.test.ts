import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Step 3 finalize — privileged roles (owner/admin/manager) bypass the worker
// project-access gate on clock-in; worker/driver roles still 403 on an
// unassigned list-mode project. The role comes from the server-derived session
// profile, never the request body.

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({ role: "worker" as string }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "w-1" } }, error: null }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => {
  const project = {
    id: "11111111-1111-4111-8111-111111111111",
    org_id: "org-1",
    site_point: null,
    gps_radius_m: null,
    radius_m: null,
    settings: null,
  };
  const insertedEvent = { id: "evt-1", event_type: "clock_in", project_id: project.id };

  function pick(ctx: { table: string; mutating: boolean }) {
    switch (ctx.table) {
      case "profiles":
        return ctx.mutating
          ? { data: null, error: null }
          : {
              data: {
                id: "w-1",
                org_id: "org-1",
                role: state.role,
                require_video: false,
                current_project: null,
                is_active: true,
                project_access_mode: "list",
              },
              error: null,
            };
      case "time_events":
        // read = dedup (none); mutate = the inserted clock_in row.
        return ctx.mutating ? { data: insertedEvent, error: null } : { data: null, error: null };
      case "projects":
        return { data: project, error: null };
      case "project_assignments":
        return { data: null, error: null }; // unassigned
      default:
        return { data: null, error: null };
    }
  }

  function from(table: string) {
    const ctx = { table, mutating: false };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    const self = () => b;
    b.select = self;
    b.eq = self;
    b.is = self;
    b.contains = self;
    b.order = self;
    b.limit = self;
    b.insert = () => {
      ctx.mutating = true;
      return b;
    };
    b.update = () => {
      ctx.mutating = true;
      return b;
    };
    b.maybeSingle = () => Promise.resolve(pick(ctx));
    b.single = () => Promise.resolve(pick(ctx));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.then = (res: any, rej: any) => Promise.resolve(pick(ctx)).then(res, rej);
    return b;
  }

  return { createAdminClient: () => ({ from }) };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/worker/clock-in/route";

function clockInReq() {
  return new NextRequest("http://localhost/api/worker/clock-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: "11111111-1111-4111-8111-111111111111",
      eventTime: new Date().toISOString(),
    }),
  });
}

beforeEach(() => {
  state.role = "worker";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("worker clock-in — privileged-role access bypass", () => {
  it("lets a manager clock into an UNASSIGNED list-mode project (bypass → not 403)", async () => {
    state.role = "manager";
    const res = await POST(clockInReq());
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  it("still 403s a worker on the same unassigned list-mode project", async () => {
    state.role = "worker";
    const res = await POST(clockInReq());
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Project is not available to this worker.");
  });
});
