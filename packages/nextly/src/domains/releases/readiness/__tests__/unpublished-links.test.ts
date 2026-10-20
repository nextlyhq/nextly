/**
 * The link check, without a database: the projection of a linked document to
 * the release's moment, the source over fake reads, and what a reader who may
 * not read a target is told.
 *
 * Each projection case has a twin that differs only in the property under
 * test — the instant a membership falls due, or which of two is later — so a
 * projection that ignored the moment, or the order, fails one of the pair.
 */
import { describe, expect, it, vi } from "vitest";

import type { DueMember } from "../../resolve-release-effect";
import type { ReadinessFinding } from "../evaluate-readiness";
import {
  linkMoment,
  linkTargetState,
  narrowLinkFindings,
  unpublishedLinksReport,
  unpublishedLinksSource,
  type DocumentLink,
  type ReleaseLinkReads,
} from "../unpublished-links";

import { member, reads, release } from "./helpers/readiness-fixtures";

const NOW = new Date("2026-03-01T00:00:00Z");
const MOMENT = new Date("2026-03-10T09:00:00Z");
const BEFORE = new Date("2026-03-05T09:00:00Z");
const AFTER = new Date("2026-03-20T09:00:00Z");

function due(
  id: string,
  action: "publish" | "unpublish",
  scheduledAt: Date
): DueMember {
  return {
    memberId: id,
    releaseId: `release-${id}`,
    action,
    scheduledAt,
    createdAt: new Date("2026-02-01T00:00:00Z"),
  };
}

describe("linkTargetState", () => {
  it("reads a draft nothing publishes as a draft, and a published one as live", () => {
    expect(
      linkTargetState({ published: false, memberships: [], moment: MOMENT })
    ).toBe("draft");
    expect(
      linkTargetState({ published: true, memberships: [], moment: MOMENT })
    ).toBe("live");
  });

  it("counts a publish only when it falls due by the moment", () => {
    expect(
      linkTargetState({
        published: false,
        memberships: [due("a", "publish", BEFORE)],
        moment: MOMENT,
      })
    ).toBe("live");
    // The same publish, after the moment: the link is still a draft then.
    expect(
      linkTargetState({
        published: false,
        memberships: [due("a", "publish", AFTER)],
        moment: MOMENT,
      })
    ).toBe("draft");
  });

  it("counts a takedown due earlier, though the document is live now", () => {
    expect(
      linkTargetState({
        published: true,
        memberships: [due("a", "unpublish", BEFORE)],
        moment: MOMENT,
      })
    ).toBe("comes-down");
    expect(
      linkTargetState({
        published: true,
        memberships: [due("a", "unpublish", AFTER)],
        moment: MOMENT,
      })
    ).toBe("live");
  });

  it("lets the later of two due memberships decide", () => {
    const early = new Date("2026-03-02T09:00:00Z");
    expect(
      linkTargetState({
        published: false,
        memberships: [
          due("a", "publish", early),
          due("b", "unpublish", BEFORE),
        ],
        moment: MOMENT,
      })
    ).toBe("comes-down");
    expect(
      linkTargetState({
        published: false,
        memberships: [
          due("a", "unpublish", early),
          due("b", "publish", BEFORE),
        ],
        moment: MOMENT,
      })
    ).toBe("live");
  });
});

describe("linkMoment", () => {
  it("is a scheduled release's instant while it is ahead, and now otherwise", () => {
    expect(
      linkMoment(release({ state: "scheduled", scheduledAt: MOMENT }), NOW)
    ).toEqual(MOMENT);
    // Overdue: it runs on the drain's next pass.
    expect(
      linkMoment(
        release({ state: "scheduled", scheduledAt: new Date("2026-02-01") }),
        NOW
      )
    ).toEqual(NOW);
    expect(linkMoment(release({ state: "draft" }), NOW)).toEqual(NOW);
    // A stopped release keeps its instant but will not run at it.
    expect(
      linkMoment(release({ state: "blocked", scheduledAt: MOMENT }), NOW)
    ).toEqual(NOW);
  });
});

