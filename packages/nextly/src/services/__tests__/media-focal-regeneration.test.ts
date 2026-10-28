/**
 * Focal-point crop regeneration must be content-addressed: new variants are
 * written to fresh keys, the row is committed pointing at them, and only THEN
 * are the superseded old variants deleted — so a rollback or a lost update race
 * never leaves the committed row referencing bytes that were already deleted.
 *
 * These use hand-rolled collaborators (no real DB) to pin the delete ORDERING
 * and the rollback/void cleanup, which are the correctness contract of the fix.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteSpy = vi.fn(async () => {});
const calls: string[] = [];
// The path the regenerated variant lands on. Mutable so a test can simulate a
// deterministic-key adapter that reuses the existing path (new === old).
// `filenames` records the destination base names passed to generateImageSizes,
// so a test can assert regeneration forces a unique destination.
// `points` records the focus point each regeneration cut the sizes around.
// `beforeCut`, when set, runs before a cut and may hold it, so a case can let
// another update run to completion in between. `pathFromPoint` names each
// variant by the point it was cut around, so a case can read from the stored
// row which point its variants show.
const regen = {
  thumbPath: "NEW/thumb.webp",
  filenames: [] as string[],
  points: [] as unknown[],
  beforeCut: null as (() => Promise<void>) | null,
  pathFromPoint: false,
};

const storageMock = {
  getAdapterForCollection: () => ({
    read: async () => Buffer.from("original-image-bytes"),
  }),
  upload: async () => ({ url: "http://x/new", path: "NEW/thumb.webp" }),
  delete: async (path: string) => {
    calls.push(`delete:${path}`);
    return deleteSpy(path);
  },
};

vi.mock("@nextly/storage", () => ({
  getMediaStorage: () => storageMock,
  getImageProcessor: () => ({}),
  withRetry: (fn: () => unknown) => fn(),
  isTransientError: () => false,
  // The regenerated variants land on the configured key (fresh/unique by
  // default; a test can point it at the existing path to model a deterministic
  // adapter that overwrites in place). The destination base name is recorded so
  // a test can assert regeneration forces a unique destination.
  generateImageSizes: async (
    _buffer: unknown,
    originalFilename: string,
    _configs: unknown,
    _upload: unknown,
    point: unknown
  ) => {
    regen.filenames.push(originalFilename);
    regen.points.push(point);
    const hold = regen.beforeCut;
    regen.beforeCut = null;
    if (hold) await hold();
    const cut = point as { focalX?: number; focalY?: number };
    return {
      thumbnail: {
        path: regen.pathFromPoint
          ? `cut-${cut.focalX}-${cut.focalY}.webp`
          : regen.thumbPath,
        url: "http://x/new",
        width: 100,
        height: 100,
      },
    };
  },
  deleteImageSizes: async () => {},
}));

vi.mock("../../domains/webhooks/record-mutation-event", () => ({
  recordMutationEvent: async () => {},
}));

vi.mock("../image-size", () => ({
  ImageSizeService: class {
    async getActiveSizeConfigs() {
      return [{ name: "thumbnail", width: 100, height: 100 }];
    }
  },
}));

import { NextlyError } from "../../errors";
import { runInPluginTransaction } from "../../shared/lib/plugin-transaction-scope";
import { MediaService } from "../media";

const OLD_PATH = "OLD/thumb.webp";
const NEW_PATH = "NEW/thumb.webp";

const existingMedia = {
  id: "m1",
  mimeType: "image/png",
  filename: "m1.png",
  originalFilename: "m1.png",
  sizes: { thumbnail: { path: OLD_PATH, url: "http://x/old" } },
};

/** Other items the shared-file search finds, by the files they refer to. */
let sharers: Array<{ filename: string; url: string }> = [];

/** After-commit effects held for an enclosing transaction, or null to run them. */
let held: Array<() => unknown> | null = null;

