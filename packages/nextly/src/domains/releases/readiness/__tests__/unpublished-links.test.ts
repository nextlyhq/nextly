/**
 * The link check, without a database: the projection of a linked document to
 * the release's moment, the source over fake reads, and what a reader is told.
 *
 * Each projection case has a twin that differs only in the property under
 * test — the instant a membership falls due, which of two is later, whether
 * its author can act — so a projection that ignored it fails one of the pair.
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
  withoutFieldKeys,
  type DocumentLink,
  type LinkReaderVerdicts,
  type ReleaseLinkReads,
  type ScannedLinks,
} from "../unpublished-links";

import { member, reads, release } from "./helpers/readiness-fixtures";

const NOW = new Date("2026-03-01T00:00:00Z");
const MOMENT = new Date("2026-03-10T09:00:00Z");
const BEFORE = new Date("2026-03-05T09:00:00Z");
const AFTER = new Date("2026-03-20T09:00:00Z");

/** Every author these cases name can act, unless a case says otherwise. */
const LIVE = new Set(["author"]);

function due(
  id: string,
  action: "publish" | "unpublish",
  scheduledAt: Date,
  createdBy: string | null = "author"
): DueMember {
  return {
    memberId: id,
    releaseId: `release-${id}`,
    action,
    scheduledAt,
    createdAt: new Date("2026-02-01T00:00:00Z"),
    createdBy,
  };
}

function state(
  published: boolean,
  memberships: DueMember[],
  live: ReadonlySet<string> = LIVE
) {
  return linkTargetState({ published, memberships, moment: MOMENT, live });
}

