import { describe, expect, it } from "vitest";
import {
  isBrowserUnsafeVideo,
  selectMediaPlayback,
} from "@/lib/media-playback";

const baseOriginal = {
  storage_path: "org-1/proj-1/2026-04-29/1727000000-checkout.mov",
  mime_type: "video/quicktime",
};

describe("selectMediaPlayback", () => {
  it("falls back to the original when metadata has no playback fields", () => {
    const r = selectMediaPlayback({ ...baseOriginal, metadata: {} });
    expect(r.path).toBe(baseOriginal.storage_path);
    expect(r.mimeType).toBe("video/quicktime");
    expect(r.isPlaybackVersion).toBe(false);
    expect(r.transcodingStatus).toBeNull();
  });

  it("falls back to the original when metadata is null", () => {
    const r = selectMediaPlayback({ ...baseOriginal, metadata: null });
    expect(r.path).toBe(baseOriginal.storage_path);
    expect(r.isPlaybackVersion).toBe(false);
  });

  it("returns the playback copy when status is ready and a path is set", () => {
    const r = selectMediaPlayback({
      ...baseOriginal,
      metadata: {
        playback_path: "org-1/proj-1/2026-04-29/1727000000-checkout-playback.mp4",
        playback_mime_type: "video/mp4",
        transcoding_status: "ready",
      },
    });
    expect(r.path).toBe("org-1/proj-1/2026-04-29/1727000000-checkout-playback.mp4");
    expect(r.mimeType).toBe("video/mp4");
    expect(r.isPlaybackVersion).toBe(true);
    expect(r.transcodingStatus).toBe("ready");
  });

  it("defaults playback mime to video/mp4 when metadata omits it", () => {
    const r = selectMediaPlayback({
      ...baseOriginal,
      metadata: {
        playback_path: "playback/x.mp4",
        transcoding_status: "ready",
      },
    });
    expect(r.mimeType).toBe("video/mp4");
  });

  it("does NOT switch to the playback path when status is pending", () => {
    const r = selectMediaPlayback({
      ...baseOriginal,
      metadata: {
        playback_path: "playback/x.mp4",
        transcoding_status: "pending",
      },
    });
    expect(r.path).toBe(baseOriginal.storage_path);
    expect(r.isPlaybackVersion).toBe(false);
    expect(r.transcodingStatus).toBe("pending");
  });

  it("does NOT switch to the playback path when status is failed", () => {
    const r = selectMediaPlayback({
      ...baseOriginal,
      metadata: {
        playback_path: "playback/x.mp4",
        transcoding_status: "failed",
        transcoding_error: "ffmpeg crashed",
      },
    });
    expect(r.path).toBe(baseOriginal.storage_path);
    expect(r.isPlaybackVersion).toBe(false);
    expect(r.transcodingStatus).toBe("failed");
    expect(r.transcodingError).toBe("ffmpeg crashed");
  });

  it("ignores unknown status strings", () => {
    const r = selectMediaPlayback({
      ...baseOriginal,
      metadata: { transcoding_status: "haunted" },
    });
    expect(r.transcodingStatus).toBeNull();
  });

  it("ignores empty-string playback_path", () => {
    const r = selectMediaPlayback({
      ...baseOriginal,
      metadata: { playback_path: "", transcoding_status: "ready" },
    });
    expect(r.path).toBe(baseOriginal.storage_path);
    expect(r.isPlaybackVersion).toBe(false);
  });

  it("does NOT route a Mux playback ID into the Storage path", () => {
    // Regression: an earlier transcode-route bug wrote the Mux playback ID
    // into metadata.playback_path. Signing it through Supabase Storage
    // failed for the manager Open button. The selector must keep
    // mux_playback_id separate and continue to serve the original file
    // until a Storage-path transcoded copy exists.
    const r = selectMediaPlayback({
      ...baseOriginal,
      metadata: {
        mux_asset_id: "asset_abc",
        mux_playback_id: "mux-playback-xyz",
        transcoding_status: "ready",
      },
    });
    expect(r.path).toBe(baseOriginal.storage_path);
    expect(r.isPlaybackVersion).toBe(false);
    expect(r.muxPlaybackId).toBe("mux-playback-xyz");
    expect(r.transcodingStatus).toBe("ready");
  });

  it("exposes mux_playback_id on the playback info", () => {
    const r = selectMediaPlayback({
      ...baseOriginal,
      metadata: { mux_playback_id: "id_42" },
    });
    expect(r.muxPlaybackId).toBe("id_42");
  });

  it("returns muxPlaybackId=null when metadata omits it", () => {
    const r = selectMediaPlayback({ ...baseOriginal, metadata: {} });
    expect(r.muxPlaybackId).toBeNull();
  });
});

describe("isBrowserUnsafeVideo", () => {
  it("flags video/quicktime as unsafe", () => {
    expect(
      isBrowserUnsafeVideo({
        storage_path: "x/y/checkout.mp4",
        mime_type: "video/quicktime",
        metadata: {},
      }),
    ).toBe(true);
  });

  it("flags .mov path even when mime_type is missing", () => {
    expect(
      isBrowserUnsafeVideo({
        storage_path: "x/y/checkout.mov",
        mime_type: null,
        metadata: {},
      }),
    ).toBe(true);
  });

  it("does not flag video/mp4", () => {
    expect(
      isBrowserUnsafeVideo({
        storage_path: "x/y/clip.mp4",
        mime_type: "video/mp4",
        metadata: {},
      }),
    ).toBe(false);
  });

  it("does not flag video/webm", () => {
    expect(
      isBrowserUnsafeVideo({
        storage_path: "x/y/clip.webm",
        mime_type: "video/webm",
        metadata: {},
      }),
    ).toBe(false);
  });
});