function makeAdapter(
  txBehavior: "commit" | "throw" | "row-gone",
  // The row the in-transaction locked read returns. Defaults to the same row the
  // pre-transaction read saw; a test overrides it to model a concurrent update
  // that committed a different variant set before this transaction locked.
  lockedRow: typeof existingMedia = existingMedia,
  // Whether the adapter reports an enclosing transaction the update joins, as
  // on SQLite inside a plugin's `ctx.db.transaction` or core's own one.
  enclosed = false
) {
  const tx = {
    lockRow: async () => {},
    select: async () => (txBehavior === "row-gone" ? [] : [lockedRow]),
    update: async () => {
      calls.push("update");
    },
  };
  return {
    dialect: "sqlite" as const,
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    // The rows that may share the item's files, asked once a change
    // commits or fails: `sharers`, none unless a case sets them.
    getDrizzle: () => ({
      select: () => ({ from: () => ({ where: async () => sharers }) }),
    }),
    inTransaction: () => enclosed,
    // The ordering under test is the variant cleanup's, not the effects', so
    // an after-commit effect runs at once, unless a case holds it as an
    // enclosing transaction does until it commits.
    afterCommit: async (effect: () => unknown) => {
      if (held) held.push(effect);
      else await effect();
    },
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
      const result = await fn(tx);
      if (txBehavior === "throw") {
        // Mirror how the DB layer surfaces a failed write (a typed NextlyError),
        // not a bare Error, matching this package's error convention.
        throw NextlyError.internal({
          logContext: { reason: "test-simulated-db-failure" },
        });
      }
      return result;
    },
  };
}

function makeService(
  txBehavior: "commit" | "throw" | "row-gone",
  lockedRow: typeof existingMedia = existingMedia,
  enclosed = false
) {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  const service = new MediaService(
    makeAdapter(txBehavior, lockedRow, enclosed) as never,
    logger as never
  );
  // getMediaById is the pre-transaction existence read; stub it to the image.
  vi.spyOn(
    service as unknown as { getMediaById: () => Promise<unknown> },
    "getMediaById"
  ).mockResolvedValue({ success: true, statusCode: 200, data: existingMedia });
  return service;
}