describe("linkTargetState", () => {
  it("reads a draft nothing publishes as a draft, and a published one as live", () => {
    expect(state(false, [])).toBe("draft");
    expect(state(true, [])).toBe("live");
  });

  it("counts a publish only when it falls due by the moment", () => {
    expect(state(false, [due("a", "publish", BEFORE)])).toBe("live");
    // The same publish, after the moment: the link is still a draft then.
    expect(state(false, [due("a", "publish", AFTER)])).toBe("draft");
  });

  it("counts a takedown due earlier, though the document is live now", () => {
    expect(state(true, [due("a", "unpublish", BEFORE)])).toBe("comes-down");
    expect(state(true, [due("a", "unpublish", AFTER)])).toBe("live");
  });

  it("lets the later of two due memberships decide", () => {
    const early = new Date("2026-03-02T09:00:00Z");
    expect(
      state(false, [due("a", "publish", early), due("b", "unpublish", BEFORE)])
    ).toBe("comes-down");
    expect(
      state(false, [due("a", "unpublish", early), due("b", "publish", BEFORE)])
    ).toBe("live");
  });

  it("gives a winning publish no effect when its author cannot act, as the read path does", () => {
    expect(state(false, [due("a", "publish", BEFORE, "gone")])).toBe("draft");
    expect(state(false, [due("a", "publish", BEFORE, null)])).toBe("draft");
    // And an earlier member does not stand in for the winner nobody can run.
    expect(
      state(false, [
        due("a", "publish", new Date("2026-03-02T09:00:00Z")),
        due("b", "unpublish", BEFORE, "gone"),
      ])
    ).toBe("draft");
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

/**
 * Fake content: each post's links, and which documents exist and are live.
 * A collection named in `notCollections` is not a collection at all.
 */
function linkReads(
  links: Record<string, DocumentLink[]>,
  published: Record<string, boolean>,
  notCollections: string[] = []
): ReleaseLinkReads & {
  linksOf: ReturnType<typeof vi.fn>;
  publishedOf: ReturnType<typeof vi.fn>;
} {
  return {
    linksOf: vi.fn(async (_scope: unknown, ids: readonly string[]) => {
      const found = new Map<string, ScannedLinks>();
      for (const id of ids) {
        if (links[id]) found.set(id, { links: links[id], snapshot: { id } });
      }
      return found;
    }),
    publishedOf: vi.fn(async (collection: string, ids: readonly string[]) => {
      if (notCollections.includes(collection)) return null;
      const found = new Map<string, boolean>();
      for (const id of ids) {
        const key = `${collection}/${id}`;
        if (key in published) found.set(id, published[key]);
      }
      return found;
    }),
  };
}

/** A link through `field`, whose key is the path unless a case gives one. */
function link(
  field: string,
  collection: string,
  entryId: string,
  fieldKey = field
) {
  return { field, fieldKey, collection, entryId };
}

describe("core.unpublished-links", () => {
  const scheduled = release({ state: "scheduled", scheduledAt: MOMENT });

  it("states every link: a draft, one coming down earlier, and a live one", async () => {
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
    const found = await unpublishedLinksSource({
      reads: content,
      membersOf: async () => [],
    }).check([member("post")], {
      release: scheduled,
      now: NOW,
      reads: reads({
        scheduledMemberships: async refs =>
          new Map(
            refs
              .filter(ref => ref.entryId === "leaving")
              .map(() => [
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
          fieldKeys: ["author", "editor"],
          fieldNames: ["author", "editor"],
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
          fieldKeys: ["category"],
          fieldNames: ["category"],
          cause: "comes-down",
        },
      },
      // Live, so a reader who may not read it is told what they are told of
      // the others; the narrowing drops it for everyone else.
      {
        memberId: "post",
        code: "UNPUBLISHED_LINK",
        detail: {
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: "live",
          fields: ["related"],
          fieldKeys: ["related"],
          fieldNames: ["related"],
          cause: "live",
        },
      },
    ]);
  });

  it("does not report a link another release publishes before the moment", async () => {
    const content = linkReads(
      { "entry-post": [link("author", "authors", "drafty")] },
      { "authors/drafty": false }
    );
    const check = (at: Date, author = "author") =>
      unpublishedLinksSource({
        reads: content,
        membersOf: async () => [],
      }).check([member("post")], {
        release: scheduled,
        now: NOW,
        reads: reads({
          scheduledMemberships: async () =>
            new Map([
              ["collection:authors:drafty:", [due("x", "publish", at, author)]],
            ]),
          liveAuthors: async ids => new Set(ids.filter(id => id === "author")),
        }),
      });
    expect((await check(BEFORE)).map(f => f.detail?.cause)).toEqual(["live"]);
    // Published only after the moment: reported.
    expect((await check(AFTER)).map(f => f.code)).toEqual(["UNPUBLISHED_LINK"]);
    // Published before it, by an author who can no longer act: reported.
    expect((await check(BEFORE, "gone")).map(f => f.detail?.cause)).toEqual([
      "draft",
    ]);
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
    expect((await run([ownAuthor])).map(f => f.detail?.cause)).toEqual([
      "live",
    ]);
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

  it("states links to deleted documents, and never one to the media library", async () => {
    const content = linkReads(
      {
        "entry-post": [
          link("author", "authors", "gone-1"),
          link("editor", "authors", "gone-2"),
          link("author", "authors", "gone-3"),
          link("cover", "media", "m1"),
          link("note", "notes", "plain"),
        ],
      },
      // A collection without a lifecycle reads every document as live.
      { "notes/plain": true },
      ["media"]
    );
    const found = await unpublishedLinksSource({
      reads: content,
      membersOf: async () => [],
    }).check([member("post")], {
      release: scheduled,
      now: NOW,
      reads: reads(),
    });
    // Each with its target, for judging who may be told; the narrowing
    // names deleted ones by field only.
    expect(found.map(f => [f.detail?.entryId, f.detail?.cause])).toEqual([
      ["gone-1", "deleted"],
      ["gone-2", "deleted"],
      ["gone-3", "deleted"],
      ["plain", "live"],
    ]);
    expect(
      withoutFieldKeys(
        found.map(f => ({
          ...f,
          source: "core.unpublished-links",
          action: "publish" as const,
          scopeKind: "collection" as const,
          scopeSlug: "posts",
          entryId: "entry-post",
        }))
      ).map(f => f.detail)
    ).toEqual([
      { fields: ["author"], cause: "deleted", count: "2" },
      { fields: ["editor"], cause: "deleted", count: "1" },
    ]);
  });

  it("asks for statuses in runs the smallest parameter limit admits", async () => {
    const many = Array.from({ length: 1100 }, (_, i) =>
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
    expect(found).toHaveLength(1100);
    const runs = content.publishedOf.mock.calls.map(
      call => (call[1] as string[]).length
    );
    expect(runs).toEqual([500, 500, 100]);
    expect(
      scheduledMemberships.mock.calls.map(
        call => (call as unknown[][])[0].length
      )
    ).toEqual([500, 500, 100]);
  });
});

/** A link finding from member `memberId`, as the evaluator shows it. */
function shown(
  memberId: string,
  entryId: string,
  fields: string[] = ["author"],
  keys: string[] = fields
): ReadinessFinding {
  return {
    memberId,
    code: "UNPUBLISHED_LINK",
    detail: {
      scopeKind: "collection",
      scopeSlug: "authors",
      entryId,
      fields: [...new Set(fields)],
      fieldKeys: keys,
      fieldNames: fields,
      cause: "draft",
    },
    source: "core.unpublished-links",
    action: "publish",
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: `entry-${memberId}`,
  };
}

/** A deleted-link finding from member `memberId`, standing for `count` links. */
function deletedIn(
  memberId: string,
  field: string,
  entryId = "gone"
): ReadinessFinding {
  return {
    ...shown(memberId, entryId, [field]),
    detail: {
      ...shown(memberId, entryId, [field]).detail,
      cause: "deleted",
    },
  };
}

/** A live-link finding from member `memberId`. */
function liveIn(memberId: string, entryId: string): ReadinessFinding {
  return {
    ...shown(memberId, entryId),
    detail: { ...shown(memberId, entryId).detail, cause: "live" },
  };
}

/** A finding's detail as a reader is shown it: without the field keys. */
function plain(finding: ReadinessFinding) {
  const {
    fieldKeys: _keys,
    fieldNames: _names,
    ...detail
  } = finding.detail ?? {};
  return detail;
}

/** A reader who may read everything except what a case names. */
function verdicts(over: Partial<LinkReaderVerdicts> = {}): LinkReaderVerdicts {
  return {
    sourceReadable: () => true,
    visibleFields: () => null,
    targetReadable: () => true,
    ...over,
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
      verdicts({ targetReadable: target => target.entryId === "open" })
    );
    expect(narrowed.map(f => [f.memberId, f.code, f.detail])).toEqual([
      ["a", "UNPUBLISHED_LINK", plain(shown("a", "open"))],
      ["a", "UNPUBLISHED_LINKS_HIDDEN", { count: "2" }],
      ["b", "IN_OTHER_RELEASE", other.detail],
      ["b", "UNPUBLISHED_LINKS_HIDDEN", { count: "1" }],
    ]);
    expect(JSON.stringify(narrowed)).not.toContain("secret");
  });

  it("counts every link from a document the reader may not read, deleted ones too", () => {
    const narrowed = narrowLinkFindings(
      [shown("a", "open"), deletedIn("a", "author")],
      verdicts({ sourceReadable: () => false })
    );
    expect(narrowed.map(f => [f.code, f.detail])).toEqual([
      ["UNPUBLISHED_LINKS_HIDDEN", { count: "2" }],
    ]);
    expect(JSON.stringify(narrowed)).not.toContain("author");
  });

  it("names a link in a field the reader may not view by neither field nor target, and still counts it", () => {
    const all = [
      shown("a", "secret-target", ["guarded"]),
      shown("a", "open", ["author", "guarded"]),
      deletedIn("a", "guarded"),
    ];
    const narrowed = narrowLinkFindings(
      all,
      verdicts({ visibleFields: () => new Set(["author"]) })
    );
    expect(narrowed.map(f => [f.code, f.detail])).toEqual([
      // Both links in the hidden field, gathered into one count.
      ["UNPUBLISHED_LINK_IN_HIDDEN_FIELD", { count: "2" }],
      // Shown through the field the reader may view, and only that one.
      [
        "UNPUBLISHED_LINK",
        { ...plain(shown("a", "open")), fields: ["author"] },
      ],
    ]);
    expect(JSON.stringify(narrowed)).not.toContain("guarded");
    expect(JSON.stringify(narrowed)).not.toContain("secret-target");
  });

  it("tells a reader who may not read a target the same of it, whatever it is", () => {
    // A live document, a draft and a deleted one, none of them readable.
    const narrowed = narrowLinkFindings(
      [liveIn("a", "t1"), shown("a", "t2"), deletedIn("a", "author", "t3")],
      verdicts({ targetReadable: () => false })
    );
    expect(narrowed.map(f => [f.code, f.detail])).toEqual([
      ["UNPUBLISHED_LINKS_HIDDEN", { count: "3" }],
    ]);
    for (const [one] of [
      [liveIn("a", "t1")],
      [shown("a", "t2")],
      [deletedIn("a", "author", "t3")],
    ]) {
      expect(
        narrowLinkFindings([one], verdicts({ targetReadable: () => false }))
      ).toEqual([
        expect.objectContaining({
          code: "UNPUBLISHED_LINKS_HIDDEN",
          detail: { count: "1" },
        }),
      ]);
    }
  });

  it("names a deleted link to a readable target by its field alone, and drops a live one", () => {
    const narrowed = narrowLinkFindings(
      [
        deletedIn("a", "author", "g1"),
        liveIn("a", "t1"),
        deletedIn("a", "author", "g2"),
      ],
      verdicts()
    );
    expect(narrowed.map(f => f.detail)).toEqual([
      { fields: ["author"], cause: "deleted", count: "2" },
    ]);
  });

  it("passes everything through for a reader who may read everything, without the keys", () => {
    const all = [shown("a", "one"), other];
    expect(narrowLinkFindings(all, verdicts())).toEqual([
      { ...shown("a", "one"), detail: plain(shown("a", "one")) },
      other,
    ]);
    // A trusted reader's view is the same, live links dropped.
    expect(withoutFieldKeys([...all, liveIn("a", "two")])).toEqual([
      { ...shown("a", "one"), detail: plain(shown("a", "one")) },
      other,
    ]);
  });

  it("judges two fields that share a path by their own keys", () => {
    // `blocks.author` in a quote (key q) the reader may view, and in an aside
    // (key s) they may not.
    const narrowed = narrowLinkFindings(
      [
        shown("a", "quoted", ["blocks.author"], ["q:author"]),
        shown("a", "aside-only", ["blocks.author"], ["s:author"]),
      ],
      verdicts({ visibleFields: () => new Set(["q:author"]) })
    );
    expect(narrowed.map(f => [f.code, f.detail?.entryId ?? null])).toEqual([
      ["UNPUBLISHED_LINK", "quoted"],
      ["UNPUBLISHED_LINK_IN_HIDDEN_FIELD", null],
    ]);
    expect(JSON.stringify(narrowed)).not.toContain("aside-only");
  });

  it("counts each deleted link in every field it is linked from", () => {
    // One deleted target linked from fields A and B, another from A alone.
    const both = {
      ...shown("a", "g1", ["A", "B"]),
      detail: { ...shown("a", "g1", ["A", "B"]).detail, cause: "deleted" },
    };
    const findings = [both, deletedIn("a", "A", "g2")];
    const perField = [
      { fields: ["A"], cause: "deleted", count: "2" },
      { fields: ["B"], cause: "deleted", count: "1" },
    ];
    expect(narrowLinkFindings(findings, verdicts()).map(f => f.detail)).toEqual(
      perField
    );
    expect(withoutFieldKeys(findings).map(f => f.detail)).toEqual(perField);
  });

  it("counts five deleted links as five, hidden or in a hidden field", () => {
    const five = ["g1", "g2", "g3", "g4", "g5"].map(id =>
      deletedIn("a", "author", id)
    );
    expect(
      narrowLinkFindings(five, verdicts({ sourceReadable: () => false })).map(
        f => [f.code, f.detail]
      )
    ).toEqual([["UNPUBLISHED_LINKS_HIDDEN", { count: "5" }]]);
    expect(
      narrowLinkFindings(
        five,
        verdicts({ visibleFields: () => new Set() })
      ).map(f => [f.code, f.detail])
    ).toEqual([["UNPUBLISHED_LINK_IN_HIDDEN_FIELD", { count: "5" }]]);
  });
});

describe("unpublishedLinksReport", () => {
  it("lists the named links, sums the hidden ones and lists deleted ones by field", () => {
    expect(
      unpublishedLinksReport(
        narrowLinkFindings(
          [
            shown("a", "open"),
            shown("a", "secret"),
            shown("a", "guarded-target", ["guarded"]),
            deletedIn("a", "author"),
          ],
          verdicts({
            targetReadable: target => target.entryId !== "secret",
            visibleFields: () => new Set(["author"]),
          })
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
      inHiddenFields: 1,
      deletedLinks: [{ field: "author", count: 1 }],
    });
  });
});
