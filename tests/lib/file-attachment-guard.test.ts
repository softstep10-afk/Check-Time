import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { assertTaskAttachmentMediaTargets } from "@/lib/server/file-attachment-guard";

type ChainCall = [method: string, args: unknown[]];

function makeMediaClient(result: { data: unknown; error: unknown }) {
  const calls: ChainCall[] = [];
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === "then") {
          return (
            resolve: (value: unknown) => void,
            reject: (reason?: unknown) => void,
          ) => Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          calls.push([String(prop), args]);
          return chain;
        };
      },
    },
  );

  const from = vi.fn(() => chain);

  return {
    client: { from } as unknown as Pick<SupabaseClient, "from">,
    from,
    calls,
  };
}

describe("assertTaskAttachmentMediaTargets", () => {
  it("allows same-org project attachments and dedupes ids", async () => {
    const { client, from, calls } = makeMediaClient({
      data: [
        { id: "m1", org_id: "org-1", project_id: "p1", deleted_at: null },
        { id: "m2", org_id: "org-1", project_id: "p1", deleted_at: null },
      ],
      error: null,
    });

    await expect(
      assertTaskAttachmentMediaTargets(client, {
        orgId: "org-1",
        projectId: "p1",
        mediaIds: ["m1", "m2", "m1"],
      }),
    ).resolves.toEqual(["m1", "m2"]);

    expect(from).toHaveBeenCalledWith("media");
    expect(calls).toContainEqual(["select", ["id, org_id, project_id, deleted_at"]]);
    expect(calls).toContainEqual(["in", ["id", ["m1", "m2"]]]);
  });

  it("rejects cross-org or client-spoofed attachment ids", async () => {
    const { client } = makeMediaClient({
      data: [{ id: "m1", org_id: "other-org", project_id: "p1", deleted_at: null }],
      error: null,
    });

    await expect(
      assertTaskAttachmentMediaTargets(client, {
        orgId: "org-1",
        projectId: "p1",
        mediaIds: ["m1"],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects deleted and wrong-project attachment ids", async () => {
    const deleted = makeMediaClient({
      data: [{ id: "m1", org_id: "org-1", project_id: "p1", deleted_at: "now" }],
      error: null,
    });
    await expect(
      assertTaskAttachmentMediaTargets(deleted.client, {
        orgId: "org-1",
        projectId: "p1",
        mediaIds: ["m1"],
      }),
    ).rejects.toMatchObject({ status: 404 });

    const wrongProject = makeMediaClient({
      data: [{ id: "m2", org_id: "org-1", project_id: "p2", deleted_at: null }],
      error: null,
    });
    await expect(
      assertTaskAttachmentMediaTargets(wrongProject.client, {
        orgId: "org-1",
        projectId: "p1",
        mediaIds: ["m2"],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects missing rows and masks database errors", async () => {
    const missing = makeMediaClient({ data: [], error: null });
    await expect(
      assertTaskAttachmentMediaTargets(missing.client, {
        orgId: "org-1",
        projectId: "p1",
        mediaIds: ["missing"],
      }),
    ).rejects.toMatchObject({ status: 404 });

    const dbError = makeMediaClient({ data: null, error: { message: "raw db detail" } });
    await expect(
      assertTaskAttachmentMediaTargets(dbError.client, {
        orgId: "org-1",
        projectId: "p1",
        mediaIds: ["m1"],
      }),
    ).rejects.toMatchObject({ message: "Attachment validation failed.", status: 500 });
  });
});
