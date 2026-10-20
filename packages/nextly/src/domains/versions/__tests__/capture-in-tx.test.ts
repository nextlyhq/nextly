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

// A document with no version yet, so every save here records one.
const tx = {
  select: () => Promise.resolve([]),
} as unknown as Parameters<typeof captureInTx>[0];

describe("captureInTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capture.mockResolvedValue({ versionNo: 1 });
  });

  it("records the locale the snapshot was assembled from", async () => {
    await captureInTx(tx, service(), {
      lifecycle: true,
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
      lifecycle: true,
      ref,
      parts: { parentRow: { id: "e1" } },
    });

    expect(capture).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ locale: null })
    );
  });

  it("passes through whatever locale the caller established", async () => {
    // The seam does not decide whether a snapshot is locale-specific; the write
    // path does, and passes null when it captured no locale-specific state.
    await captureInTx(tx, service(), {
      lifecycle: true,
      ref,
      parts: { parentRow: { id: "e1" } },
      locale: null,
    });

    expect(capture).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ locale: null })
    );
  });

  it("records the version a restore came from", async () => {
    await captureInTx(tx, service(), {
      lifecycle: true,
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
      lifecycle: true,
      ref,
      parts: { parentRow: { id: "e1" } },
    });

    expect(capture).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ sourceVersionNo: null })
    );
  });

  it("still assembles the snapshot, and records a status it does not know as it is", async () => {
    await captureInTx(tx, service(), {
      lifecycle: true,
      ref,
      contentStatus: "nonsense",
      parts: {
        parentRow: { id: "e1", title: "Hi" },
        manyToMany: { tags: ["t1"] },
      },
    });

    // Never "published": a status outside the lifecycle is the document's
    // own, and calling it published would claim it live.
    expect(capture).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        status: "nonsense",
        snapshot: { id: "e1", title: "Hi", tags: ["t1"] },
      })
    );
  });

  describe("a save that changes nothing", () => {
    // A document whose newest version already holds exactly this save.
    const unchanged = {
      select: () =>
        Promise.resolve([
          {
            versionNo: 3,
            status: "published",
            snapshot: { id: "e1", title: "Hi" },
          },
        ]),
    } as unknown as Parameters<typeof captureInTx>[0];
    const parts = { parentRow: { id: "e1", title: "Hi" } };

    it("records no version for an ordinary save", async () => {
      const result = await captureInTx(unchanged, service(), {
        lifecycle: true,
        ref,
        parts,
        onlyIfChanged: true,
      });
      expect(result).toEqual({ versionNo: null });
      expect(capture).not.toHaveBeenCalled();
    });

    it("records a restore, which names what it came from", async () => {
      await captureInTx(unchanged, service(), {
        lifecycle: true,
        ref,
        parts,
        onlyIfChanged: true,
        sourceVersionNo: 2,
      });
      expect(capture).toHaveBeenCalledOnce();
    });

    it("records a named version, which was asked for by name", async () => {
      await captureInTx(unchanged, service(), {
        lifecycle: true,
        ref,
        parts,
        onlyIfChanged: true,
        label: "Before launch",
      });
      expect(capture).toHaveBeenCalledOnce();
    });

    it("records a change of status", async () => {
      await captureInTx(unchanged, service(), {
        lifecycle: true,
        ref,
        parts,
        onlyIfChanged: true,
        contentStatus: "draft",
      });
      expect(capture).toHaveBeenCalledOnce();
    });

    it("records a save of a language other than the newest version's", async () => {
      // The document's newest version is in no language; an older Spanish one
      // could match this save yet predate a change to the shared fields.
      await captureInTx(unchanged, service(), {
        lifecycle: true,
        ref,
        parts,
        onlyIfChanged: true,
        locale: "es",
      });
      expect(capture).toHaveBeenCalledOnce();
    });

    it("records nothing for a language whose version is the newest and holds this save", async () => {
      const spanish = {
        select: () =>
          Promise.resolve([
            {
              versionNo: 3,
              status: "published",
              locale: "es",
              snapshot: { id: "e1", title: "Hi" },
            },
          ]),
      } as unknown as Parameters<typeof captureInTx>[0];
      const result = await captureInTx(spanish, service(), {
        lifecycle: true,
        ref,
        parts,
        onlyIfChanged: true,
        locale: "es",
      });
      expect(result).toEqual({ versionNo: null });
      expect(capture).not.toHaveBeenCalled();
    });

    it("records a create whatever an earlier document under its id left", async () => {
      // No `onlyIfChanged`: a create says the document began.
      await captureInTx(unchanged, service(), {
        ref,
        parts,
        lifecycle: true,
      });
      expect(capture).toHaveBeenCalledOnce();
    });

    it("records a change to an authored status that both values normalize past", async () => {
      // Without the draft/published lifecycle `status` is an ordinary field:
      // "queued" and "archived" both capture as version status "published".
      const queued = {
        select: () =>
          Promise.resolve([
            {
              versionNo: 3,
              status: "published",
              snapshot: { id: "e1", title: "Hi", status: "queued" },
            },
          ]),
      } as unknown as Parameters<typeof captureInTx>[0];
      await captureInTx(queued, service(), {
        lifecycle: true,
        ref,
        parts: { parentRow: { id: "e1", title: "Hi", status: "archived" } },
        contentStatus: "archived",
        onlyIfChanged: true,
      });
      expect(capture).toHaveBeenCalledOnce();
    });
  });
});