/** Fake content: each post's links, and which documents are published. */
function linkReads(
  links: Record<string, DocumentLink[]>,
  published: Record<string, boolean>
): ReleaseLinkReads & {
  linksOf: ReturnType<typeof vi.fn>;
  publishedOf: ReturnType<typeof vi.fn>;
} {
  return {
    linksOf: vi.fn(async (_scope: unknown, ids: readonly string[]) => {
      const found = new Map<string, DocumentLink[]>();
      for (const id of ids) if (links[id]) found.set(id, links[id]);
      return found;
    }),
    publishedOf: vi.fn(async (collection: string, ids: readonly string[]) => {
      const found = new Map<string, boolean>();
      for (const id of ids) {
        const key = `${collection}/${id}`;
        if (key in published) found.set(id, published[key]);
      }
      return found;
    }),
  };
}

function link(field: string, collection: string, entryId: string) {
  return { field, collection, entryId };
}

describe("core.unpublished-links", () => {
  const scheduled = release({ state: "scheduled", scheduledAt: MOMENT });

  it("reports a draft link and one coming down earlier, and leaves live ones alone", async () => {
    const content = linkReads(
      {
        "entry-post": [
          link("author", "authors", "drafty"),
          link("category", "categories", "leaving"),
          link("related", "posts", "live"),
          link("editor", "authors", "drafty"),
        ],
      },
      {
        "authors/drafty": false,
        "categories/leaving": true,
        "posts/live": true,
      }
    );
    const source = unpublishedLinksSource({
      reads: content,
      membersOf: async () => [],
    });
    const found = await source.check([member("post")], {
      release: scheduled,
      now: NOW,
      reads: reads({
        scheduledMemberships: async refs =>
          new Map(
            refs
              .filter(ref => ref.entryId === "leaving")
              .map(ref => [
                `collection:categories:leaving:`,
                [due("x", "unpublish", BEFORE)],
              ])
          ),
      }),
    });
    expect(found).toEqual([
      {
        memberId: "post",
        code: "UNPUBLISHED_LINK",
        detail: {
          scopeKind: "collection",
          scopeSlug: "authors",
          entryId: "drafty",
          // Both fields that link to it, on one finding.
          fields: ["author", "editor"],
          cause: "draft",
        },
      },
      {
        memberId: "post",
        code: "UNPUBLISHED_LINK",
        detail: {
          scopeKind: "collection",
          scopeSlug: "categories",
          entryId: "leaving",
          fields: ["category"],
          cause: "comes-down",
        },
      },
    ]);
  });

  it("does not report a link another release publishes before the moment", async () => {
    const content = linkReads(
      { "entry-post": [link("author", "authors", "drafty")] },
      { "authors/drafty": false }
    );
    const source = unpublishedLinksSource({
      reads: content,
      membersOf: async () => [],
    });
    const check = (at: Date) =>
      source.check([member("post")], {
        release: scheduled,
        now: NOW,
        reads: reads({
          scheduledMemberships: async () =>
            new Map([
              ["collection:authors:drafty:", [due("x", "publish", at)]],
            ]),
        }),
      });
    expect(await check(BEFORE)).toEqual([]);
    // The control: published only after the moment, it is reported.
    expect((await check(AFTER)).map(f => f.code)).toEqual(["UNPUBLISHED_LINK"]);
  });

  it("counts a draft release's own members as going live with it", async () => {
    const content = linkReads(
      { "entry-post": [link("author", "authors", "drafty")] },
      { "authors/drafty": false }
    );
    const ownAuthor = member("author", {
      scopeSlug: "authors",
      entryId: "drafty",
    });
    const run = (own: ReturnType<typeof member>[]) =>
      unpublishedLinksSource({
        reads: content,
        membersOf: async () => own,
      }).check([member("post")], {
        release: release({ state: "draft" }),
        now: NOW,
        reads: reads(),
      });
    expect(await run([ownAuthor])).toEqual([]);
    expect((await run([])).map(f => f.code)).toEqual(["UNPUBLISHED_LINK"]);
  });

  it("makes no report for a document coming down, and reads nothing for it", async () => {
    const content = linkReads(
      { "entry-post": [link("author", "authors", "drafty")] },
      { "authors/drafty": false }
    );
    const found = await unpublishedLinksSource({
      reads: content,
      membersOf: async () => [],
    }).check([member("post", { action: "unpublish" })], {
      release: scheduled,
      now: NOW,
      reads: reads(),
    });
    expect(found).toEqual([]);
    expect(content.linksOf).not.toHaveBeenCalled();
  });

  it("does not read a collection whose translations lack their status", async () => {
    const content = linkReads(
      { "entry-post": [link("author", "authors", "drafty")] },
      { "authors/drafty": false }
    );
    const run = (broken: boolean) =>
      unpublishedLinksSource({
        reads: content,
        membersOf: async () => [],
      }).check([member("post")], {
        release: scheduled,
        now: NOW,
        reads: reads({ companionLacksLifecycle: async () => broken }),
      });
    // core.companion-status reports it; reading it would fail the whole read.
    expect(await run(true)).toEqual([]);
    expect(content.linksOf).not.toHaveBeenCalled();
    expect((await run(false)).map(f => f.code)).toEqual(["UNPUBLISHED_LINK"]);
  });

  it("leaves out links into a collection without a lifecycle, and to documents that are gone", async () => {
    const content = linkReads(
      {
        "entry-post": [
          link("note", "notes", "plain"),
          link("author", "authors", "gone"),
          link("editor", "authors", "drafty"),
        ],
      },
      { "notes/plain": false, "authors/drafty": false }
    );
    const found = await unpublishedLinksSource({
      reads: content,
      membersOf: async () => [],
    }).check([member("post")], {
      release: scheduled,
      now: NOW,
      reads: reads({
        declaresLifecycle: async scope => scope.scopeSlug !== "notes",
      }),
    });
    expect(found.map(f => f.detail?.entryId)).toEqual(["drafty"]);
  });

  it("asks for statuses in runs the smallest parameter limit admits", async () => {
    const many = Array.from({ length: 450 }, (_, i) =>
      link("tags", "tags", `t${i}`)
    );
    const content = linkReads(
      { "entry-post": many },
      Object.fromEntries(many.map(l => [`tags/${l.entryId}`, false]))
    );
    const scheduledMemberships = vi.fn(async () => new Map());
    const found = await unpublishedLinksSource({
      reads: content,
      membersOf: async () => [],
    }).check([member("post")], {
      release: scheduled,
      now: NOW,
      reads: reads({ scheduledMemberships }),
    });
    expect(found).toHaveLength(450);
    const runs = content.publishedOf.mock.calls.map(
      call => (call[1] as string[]).length
    );
    expect(runs).toEqual([400, 50]);
    expect(
      scheduledMemberships.mock.calls.map(
        call => (call as unknown[][])[0].length
      )
    ).toEqual([400, 50]);
  });
});

