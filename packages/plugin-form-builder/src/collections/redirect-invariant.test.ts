import { describe, expect, it } from "vitest";

import {
  assertRedirectTargetUsable,
  formAcceptsSubmissions,
  wouldStrandVisitors,
} from "./forms";

describe("formAcceptsSubmissions", () => {
  it("reads the status the write carries", () => {
    expect(formAcceptsSubmissions({ status: "published" }, undefined)).toBe(
      true
    );
    expect(formAcceptsSubmissions({ status: "draft" }, undefined)).toBe(false);
  });

  it("falls back to the stored status when the write does not carry one", () => {
    // Publishing a form and editing its settings are separate saves. An update
    // that never mentions `status` leaves the stored one standing, so reading
    // an absent field as "not published" would wave through the very pairing
    // the rule exists to catch.
    expect(
      formAcceptsSubmissions({ name: "Renamed" }, { status: "published" })
    ).toBe(true);
  });

  it("lets the write override the stored status in both directions", () => {
    expect(
      formAcceptsSubmissions({ status: "published" }, { status: "draft" })
    ).toBe(true);
    expect(
      formAcceptsSubmissions({ status: "draft" }, { status: "published" })
    ).toBe(false);
  });

  it("treats closed and unknown states as not accepting submissions", () => {
    // Only a published form receives a submission, so only a published form
    // can redirect anyone. "Closed" shows a message instead.
    for (const status of ["closed", "archived", undefined, ""]) {
      expect(formAcceptsSubmissions({ status }, undefined)).toBe(false);
    }
    expect(formAcceptsSubmissions(undefined, undefined)).toBe(false);
  });
});

describe("wouldStrandVisitors", () => {
  const live = { id: "p1", status: "published" };
  const draft = { id: "p1", status: "draft" };
  const noLifecycle = { id: "p1" };

  it("is true only for a published form pointing at an unpublished page", () => {
    expect(wouldStrandVisitors({ status: "published" }, undefined, draft)).toBe(
      true
    );
  });

  it("allows a draft form to point at a draft page", () => {
    // They go live together, which is why the rule is conditional rather than
    // an outright ban on draft targets.
    expect(wouldStrandVisitors({ status: "draft" }, undefined, draft)).toBe(
      false
    );
  });

  it("allows a published form to point at a published page", () => {
    // The control: without it, everything above passes just as well against a
    // rule that refuses every published form.
    expect(wouldStrandVisitors({ status: "published" }, undefined, live)).toBe(
      false
    );
  });

  it("allows a collection with no publish lifecycle", () => {
    // No `status` field at all means every document is reachable. Reading that
    // absence as "draft" would refuse every redirect on every site that never
    // turned drafts on.
    expect(
      wouldStrandVisitors({ status: "published" }, undefined, noLifecycle)
    ).toBe(false);
  });

  it("catches publishing a form over a target it never mentions", () => {
    // The write carries `status` and nothing else; the target comes from the
    // stored row.
    expect(
      wouldStrandVisitors({ status: "published" }, { status: "draft" }, draft)
    ).toBe(true);
  });

  it("catches repointing an already-published form at a draft", () => {
    // The mirror case: the write carries settings and no status, so the
    // published state can only come from the stored row.
    expect(
      wouldStrandVisitors({ name: "x" }, { status: "published" }, draft)
    ).toBe(true);
  });
});

describe("assertRedirectTargetUsable", () => {
  const patterns = { pages: "/{slug}" };
  const picks = (id: string) => ({
    settings: {
      confirmationType: "relationship",
      redirectPage: { relationTo: "pages", value: id },
    },
  });

  /** A context around one canned answer from `findByID`. */
  const context = (
    over: Record<string, unknown>,
    findByID: () => unknown = () => ({ id: "p1", slug: "thanks" })
  ) =>
    ({
      collection: "forms",
      operation: "create",
      context: {},
      req: { nextly: { findByID: async () => findByID() } },
      ...over,
    }) as never;

  it("does nothing without a nextly to read through", async () => {
    // `req.nextly` is optional. Refusing here would block authoring wherever
    // the plugin is driven without one, for a page nobody could check.
    await expect(
      assertRedirectTargetUsable(
        {
          collection: "forms",
          operation: "create",
          context: {},
          data: picks("p1"),
        } as never,
        patterns
      )
    ).resolves.toBeUndefined();
  });

  it("skips the read inside a caller-owned transaction", async () => {
    // A pooled read cannot see the transaction's own uncommitted rows, so a
    // page created in the same transaction would read as missing and this
    // would refuse a correct write. The reader must never run here — a
    // findByID that throws proves it did not.
    await expect(
      assertRedirectTargetUsable(
        context(
          {
            data: picks("p1"),
            executor: {},
          },
          () => {
            throw new Error("read attempted inside a transaction");
          }
        ),
        patterns
      )
    ).resolves.toBeUndefined();
  });

  it("does not refuse when the target could not be read", async () => {
    // Unreadable is not missing. Refusing on any failure blocks a save that a
    // retry would complete.
    await expect(
      assertRedirectTargetUsable(
        context({ data: picks("p1") }, () => {
          throw Object.assign(new Error("db down"), { code: "ECONNRESET" });
        }),
        patterns
      )
    ).resolves.toBeUndefined();
  });

  it("refuses when the write names a page that is gone", async () => {
    await expect(
      assertRedirectTargetUsable(
        context({ data: picks("p1") }, () => {
          throw Object.assign(new Error("nope"), { code: "NOT_FOUND" });
        }),
        patterns
      )
    ).rejects.toMatchObject({
      publicData: { errors: [{ path: "settings.redirectPage" }] },
    });
  });

  it("lets a write that names no page through when the stored one is gone", async () => {
    // A rename inherits the stored target and does not answer for it.
    await expect(
      assertRedirectTargetUsable(
        context(
          {
            operation: "update",
            data: { name: "Renamed" },
            originalData: {
              status: "draft",
              settings: JSON.stringify(picks("p1").settings),
            },
          },
          () => {
            throw Object.assign(new Error("nope"), { code: "NOT_FOUND" });
          }
        ),
        patterns
      )
    ).resolves.toBeUndefined();
  });

  it("refuses a published form whose stored target is a draft", async () => {
    await expect(
      assertRedirectTargetUsable(
        context(
          {
            operation: "update",
            data: { status: "published" },
            originalData: {
              status: "draft",
              settings: JSON.stringify(picks("p1").settings),
            },
          },
          () => ({ id: "p1", slug: "thanks", status: "draft" })
        ),
        patterns
      )
    ).rejects.toMatchObject({
      publicData: { errors: [{ path: "settings.redirectPage" }] },
    });
  });

  it("does not refuse a publish for a pattern the author never edited", async () => {
    // The pattern belongs to the write that CHOOSES a page. This one only
    // publishes, and the submit path degrades an unusable pattern to no
    // redirect with a log line.
    await expect(
      assertRedirectTargetUsable(
        context(
          {
            operation: "update",
            data: { status: "published" },
            originalData: {
              status: "draft",
              settings: JSON.stringify(picks("p1").settings),
            },
          },
          () => ({ id: "p1", status: "published" })
        ),
        { pages: () => undefined }
      )
    ).resolves.toBeUndefined();
  });

  it("refuses when the write picks a page its pattern cannot describe", async () => {
    await expect(
      assertRedirectTargetUsable(
        context({ data: picks("p1") }, () => ({
          id: "p1",
          status: "published",
        })),
        { pages: () => undefined }
      )
    ).rejects.toMatchObject({
      publicData: { errors: [{ path: "settings.redirectPage" }] },
    });
  });
});
