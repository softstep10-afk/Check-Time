import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { softDeleteMediaForActor } from "@/lib/server/media-delete";

type ChainCall = [method: string, args: unknown[]];

const mediaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeChain(result: { data?: unknown; error: unknown }, calls: ChainCall[]) {
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
  return chain;
}

function makeMediaDeleteClient({
  selectResult,
  updateResult = { data: null, error: null },
}: {
  selectResult: { data?: unknown; error: unknown };
  updateResult?: { data?: unknown; error: unknown };
}) {
  const calls: ChainCall[][] = [];
  const from = vi.fn(() => {
    const chainCalls: ChainCall[] = [];
    calls.push(chainCalls);
    return makeChain(calls.length === 1 ? selectResult : updateResult, chainCalls);
  });

  return {
    client: { from } as unknown as Pick<SupabaseClient, "from">,
    from,
    calls,
  };
}

describe("softDeleteMediaForActor", () => {
  it("rejects non-privileged actors before reading or mutating media", async () => {
    const { client, from } = makeMediaDeleteClient({
      selectResult: { data: null, error: null },
    });

    await expect(
      softDeleteMediaForActor({
        adminClient: client,
        actorProfile: { id: "manager", name: "Manager", role: "manager", org_id: "org-1" },
        mediaId,
      }),
    ).resolves.toMatchObject({ ok: false, status: 403 });

    expect(from).not.toHaveBeenCalled();
  });

  it("allows Andrey and preserves soft-delete metadata semantics", async () => {
    const { client, calls } = makeMediaDeleteClient({
      selectResult: {
        data: {
          id: mediaId,
          org_id: "org-1",
          project_id: "project-1",
          storage_path: "org-1/project-1/photo.jpg",
          media_type: "photo",
          deleted_at: null,
        },
        error: null,
      },
    });

    await expect(
      softDeleteMediaForActor({
        adminClient: client,
        actorProfile: { id: "andrey", name: "Andrey", role: "owner", org_id: "org-1" },
        mediaId,
        now: () => new Date("2026-05-22T12:00:00.000Z"),
      }),
    ).resolves.toEqual({
      ok: true,
      mediaId,
      deletedAt: "2026-05-22T12:00:00.000Z",
      alreadyDeleted: false,
    });

    expect(calls[0]).toContainEqual(["select", ["id, org_id, project_id, storage_path, media_type, deleted_at"]]);
    expect(calls[1]).toContainEqual(["update", [{ deleted_at: "2026-05-22T12:00:00.000Z" }]]);
    expect(calls[1]).toContainEqual(["eq", ["org_id", "org-1"]]);
  });

  it("allows Sergey and rejects cross-org media before update", async () => {
    const sergey = makeMediaDeleteClient({
      selectResult: {
        data: {
          id: mediaId,
          org_id: "org-1",
          project_id: "project-1",
          storage_path: "org-1/project-1/video.mov",
          media_type: "video",
          deleted_at: null,
        },
        error: null,
      },
    });

    await expect(
      softDeleteMediaForActor({
        adminClient: sergey.client,
        actorProfile: { id: "sergey", name: "Sergey", role: "admin", org_id: "org-1" },
        mediaId,
      }),
    ).resolves.toMatchObject({ ok: true });

    const crossOrg = makeMediaDeleteClient({
      selectResult: {
        data: {
          id: mediaId,
          org_id: "other-org",
          project_id: "project-1",
          storage_path: "other-org/project-1/photo.jpg",
          media_type: "photo",
          deleted_at: null,
        },
        error: null,
      },
    });

    await expect(
      softDeleteMediaForActor({
        adminClient: crossOrg.client,
        actorProfile: { id: "andrey", name: "Andrey", role: "owner", org_id: "org-1" },
        mediaId,
      }),
    ).resolves.toMatchObject({ ok: false, status: 404 });

    expect(crossOrg.from).toHaveBeenCalledTimes(1);
  });
});