describe("MediaService focal-point regeneration ordering", () => {
  beforeEach(() => {
    held = null;
    sharers = [];
    calls.length = 0;
    deleteSpy.mockClear();
    regen.thumbPath = NEW_PATH;
    regen.filenames.length = 0;
    regen.points.length = 0;
    regen.beforeCut = null;
    regen.pathFromPoint = false;
  });

  it("cuts the sizes around the stored coordinate an update leaves out", async () => {
    // The row's point is off-centre vertically; the update moves only X. Cut
    // with Y left out, the sizes would centre vertically while the row kept
    // its stored Y, and the crops would disagree with the saved point.
    // The same row before the lock and under it: nothing else moved it.
    const stored = { ...existingMedia, focalX: 50, focalY: 20 };
    const service = makeService("commit", stored);
    vi.spyOn(
      service as unknown as { getMediaById: () => Promise<unknown> },
      "getMediaById"
    ).mockResolvedValue({ success: true, statusCode: 200, data: stored });

    await service.updateMedia("m1", { focalX: 30 });

    expect(regen.points).toEqual([{ focalX: 30, focalY: 20 }]);
  });

  it("regenerates onto a unique destination base, never the item's stored filename", async () => {
    // A random token is injected before the extension so the regenerated variant
    // keys cannot collide with the item's existing ones on a deterministic
    // (filename -> fixed path) storage adapter — which would otherwise fail the
    // upload or overwrite live bytes before the row commits.
    const service = makeService("commit");
    await service.updateMedia("m1", { focalX: 0.5 });

    expect(regen.filenames).toHaveLength(1);
    const base = regen.filenames[0];
    expect(base).not.toBe(existingMedia.originalFilename);
    // `m1.png` -> `m1-<uuid>.png`: token before the extension.
    expect(base).toMatch(/^m1-[0-9a-f-]{36}\.png$/i);
  });

  it("deletes the old variant only AFTER the row commits, and never the new one", async () => {
    const service = makeService("commit");
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.success).toBe(true);
    // The old path is deleted, the new path (now referenced by the row) is not.
    expect(deleteSpy).toHaveBeenCalledWith(OLD_PATH);
    expect(deleteSpy).not.toHaveBeenCalledWith(NEW_PATH);
    // Ordering: the delete happens strictly after the committing update.
    expect(calls.indexOf("update")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf(`delete:${OLD_PATH}`)).toBeGreaterThan(
      calls.indexOf("update")
    );
  });

  it("deletes the old variant only once a plugin's enclosing transaction commits", async () => {
    // The update is a savepoint of the plugin's transaction, so its later
    // rollback restores the row's OLD variant paths; deleting their files
    // before it commits would leave that row pointing at bytes that are gone.
    held = [];
    const service = makeService("commit", existingMedia, true);
    const res = await runInPluginTransaction(() =>
      service.updateMedia("m1", { focalX: 0.5 })
    );

    expect(res.success).toBe(true);
    expect(calls).toContain("update");
    expect(deleteSpy).not.toHaveBeenCalledWith(OLD_PATH);

    // The plugin's transaction commits.
    for (const effect of held.splice(0)) await effect();
    expect(deleteSpy).toHaveBeenCalledWith(OLD_PATH);
    expect(deleteSpy).not.toHaveBeenCalledWith(NEW_PATH);
  });

  it("deletes the old variant in a plugin's transaction the update does not join", async () => {
    // On PostgreSQL and MySQL the update commits on its own connection, so the
    // adapter reports no enclosing transaction and no rollback can reach it.
    const service = makeService("commit");
    const res = await runInPluginTransaction(() =>
      service.updateMedia("m1", { focalX: 0.5 })
    );

    expect(res.success).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith(OLD_PATH);
  });

  it("deletes the old variant inside core's own enclosing transaction", async () => {
    // No plugin transaction encloses the update, so nothing rolls the row
    // back after it returns and the superseded files go as usual.
    const service = makeService("commit", existingMedia, true);
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.success).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith(OLD_PATH);
    expect(deleteSpy).not.toHaveBeenCalledWith(NEW_PATH);
  });

  it("cleans up the new (orphaned) variant and keeps the old one when the write fails", async () => {
    const service = makeService("throw");
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.success).toBe(false);
    // The freshly-uploaded new variant is deleted; the old one is untouched.
    expect(deleteSpy).toHaveBeenCalledWith(NEW_PATH);
    expect(deleteSpy).not.toHaveBeenCalledWith(OLD_PATH);
  });

  // On a content-addressed adapter a "new" variant can be a key another
  // item already uses.
  it("keeps a new variant another item refers to when the write fails", async () => {
    sharers = [{ filename: NEW_PATH, url: `/uploads/${NEW_PATH}` }];
    const service = makeService("throw");
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.success).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalledWith(NEW_PATH);
  });

  it("cleans up the new variant when the row was concurrently deleted", async () => {
    const service = makeService("row-gone");
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.statusCode).toBe(404);
    expect(deleteSpy).toHaveBeenCalledWith(NEW_PATH);
    expect(deleteSpy).not.toHaveBeenCalledWith(OLD_PATH);
  });

  it("does not delete a shared path on rollback for a deterministic-key adapter", async () => {
    // A deterministic adapter regenerates onto the SAME path the row already
    // references. On a failed write the un-updated row still points there, so the
    // rollback cleanup must not delete it (which would drop the live variant).
    regen.thumbPath = OLD_PATH;
    const service = makeService("throw");
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.success).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalledWith(OLD_PATH);
  });

  it("keeps the locked row's variant (not the pre-transaction one) on rollback", async () => {
    // Lost-update race with a deterministic-key adapter: this update read OLD
    // before the transaction, a concurrent update committed variant A, and this
    // update then locked and read A before its own write failed. The rollback
    // must filter the orphans against the LOCKED row (A), not the stale pre-
    // transaction read (OLD): the row the database still references is A, so
    // deleting A would drop a live variant. Filtering against OLD would delete A.
    const A_PATH = "A/thumb.webp";
    regen.thumbPath = A_PATH;
    const lockedRow = {
      ...existingMedia,
      sizes: { thumbnail: { path: A_PATH, url: "http://x/a" } },
    };
    const service = makeService("throw", lockedRow);
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.success).toBe(false);
    // The variant the surviving (locked) row references is kept.
    expect(deleteSpy).not.toHaveBeenCalledWith(A_PATH);
    // The stale pre-transaction variant is not the one referenced, so it is not
    // wrongly kept as "live" either — nothing gets deleted here at all.
    expect(deleteSpy).not.toHaveBeenCalledWith(OLD_PATH);
  });
});

