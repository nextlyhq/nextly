/**
 * The seam between a write and the version it captures.
 *
 * It sits between two layers that both already understand `locale` and
 * `sourceVersionNo`, so anything it fails to forward is silently lost — and for
 * `locale` that loss is unrecoverable, because a localized snapshot holds one
 * locale's values and nothing else records which.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { captureInTx } from "../capture-in-tx";
import type { VersionCaptureService } from "../version-capture-service";

const capture = vi.fn();

function service(): VersionCaptureService {
  return { capture } as unknown as VersionCaptureService;
}

const ref = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

const tx = {} as Parameters<typeof captureInTx>[0];

describe("captureInTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capture.mockResolvedValue({ versionNo: 1 });
  });

  it("records the locale the snapshot was assembled from", async () => {
    await captureInTx(tx, service(), {
      ref,
      parts: { parentRow: { id: "e1" } },
      locale: "de",
    });

    expect(capture).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ locale: "de" })
    );
  });

  it("records no locale for an unlocalized document", async () => {
    await captureInTx(tx, service(), {
      ref,
      parts: { parentRow: { id: "e1" } },
    });

    expect(capture).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ locale: null })
    );
  });

  it("records the version a restore came from", async () => {
    await captureInTx(tx, service(), {
      ref,
      parts: { parentRow: { id: "e1" } },
      sourceVersionNo: 4,
    });

    expect(capture).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ sourceVersionNo: 4 })
    );
  });

  it("records no source version for an ordinary write", async () => {
    // Lineage is recorded, never inferred: an ordinary edit that happens to
    // reproduce an earlier state is not a restore.
    await captureInTx(tx, service(), {
      ref,
      parts: { parentRow: { id: "e1" } },
    });

    expect(capture).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ sourceVersionNo: null })
    );
  });

  it("still assembles the snapshot and normalizes the status", async () => {
    await captureInTx(tx, service(), {
      ref,
      contentStatus: "nonsense",
      parts: {
        parentRow: { id: "e1", title: "Hi" },
        manyToMany: { tags: ["t1"] },
      },
    });

    expect(capture).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        status: "published",
        snapshot: { id: "e1", title: "Hi", tags: ["t1"] },
      })
    );
  });
});
