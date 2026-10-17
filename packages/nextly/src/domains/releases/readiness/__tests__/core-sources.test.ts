/**
 * Core's release checks, one rule at a time.
 *
 * Each case runs one source over members built to trip exactly its rule, with
 * a control the rule must leave alone, so a source that reported everything —
 * or nothing — cannot pass.
 */
import { describe, expect, it, vi } from "vitest";

import { documentRefKey } from "../../releases-repository";
import type { ReleaseCheckSource } from "../check-sources";
import {
  CORE_AUTHOR_SOURCE,
  CORE_EXISTS_SOURCE,
  CORE_HELD_DRAFTS_SOURCE,
  CORE_OTHER_RELEASE_SOURCE,
  CORE_PERMISSION_SOURCE,
  CORE_RELEASE_CHECK_SOURCES,
  CORE_REQUIRED_FIELDS_SOURCE,
  registerCoreReleaseCheckSources,
  registeredReleaseCheckSources,
} from "../core-sources";
import { clearReleaseCheckSourcesForTests } from "../check-sources";

import { member, reads, release } from "./helpers/readiness-fixtures";

async function run<Code extends string>(
  source: ReleaseCheckSource<Code>,
  members: ReturnType<typeof member>[],
  over: Parameters<typeof reads>[0] = {},
  releaseOver: Parameters<typeof release>[0] = {}
) {
  return source.check(members, {
    release: release(releaseOver),
    now: new Date(),
    reads: reads(over),
  });
}

describe("core.author", () => {
  it("reports each reason the run would stop on, in the drain's order", async () => {
    const found = await run(
      CORE_AUTHOR_SOURCE,
      [
        member("fine"),
        member("authorless", { createdBy: null }),
        member("gone", { createdBy: "deleted-user" }),
        // Locale-scoped AND authorless: the drain stops on the locale first.
        member("locale", { locale: "de", createdBy: null }),
      ],
      { liveAuthors: async ids => new Set(ids.filter(id => id === "author")) }
    );
    expect(found).toEqual([
      { memberId: "authorless", code: "NO_AUTHOR" },
      { memberId: "gone", code: "AUTHOR_GONE" },
      { memberId: "locale", code: "LOCALE_SCOPED" },
    ]);
  });

  it("asks once for every author in the batch", async () => {
    const liveAuthors = vi.fn(async (ids: readonly string[]) => new Set(ids));
    await run(
      CORE_AUTHOR_SOURCE,
      [member("a"), member("b"), member("c", { createdBy: "other" })],
      { liveAuthors }
    );
    expect(liveAuthors).toHaveBeenCalledTimes(1);
    expect([...(liveAuthors.mock.calls[0]?.[0] ?? [])].sort()).toEqual([
      "author",
      "other",
    ]);
  });
});

describe("core.permission", () => {
  it("reports the members whose author may not perform their action", async () => {
    const found = await run(
      CORE_PERMISSION_SOURCE,
      [
        member("goes-live", { action: "publish" }),
        member("comes-down", { action: "unpublish" }),
      ],
      // May publish, may not unpublish.
      { mayPerform: async (_user, _scope, action) => action === "publish" }
    );
    expect(found).toEqual([
      { memberId: "comes-down", code: "AUTHOR_MAY_NOT_ACT" },
    ]);
  });

  it("asks once per author, scope and action, as the run's author", async () => {
    const mayPerform = vi.fn(async () => true);
    const actingAs = vi.fn(async (id: string) => ({ id, roles: ["editor"] }));
    await run(
      CORE_PERMISSION_SOURCE,
      [
        member("a"),
        member("b"),
        member("c", { createdBy: "other" }),
        member("d", { scopeSlug: "pages" }),
        member("e", { action: "unpublish" }),
      ],
      { mayPerform, actingAs }
    );
    // Four distinct (author, scope, action) groups out of five members, and
    // two distinct authors resolved.
    expect(mayPerform).toHaveBeenCalledTimes(4);
    expect(actingAs).toHaveBeenCalledTimes(2);
    expect(mayPerform).toHaveBeenCalledWith(
      { id: "author", roles: ["editor"] },
      expect.objectContaining({ scopeKind: "collection", scopeSlug: "posts" }),
      "publish"
    );
  });

  it("leaves members the run cannot act for to core.author", async () => {
    const mayPerform = vi.fn(async () => false);
    const found = await run(
      CORE_PERMISSION_SOURCE,
      [
        member("authorless", { createdBy: null }),
        member("locale", { locale: "de" }),
        member("gone", { createdBy: "deleted-user" }),
      ],
      {
        mayPerform,
        actingAs: async id => (id === "deleted-user" ? null : { id }),
      }
    );
    expect(found).toEqual([]);
    expect(mayPerform).not.toHaveBeenCalled();
  });
});

describe("core.exists", () => {
  it("reports a member whose document is gone", async () => {
    const gone = member("gone");
    const found = await run(CORE_EXISTS_SOURCE, [member("there"), gone], {
      existing: async refs =>
        new Set(
          refs.filter(ref => ref.entryId !== gone.entryId).map(documentRefKey)
        ),
    });
    expect(found).toEqual([{ memberId: "gone", code: "DOCUMENT_GONE" }]);
  });
});

