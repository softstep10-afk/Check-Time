import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { assertTaskAttachmentMediaTargets } from "@/lib/server/file-attachment-guard";

type ChainCall = [method: string, args: unknown[]];

const projectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "22222222-2222-4222-8222-222222222222";
const mediaIdA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mediaIdB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
        { id: mediaIdA, org_id: "org-1", project_id: projectId, deleted_at: null },
        { id: mediaIdB, org_id: "org-1", project_id: projectId, deleted_at: null },
      ],
      error: null,
    });

    await expect(
      assertTaskAttachmentMediaTargets(client, {
        orgId: "org-1",
        projectId,
        mediaIds: [mediaIdA, mediaIdB, mediaIdA],
      }),
    ).resolves.toEqual([mediaIdA, mediaIdB]);

    expect(from).toHaveBeenCalledWith("media");
    expect(calls).toContainEqual(["select", ["id, org_id, project_id, deleted_at"]]);
    expect(calls).toContainEqual(["in", ["id", [mediaIdA, mediaIdB]]]);
  });

  it("rejects cross-org or client-spoofed attachment ids", async () => {
    const { client } = makeMediaClient({
      data: [{ id: mediaIdA, org_id: "other-org", project_id: projectId, deleted_at: null }],
      error: null,
    });

    await expect(
      assertTaskAttachmentMediaTargets(client, {
        orgId: "org-1",
        projectId,
        mediaIds: [mediaIdA],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects deleted and wrong-project attachment ids", async () => {
    const deleted = makeMediaClient({
      data: [{ id: mediaIdA, org_id: "org-1", project_id: projectId, deleted_at: "now" }],
      error: null,
    });
    await expect(
      assertTaskAttachmentMediaTargets(deleted.client, {
        orgId: "org-1",
        projectId,
        mediaIds: [mediaIdA],
      }),
    ).rejects.toMatchObject({ status: 404 });

    const wrongProject = makeMediaClient({
      data: [{ id: mediaIdB, org_id: "org-1", project_id: otherProjectId, deleted_at: null }],
      error: null,
    });
    await expect(
      assertTaskAttachmentMediaTargets(wrongProject.client, {
        orgId: "org-1",
        projectId,
        mediaIds: [mediaIdB],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects missing rows and masks database errors", async () => {
    const missing = makeMediaClient({ data: [], error: null });
    await expect(
      assertTaskAttachmentMediaTargets(missing.client, {
        orgId: "org-1",
        projectId,
        mediaIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
      }),
    ).rejects.toMatchObject({ status: 404 });

    const dbError = makeMediaClient({ data: null, error: { message: "raw db detail" } });
    await expect(
      assertTaskAttachmentMediaTargets(dbError.client, {
        orgId: "org-1",
        projectId,
        mediaIds: [mediaIdA],
      }),
    ).rejects.toMatchObject({ message: "Attachment validation failed.", status: 500 });
  });

  it("rejects invalid project or media ids before querying", async () => {
    const { client, from } = makeMediaClient({ data: [], error: null });

    await expect(
      assertTaskAttachmentMediaTargets(client, {
        orgId: "org-1",
        projectId: "project-1",
        mediaIds: [mediaIdA],
      }),
    ).rejects.toMatchObject({ message: "Invalid project id.", status: 400 });

    await expect(
      assertTaskAttachmentMediaTargets(client, {
        orgId: "org-1",
        projectId,
        mediaIds: ["media-1"],
      }),
    ).rejects.toMatchObject({ message: "Invalid attachment media id.", status: 400 });

    expect(from).not.toHaveBeenCalled();
  });
});
