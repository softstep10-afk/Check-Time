import { describe, expect, it } from "vitest";
import { assertWorkerCanAccessProject } from "@/lib/server/project-access";
import type { SupabaseClient } from "@supabase/supabase-js";

// A tiny query-builder stub: each `.from(table)` yields a thenable/maybeSingle
// chain that resolves to the configured result for that table.
type TableResult = { data: unknown; error?: unknown };

function makeClient(results: Record<string, TableResult>): SupabaseClient {
  const client = {
    from(table: string) {
      const result = results[table] ?? { data: null, error: null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      const self = () => builder;
      builder.select = self;
      builder.eq = self;
      builder.is = self;
      builder.maybeSingle = () => Promise.resolve(result);
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return client as SupabaseClient;
}

const base = { workerId: "w-1", orgId: "org-1", projectId: "p-1" };

describe("assertWorkerCanAccessProject — list mode", () => {
  it("allows when an assignment row exists", async () => {
    const client = makeClient({ project_assignments: { data: { project_id: "p-1" }, error: null } });
    expect(await assertWorkerCanAccessProject(client, { ...base, accessMode: "list" })).toBe(true);
  });

  it("denies when there is no assignment row", async () => {
    const client = makeClient({ project_assignments: { data: null, error: null } });
    expect(await assertWorkerCanAccessProject(client, { ...base, accessMode: "list" })).toBe(false);
  });
});

describe("assertWorkerCanAccessProject — all_active mode", () => {
  it("allows for an active project with no exclusion", async () => {
    const client = makeClient({
      projects: { data: { status: "active" }, error: null },
      project_exclusions: { data: null, error: null },
    });
    expect(await assertWorkerCanAccessProject(client, { ...base, accessMode: "all_active" })).toBe(true);
  });

  it("denies for an active project the worker is excluded from", async () => {
    const client = makeClient({
      projects: { data: { status: "active" }, error: null },
      project_exclusions: { data: { id: "x-1" }, error: null },
    });
    expect(await assertWorkerCanAccessProject(client, { ...base, accessMode: "all_active" })).toBe(false);
  });

  it("denies when the project is not active (e.g. planning / archived)", async () => {
    const client = makeClient({
      projects: { data: { status: "planning" }, error: null },
      project_exclusions: { data: null, error: null },
    });
    expect(await assertWorkerCanAccessProject(client, { ...base, accessMode: "all_active" })).toBe(false);
  });

  it("denies when the project is missing / not visible", async () => {
    const client = makeClient({ projects: { data: null, error: null } });
    expect(await assertWorkerCanAccessProject(client, { ...base, accessMode: "all_active" })).toBe(false);
  });

  it("fails OPEN when the exclusion read errors (matches existing routes)", async () => {
    const client = makeClient({
      projects: { data: { status: "active" }, error: null },
      project_exclusions: { data: null, error: { message: "rls denied" } },
    });
    expect(await assertWorkerCanAccessProject(client, { ...base, accessMode: "all_active" })).toBe(true);
  });
});