describe("core.held-drafts", () => {
  it("reports a document held in another language, going live or coming down", async () => {
    const heldDraftLocales = vi.fn(async (ref: { entryId: string }) =>
      ref.entryId === "entry-fine" ? [] : ["de", "fr"]
    );
    const found = await run(
      CORE_HELD_DRAFTS_SOURCE,
      [
        member("goes-live"),
        member("comes-down", { action: "unpublish" }),
        member("fine"),
        // One language only: core.author's to report, and not a write that
        // moves every language.
        member("locale", { locale: "de" }),
      ],
      { heldDraftLocales }
    );
    expect(found).toEqual([
      {
        memberId: "goes-live",
        code: "DRAFT_HELD_IN_LOCALE",
        detail: { locales: ["de", "fr"] },
      },
      {
        memberId: "comes-down",
        code: "DRAFT_HELD_IN_LOCALE",
        detail: { locales: ["de", "fr"] },
      },
    ]);
    expect(heldDraftLocales).toHaveBeenCalledTimes(3);
  });
});

describe("core.required-fields", () => {
  it("reports a missing required value apart from any other failure", async () => {
    const found = await run(CORE_REQUIRED_FIELDS_SOURCE, [member("a")], {
      publishProblems: async () => [
        { path: "title", code: "REQUIRED", message: "Title is required." },
        { path: "slug", code: "PATTERN", message: "Slug is malformed." },
      ],
    });
    expect(found).toEqual([
      {
        memberId: "a",
        code: "REQUIRED_FIELD_MISSING",
        detail: { fields: ["title"] },
      },
      { memberId: "a", code: "FIELD_INVALID", detail: { fields: ["slug"] } },
    ]);
  });

  it("reports a field the author may no longer write apart from a failing one", async () => {
    const found = await run(CORE_REQUIRED_FIELDS_SOURCE, [member("a")], {
      publishProblems: async () => [
        { path: "guarded", code: "FORBIDDEN", message: "Not yours." },
        { path: "slug", code: "PATTERN", message: "Slug is malformed." },
      ],
    });
    expect(found).toEqual([
      {
        memberId: "a",
        code: "FIELD_NOT_PERMITTED",
        detail: { fields: ["guarded"] },
      },
      { memberId: "a", code: "FIELD_INVALID", detail: { fields: ["slug"] } },
    ]);
  });

  it("never judges a document coming down, so invalid content can be taken down", async () => {
    const publishProblems = vi.fn(async () => [
      { path: "title", code: "REQUIRED", message: "Title is required." },
    ]);
    const found = await run(
      CORE_REQUIRED_FIELDS_SOURCE,
      [member("comes-down", { action: "unpublish" }), member("goes-live")],
      { publishProblems }
    );
    expect(found.map(f => f.memberId)).toEqual(["goes-live"]);
    expect(publishProblems).toHaveBeenCalledTimes(1);
    expect(publishProblems).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: "entry-goes-live" }),
      { id: "author", roles: [] }
    );
  });

  it("reports nothing for a document that passes", async () => {
    expect(await run(CORE_REQUIRED_FIELDS_SOURCE, [member("a")])).toEqual([]);
  });
});

describe("core.other-release", () => {
  const LATER = new Date("2026-06-02T09:00:00Z");
  const SOONER = new Date("2026-06-01T09:00:00Z");

  function heldElsewhere(scheduledAt: Date, alsoHere = false) {
    return {
      scheduledMemberships: async (refs: readonly { entryId: string }[]) =>
        new Map(
          refs.map(ref => [
            documentRefKey({
              scopeKind: "collection",
              scopeSlug: "posts",
              entryId: ref.entryId,
              locale: null,
            }),
            [
              {
                memberId: "elsewhere",
                releaseId: "r2",
                action: "unpublish" as const,
                scheduledAt,
                createdAt: new Date("2026-01-01T00:00:00Z"),
              },
              ...(alsoHere
                ? [
                    {
                      memberId: "a",
                      releaseId: "r1",
                      action: "publish" as const,
                      scheduledAt: SOONER,
                      createdAt: new Date("2026-01-01T00:00:00Z"),
                    },
                  ]
                : []),
            ],
          ])
        ),
    };
  }

  it("names the other release, and this one as the winner when it runs later", async () => {
    const found = await run(
      CORE_OTHER_RELEASE_SOURCE,
      [member("a")],
      heldElsewhere(SOONER, true),
      { scheduledAt: LATER, state: "scheduled" }
    );
    // This release's own membership is not "another release".
    expect(found).toEqual([
      {
        memberId: "a",
        code: "IN_OTHER_RELEASE",
        detail: { releaseId: "r2", winningReleaseId: "r1" },
      },
    ]);
  });

  it("names the other release as the winner when it runs later", async () => {
    const found = await run(
      CORE_OTHER_RELEASE_SOURCE,
      [member("a")],
      heldElsewhere(LATER),
      { scheduledAt: SOONER, state: "scheduled" }
    );
    expect(found[0]?.detail).toEqual({
      releaseId: "r2",
      winningReleaseId: "r2",
    });
  });

  it("names no winner while this release has no instant", async () => {
    const found = await run(
      CORE_OTHER_RELEASE_SOURCE,
      [member("a")],
      heldElsewhere(LATER)
    );
    expect(found[0]?.detail).toEqual({
      releaseId: "r2",
      winningReleaseId: null,
    });
  });

  it("is a soft finding, and the only one of core's", () => {
    expect(
      CORE_RELEASE_CHECK_SOURCES.filter(s => s.severity === "soft").map(
        s => s.key
      )
    ).toEqual(["core.other-release"]);
  });
});

describe("the registered sources", () => {
  it("refuse to answer without core's, rather than read as ready", () => {
    clearReleaseCheckSourcesForTests();
    expect(() => registeredReleaseCheckSources()).toThrow(
      expect.objectContaining({ code: "INTERNAL_ERROR" })
    );
    registerCoreReleaseCheckSources();
    expect(registeredReleaseCheckSources().map(s => s.key)).toEqual(
      CORE_RELEASE_CHECK_SOURCES.map(s => s.key)
    );
  });
});