/*
 * A regeneration whose new sizes include `thumbnail` makes that size the
 * item's thumbnail. The thumbnail made at upload is then referenced by
 * nothing, so it goes after the row commits, with the superseded sizes; until
 * then the row still points at it, so a write that fails keeps it.
 */
describe("the upload-time thumbnail a regeneration replaces", () => {
  // Stored as an adapter stores it: under a date folder, with a key of its
  // own, its URL the adapter's prefix plus that key.
  const LEGACY_THUMB = "2026/10/b2-thumb_m1.png";
  const withUploadThumbnail = {
    ...existingMedia,
    filename: "2026/10/a1-m1.png",
    url: "http://x/2026/10/a1-m1.png",
    thumbnailUrl: `http://x/${LEGACY_THUMB}`,
  };

  beforeEach(() => {
    deleteSpy.mockClear();
    calls.length = 0;
    regen.thumbPath = NEW_PATH;
  });

  it("is removed after the row commits", async () => {
    const service = makeService("commit", withUploadThumbnail);
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.success).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith(LEGACY_THUMB);
    expect(calls.indexOf(`delete:${LEGACY_THUMB}`)).toBeGreaterThan(
      calls.indexOf("update")
    );
  });

  it("stays when the write fails", async () => {
    const service = makeService("throw", withUploadThumbnail);
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.success).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalledWith(LEGACY_THUMB);
  });
});