/** A link finding as the evaluator shows it. */
function shown(
  memberId: string,
  entryId: string,
  code = "UNPUBLISHED_LINK"
): ReadinessFinding {
  return {
    memberId,
    code,
    detail: {
      scopeKind: "collection",
      scopeSlug: "authors",
      entryId,
      fields: ["author"],
      cause: "draft",
    },
    source: "core.unpublished-links",
    action: "publish",
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: `entry-${memberId}`,
  };
}

describe("narrowLinkFindings", () => {
  const other: ReadinessFinding = {
    memberId: "b",
    code: "IN_OTHER_RELEASE",
    detail: { releaseId: "r2", winningReleaseId: "r2" },
    source: "core.other-release",
    action: "publish",
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: "entry-b",
  };

  it("names readable targets, and counts the rest per member without naming them", () => {
    const narrowed = narrowLinkFindings(
      [
        shown("a", "open"),
        shown("a", "secret-1"),
        shown("a", "secret-2"),
        other,
        shown("b", "secret-3"),
      ],
      target => target.entryId === "open"
    );
    expect(narrowed.map(f => [f.memberId, f.code, f.detail])).toEqual([
      ["a", "UNPUBLISHED_LINK", shown("a", "open").detail],
      ["a", "UNPUBLISHED_LINKS_HIDDEN", { count: "2" }],
      ["b", "IN_OTHER_RELEASE", other.detail],
      ["b", "UNPUBLISHED_LINKS_HIDDEN", { count: "1" }],
    ]);
    expect(JSON.stringify(narrowed)).not.toContain("secret");
  });

  it("passes everything through for a reader who may read every target", () => {
    const all = [shown("a", "one"), other];
    expect(narrowLinkFindings(all, () => true)).toEqual(all);
  });
});

describe("unpublishedLinksReport", () => {
  it("lists the named links and sums the hidden ones", () => {
    expect(
      unpublishedLinksReport(
        narrowLinkFindings(
          [shown("a", "open"), shown("a", "secret")],
          target => target.entryId === "open"
        )
      )
    ).toEqual({
      links: [
        {
          scopeKind: "collection",
          scopeSlug: "authors",
          entryId: "open",
          fields: ["author"],
          cause: "draft",
        },
      ],
      hiddenCount: 1,
    });
  });
});