describe("a superseded file a regeneration cannot remove", () => {
  beforeEach(() => {
    deleteSpy.mockReset();
    deleteSpy.mockImplementation(async () => {});
    calls.length = 0;
    regen.thumbPath = NEW_PATH;
  });

  it("is named, with its item, and the change still succeeds", async () => {
    deleteSpy.mockImplementation(async (path: string) => {
      if (path === OLD_PATH) throw new Error("storage is unavailable");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const service = makeService("commit");
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.success).toBe(true);
    const said = warn.mock.calls
      .map(args => args.map(String).join(" "))
      .join("\n");
    expect(said).toContain(OLD_PATH);
    expect(said).toContain("m1");
    warn.mockRestore();
  });
});

/**
 * One stored row that every read and write goes through, as a database would,
 * so two updates can run against each other.
 */
function makeStatefulService(
  row: Record<string, unknown>,
  // Runs as each write takes the lock: another update landing just before.
  onLock: () => void = () => undefined
) {
  let writes = 0;
  const tx = {
    lockRow: async () => {
      onLock();
    },
    select: async () => [{ ...row }],
    update: async (_table: string, data: Record<string, unknown>) => {
      writes += 1;
      Object.assign(row, data);
    },
  };
  const adapter = {
    dialect: "sqlite" as const,
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    getDrizzle: () => ({
      select: () => ({ from: () => ({ where: async () => [] }) }),
    }),
    inTransaction: () => false,
    afterCommit: async (effect: () => unknown) => {
      await effect();
    },
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> =>
      fn(tx),
  };
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  const service = new MediaService(adapter as never, logger as never);
  vi.spyOn(
    service as unknown as { getMediaById: () => Promise<unknown> },
    "getMediaById"
  ).mockImplementation(async () => ({
    success: true,
    statusCode: 200,
    data: { ...row },
  }));
  return { service, writes: () => writes };
}

/** The path of the stored row's thumbnail, however the column holds it. */
function storedThumbnail(row: Record<string, unknown>): unknown {
  const sizes =
    typeof row.sizes === "string" ? JSON.parse(row.sizes) : row.sizes;
  return (sizes as { thumbnail?: { path?: string } } | null)?.thumbnail?.path;
}

describe("the point an item's sizes are cut around", () => {
  beforeEach(() => {
    calls.length = 0;
    deleteSpy.mockClear();
    regen.points.length = 0;
    regen.filenames.length = 0;
    regen.beforeCut = null;
    regen.pathFromPoint = true;
  });

  it("is the point the row ends with when two one-coordinate updates overlap", async () => {
    const row: Record<string, unknown> = {
      ...existingMedia,
      focalX: 50,
      focalY: 50,
    };
    const { service } = makeStatefulService(row);

    // The first update reads the row, then waits at its cut while a second
    // update, of the other coordinate, runs to the end.
    let releaseFirst: () => void = () => undefined;
    let firstIsCutting: () => void = () => undefined;
    const cutting = new Promise<void>(resolve => {
      firstIsCutting = resolve;
    });
    regen.beforeCut = () =>
      new Promise<void>(resolve => {
        releaseFirst = resolve;
        firstIsCutting();
      });
    const first = service.updateMedia("m1", { focalX: 30 });
    await cutting;
    await service.updateMedia("m1", { focalY: 70 });
    releaseFirst();
    await first;

    // POSITIVE CONTROL: both updates landed on the row.
    expect([row.focalX, row.focalY]).toEqual([30, 70]);
    expect(storedThumbnail(row)).toBe("cut-30-70.webp");
  });

  it("gives up with a conflict, writing nothing and keeping no cut, when the point keeps moving", async () => {
    const row: Record<string, unknown> = {
      ...existingMedia,
      focalX: 50,
      focalY: 50,
    };
    // Every time this update takes the lock, another has just moved Y.
    const { service, writes } = makeStatefulService(row, () => {
      row.focalY = (row.focalY as number) + 1;
    });

    const result = await service.updateMedia("m1", { focalX: 30 });

    expect(result).toMatchObject({ success: false, statusCode: 409 });
    // POSITIVE CONTROL: it did cut, once per attempt, before giving up.
    expect(regen.points).toHaveLength(3);
    expect(writes()).toBe(0);
    // Each attempt's cut is removed again; the row keeps its own sizes.
    expect(deleteSpy).toHaveBeenCalledTimes(3);
    expect(storedThumbnail(row)).toBe(OLD_PATH);
  });

  it("isn't cut again when an update asks for the point already stored", async () => {
    const row: Record<string, unknown> = {
      ...existingMedia,
      focalX: 30,
      focalY: 60,
    };
    const { service } = makeStatefulService(row);

    const named = await service.updateMedia("m1", { focalX: 30, focalY: 60 });
    const oneAxis = await service.updateMedia("m1", { focalX: 30 });

    // POSITIVE CONTROL: both updates succeeded and were written.
    expect(named.success).toBe(true);
    expect(oneAxis.success).toBe(true);
    expect(regen.points).toEqual([]);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(storedThumbnail(row)).toBe(OLD_PATH);
  });

  it("is still cut for a point that differs from the one stored", async () => {
    // The control for the case above: the same harness does cut when asked
    // for a new point, so "no cut" there is the comparison, not a harness
    // that never reaches the cut.
    const row: Record<string, unknown> = {
      ...existingMedia,
      focalX: 30,
      focalY: 60,
    };
    const { service } = makeStatefulService(row);
    await service.updateMedia("m1", { focalY: 61 });
    expect(regen.points).toEqual([{ focalX: 30, focalY: 61 }]);
    expect(storedThumbnail(row)).toBe("cut-30-61.webp");
  });
});
