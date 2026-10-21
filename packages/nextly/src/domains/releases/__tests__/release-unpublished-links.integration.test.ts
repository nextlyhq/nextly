/**
 * A document going live that links to documents that will not be live at the
 * release's moment, against a real database.
 *
 * What the unit tests cannot show: that the links are read from the document
 * as it is stored (and from its working draft, which is what goes live), that
 * the projection sees the other releases the database holds, and that a
 * reader who may not read a linked document is told only that there is one,
 * over REST as well as the Direct API.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  relationship,
  text,
  upload,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadinessFinding } from "../readiness/evaluate-readiness";

import { deactivate, seedLiveAuthor } from "./helpers/live-author";
import { keyHolding, rest } from "./helpers/rest-key";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const BEFORE = new Date("2099-01-05T09:00:00Z");
const MOMENT = new Date("2099-01-10T09:00:00Z");
const AFTER = new Date("2099-01-20T09:00:00Z");

/** Who may read a post's `reviewer` field. */
const BOSS = { email: "boss@example.com", name: "Boss" };

/** Anyone may read, write, publish and unpublish: access is not the subject. */
const OPEN = {
  read: () => true,
  update: () => true,
  publish: () => true,
  unpublish: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: "card",
        fields: [
          text({ name: "heading" }),
          relationship({ name: "cardAuthor", relationTo: "authors" }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "homepage",
        status: true,
        access: OPEN,
        fields: [
          text({ name: "headline" }),
          relationship({ name: "featured", relationTo: "authors" }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: "authors",
        status: true,
        access: OPEN,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "categories",
        status: true,
        access: OPEN,
        fields: [text({ name: "title" })],
      }),
      // No read rule: who may read a secret is decided by grants alone, so a
      // caller holding none of its grants may not.
      defineCollection({
        slug: "secrets",
        status: true,
        access: { update: () => true, publish: () => true },
        fields: [text({ name: "title" })],
      }),
      // Documents with a draft/published lifecycle, which an upload can point at.
      defineCollection({
        slug: "documents",
        status: true,
        access: OPEN,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "posts",
        status: true,
        versions: { drafts: true },
        access: OPEN,
        hooks: {
          // Hides the author from every reader; it is still stored, and
          // still what goes live.
          afterRead: [
            ({ data }: { data?: unknown }) => {
              const hide = (document: unknown) => {
                const shown = { ...(document as Record<string, unknown>) };
                delete shown.author;
                return shown;
              };
              // A list read hands the hook every document at once.
              return Array.isArray(data) ? data.map(hide) : hide(data);
            },
          ],
        },
        fields: [
          text({ name: "title" }),
          relationship({ name: "author", relationTo: "authors" }),
          relationship({ name: "category", relationTo: "categories" }),
          relationship({ name: "secret", relationTo: "secrets" }),
          relationship({
            name: "reviewer",
            relationTo: "authors",
            access: { read: ({ req }) => req.user?.email === BOSS.email },
          }),
          upload({ name: "cover", relationTo: "media" }),
          upload({ name: "attachment", relationTo: "documents" }),
          fieldGroup({ name: "card", component: "card" }),
        ],
      }),
    ],
  });
  return current;
}

/** A document, stored through the ordinary write. */
async function entry(
  t: TestNextly,
  collection: "authors" | "categories" | "secrets" | "documents" | "posts",
  data: Record<string, unknown> = {},
  status: "draft" | "published" = "draft"
): Promise<string> {
  const created = (await t.nextly.create({
    collection: collection as never,
    data: { title: collection, status, ...data } as never,
  })) as unknown as { item?: { id?: string }; id?: string };
  const id = created.item?.id ?? created.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

/** A release holding one document, added by `author`, scheduled when `at`. */
async function releaseWith(
  t: TestNextly,
  author: string,
  document: {
    collection: string;
    id: string;
    action?: "publish" | "unpublish";
  },
  at?: Date
) {
  const release = await t.nextly.releases.create({ title: "Launch" });
  const member = await t.nextly.releases.addMember({
    releaseId: release.id,
    scopeKind: "collection",
    scopeSlug: document.collection,
    entryId: document.id,
    locale: null,
    action: document.action ?? "publish",
    userId: author,
  });
  if (at !== undefined) {
    await t.nextly.releases.schedule({
      id: release.id,
      at,
      timezone: "UTC",
    });
  }
  return { releaseId: release.id, member };
}

/**
 * The link findings of a release, as `[linked document, cause]`, or
 * `["hidden", count]`, `["hidden field"]` and `["deleted", field, count]`.
 */
function linksIn(soft: readonly ReadinessFinding[]): string[][] {
  return soft
    .filter(finding => finding.source === "core.unpublished-links")
    .map(asRow);
}

/** One link finding as a row of {@link linksIn}. */
function asRow(finding: ReadinessFinding): string[] {
  const detail = finding.detail ?? {};
  const rows: Record<string, string[]> = {
    UNPUBLISHED_LINKS_HIDDEN: ["hidden", String(detail.count)],
    UNPUBLISHED_LINK_IN_HIDDEN_FIELD: ["hidden field"],
  };
  if (rows[finding.code]) return rows[finding.code];
  return detail.cause === "deleted"
    ? ["deleted", String(detail.fields), String(detail.count)]
    : [
        `${String(detail.scopeSlug)}/${String(detail.entryId)}`,
        String(detail.cause),
      ];
}

/** The Single's stored rows, read straight from its table. */
async function homepageRows(t: TestNextly): Promise<Array<{ id: string }>> {
  return t.adapter.select<{ id: string }>("single_homepage", {});
}

describe.each(getConfiguredTestDialects())(
  "a document's unpublished links (%s)",
  dialect => {
    it("lists an unpublished author and a category coming down earlier, and not a live link", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const draftAuthor = await entry(t, "authors");
      const leaving = await entry(t, "categories", {}, "published");
      const post = await entry(t, "posts", {
        author: draftAuthor,
        category: leaving,
      });
      // The category is live now, and another release takes it down before
      // the post goes live.
      await releaseWith(
        t,
        author,
        { collection: "categories", id: leaving, action: "unpublish" },
        BEFORE
      );
      const { releaseId } = await releaseWith(
        t,
        author,
        { collection: "posts", id: post },
        MOMENT
      );

      const found = await t.nextly.releases.readiness({ releaseId });
      expect(linksIn(found.soft)).toEqual([
        [`authors/${draftAuthor}`, "draft"],
        [`categories/${leaving}`, "comes-down"],
      ]);
      // A note, never a reason to stop: the release is schedulable as it is.
      expect(found.hard).toEqual([]);
    });

    it("does not list a link another release publishes before the moment", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const publishedFirst = await entry(t, "authors");
      const publishedLater = await entry(t, "authors");
      const post = await entry(t, "posts", {
        author: publishedFirst,
        category: null,
      });
      const other = await entry(t, "posts", { author: publishedLater });
      await releaseWith(
        t,
        author,
        { collection: "authors", id: publishedFirst },
        BEFORE
      );
      // The control: published, but only after the moment.
      await releaseWith(
        t,
        author,
        { collection: "authors", id: publishedLater },
        AFTER
      );
      const first = await releaseWith(
        t,
        author,
        { collection: "posts", id: post },
        MOMENT
      );
      const second = await releaseWith(
        t,
        author,
        { collection: "posts", id: other },
        MOMENT
      );

      expect(
        linksIn(
          (await t.nextly.releases.readiness({ releaseId: first.releaseId }))
            .soft
        )
      ).toEqual([]);
      expect(
        linksIn(
          (await t.nextly.releases.readiness({ releaseId: second.releaseId }))
            .soft
        )
      ).toEqual([[`authors/${publishedLater}`, "draft"]]);
    });

    it("makes no report for a document coming down", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const draftAuthor = await entry(t, "authors");
      const post = await entry(
        t,
        "posts",
        { author: draftAuthor },
        "published"
      );

      const down = await releaseWith(t, author, {
        collection: "posts",
        id: post,
        action: "unpublish",
      });
      expect(down.member.unpublishedLinks).toEqual({
        links: [],
        hiddenCount: 0,
        inHiddenFields: 0,
        deletedLinks: [],
      });
      expect(
        linksIn(
          (await t.nextly.releases.readiness({ releaseId: down.releaseId }))
            .soft
        )
      ).toEqual([]);

      // The control: the same post going live is reported.
      const up = await releaseWith(t, author, {
        collection: "posts",
        id: post,
      });
      expect(
        linksIn(
          (await t.nextly.releases.readiness({ releaseId: up.releaseId })).soft
        )
      ).toEqual([[`authors/${draftAuthor}`, "draft"]]);
    });

    it("never reports an upload: the media library has no draft state", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const draftAuthor = await entry(t, "authors");
      const post = await entry(t, "posts", {
        author: draftAuthor,
        cover: "00000000-0000-4000-8000-0000000c0e5e",
      });

      const { member } = await releaseWith(t, author, {
        collection: "posts",
        id: post,
      });
      // The relationship beside it is reported, so the upload's absence is
      // the rule and not a read that found nothing.
      expect(member.unpublishedLinks.links.map(link => link.scopeSlug)).toEqual(
        ["authors"]
      );
    });

    it("reads the links a working draft would put live, not the live row's", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const liveAuthor = await entry(t, "authors", {}, "published");
      const draftAuthor = await entry(t, "authors");
      const post = await entry(t, "posts", { author: liveAuthor }, "published");
      // A pending change, kept apart from the live row, swaps the author.
      await t.nextly.update({
        collection: "posts" as never,
        id: post,
        data: { author: draftAuthor } as never,
        draft: true,
      } as never);

      const { member } = await releaseWith(t, author, {
        collection: "posts",
        id: post,
      });
      expect(member.unpublishedLinks.links).toEqual([
        {
          scopeKind: "collection",
          scopeSlug: "authors",
          entryId: draftAuthor,
          fields: ["author"],
          cause: "draft",
        },
      ]);
    });

    it("reports a link inside a field group, and an upload into a collection with Draft/Published", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const draftAuthor = await entry(t, "authors");
      const draftFile = await entry(t, "documents");
      const post = await entry(t, "posts", {
        card: { heading: "Hi", cardAuthor: draftAuthor },
        attachment: draftFile,
      });

      const { member } = await releaseWith(t, author, {
        collection: "posts",
        id: post,
      });
      expect(member.unpublishedLinks.links).toEqual([
        expect.objectContaining({
          scopeSlug: "documents",
          entryId: draftFile,
          fields: ["attachment"],
        }),
        expect.objectContaining({
          scopeSlug: "authors",
          entryId: draftAuthor,
          fields: ["card.cardAuthor"],
        }),
      ]);
    });

    it("reports a link to a deleted document by its field, naming no target", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const category = await entry(t, "categories", {}, "published");
      const post = await entry(t, "posts", { category });
      await t.nextly.delete({
        collection: "categories" as never,
        id: category,
      });

      const { releaseId, member } = await releaseWith(t, author, {
        collection: "posts",
        id: post,
      });
      const found = await t.nextly.releases.readiness({ releaseId });
      expect(linksIn(found.soft)).toEqual([["deleted", "category", "1"]]);
      expect(member.unpublishedLinks.deletedLinks).toEqual([
        { field: "category", count: 1 },
      ]);
      expect(JSON.stringify(found)).not.toContain(category);
    });

    it("reads links from what is stored, past a read hook that hides them", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const draftAuthor = await entry(t, "authors");
      const post = await entry(t, "posts", { author: draftAuthor });
      // The control: an ordinary read does not show the author.
      const read = (await t.nextly.findByID({
        collection: "posts" as never,
        id: post,
        status: "all",
        depth: 0,
      } as never)) as unknown as Record<string, unknown>;
      expect(read).not.toHaveProperty("author");

      const { member } = await releaseWith(t, author, {
        collection: "posts",
        id: post,
      });
      expect(member.unpublishedLinks.links.map(link => link.entryId)).toEqual([
        draftAuthor,
      ]);
    });

    it("still reports a draft whose winning publish belongs to an author who can no longer act", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const leaver = await seedLiveAuthor(t);
      const draftAuthor = await entry(t, "authors");
      const post = await entry(t, "posts", { author: draftAuthor });
      await releaseWith(
        t,
        leaver,
        { collection: "authors", id: draftAuthor },
        BEFORE
      );
      const { releaseId } = await releaseWith(
        t,
        author,
        { collection: "posts", id: post },
        MOMENT
      );
      // The control: while the author can act, the publish counts.
      expect(
        linksIn((await t.nextly.releases.readiness({ releaseId })).soft)
      ).toEqual([]);

      await deactivate(t, leaver);
      expect(
        linksIn((await t.nextly.releases.readiness({ releaseId })).soft)
      ).toEqual([[`authors/${draftAuthor}`, "draft"]]);
    });

    it("reads a Single's links without ever creating its row", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const draftAuthor = await entry(t, "authors");
      await t.nextly.updateSingle({
        slug: "homepage" as never,
        data: {
          headline: "Hi",
          featured: draftAuthor,
          status: "draft",
        } as never,
      });
      const [row] = await homepageRows(t);
      const release = await t.nextly.releases.create({ title: "Home" });
      await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "single",
        scopeSlug: "homepage",
        entryId: row.id,
        locale: null,
        action: "publish",
        userId: author,
      });
      // The control: the Single's link is read while it is there.
      expect(
        linksIn(
          (await t.nextly.releases.readiness({ releaseId: release.id })).soft
        )
      ).toEqual([[`authors/${draftAuthor}`, "draft"]]);

      await t.adapter.delete("single_homepage", {
        and: [{ column: "id", op: "=", value: row.id }],
      });
      await t.nextly.releases.readiness({ releaseId: release.id });
      const post = await entry(t, "posts");
      await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: post,
        locale: null,
        action: "publish",
        userId: author,
      });
      expect(await homepageRows(t)).toEqual([]);
    });

    it("answers an add with the links, so they can be offered", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const draftAuthor = await entry(t, "authors");
      const sameRelease = await entry(t, "categories");
      const post = await entry(t, "posts", {
        author: draftAuthor,
        category: sameRelease,
      });
      const release = await t.nextly.releases.create({ title: "Launch" });
      // Already in the release, going live with the post: not offered.
      await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "collection",
        scopeSlug: "categories",
        entryId: sameRelease,
        locale: null,
        action: "publish",
        userId: author,
      });

      const added = await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: post,
        locale: null,
        action: "publish",
        userId: author,
      });
      expect(added.entryId).toBe(post);
      expect(added.unpublishedLinks).toEqual({
        links: [
          {
            scopeKind: "collection",
            scopeSlug: "authors",
            entryId: draftAuthor,
            fields: ["author"],
            cause: "draft",
          },
        ],
        hiddenCount: 0,
        inHiddenFields: 0,
        deletedLinks: [],
      });
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a document's unpublished links, as a reader may see them (%s)",
  dialect => {
    it("never names a linked document the caller may not read, over REST", async () => {
      const t = await boot(dialect);
      const { key } = await keyHolding(t, [
        "read-content-releases",
        "create-content-releases",
        "read-posts",
        "update-posts",
        "publish-posts",
        // A key reads a collection only on its own grant, whatever the
        // collection's rule says: it may read authors and never secrets.
        "read-authors",
      ]);
      const draftAuthor = await entry(t, "authors");
      const secret = await entry(t, "secrets");
      const post = await entry(t, "posts", {
        author: draftAuthor,
        secret,
      });

      const created = await rest(key, "POST", ["releases"], {
        title: "Launch",
      });
      const releaseId = (created.json.item as { id: string }).id;
      const added = await rest(
        key,
        "POST",
        ["releases", releaseId, "members"],
        {
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: post,
          action: "publish",
        }
      );
      expect(added.status).toBe(201);
      // In the mutation envelope's item, beside the member.
      expect(
        (added.json.item as { unpublishedLinks: unknown }).unpublishedLinks
      ).toEqual({
        links: [
          {
            scopeKind: "collection",
            scopeSlug: "authors",
            entryId: draftAuthor,
            fields: ["author"],
            cause: "draft",
          },
        ],
        hiddenCount: 1,
        inHiddenFields: 0,
        deletedLinks: [],
      });
      expect(JSON.stringify(added.json)).not.toContain(secret);

      const readiness = await rest(key, "GET", [
        "releases",
        releaseId,
        "readiness",
      ]);
      expect(readiness.status).toBe(200);
      expect(
        linksIn((readiness.json as { soft: ReadinessFinding[] }).soft)
      ).toEqual([
        [`authors/${draftAuthor}`, "draft"],
        ["hidden", "1"],
      ]);
      expect(JSON.stringify(readiness.json)).not.toContain(secret);

      // The control: a trusted read names it, so the count above stands for
      // a real finding withheld, not one never made.
      expect(
        linksIn((await t.nextly.releases.readiness({ releaseId })).soft)
      ).toEqual([
        [`authors/${draftAuthor}`, "draft"],
        [`secrets/${secret}`, "draft"],
      ]);
    });

    it("tells a reader who may not read the linked-from document nothing of its links", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const { key } = await keyHolding(t, [
        "read-content-releases",
        "read-authors",
      ]);
      const draftAuthor = await entry(t, "authors");
      const post = await entry(t, "posts", { author: draftAuthor });
      const { releaseId } = await releaseWith(t, author, {
        collection: "posts",
        id: post,
      });

      const readiness = await rest(key, "GET", [
        "releases",
        releaseId,
        "readiness",
      ]);
      expect(readiness.status).toBe(200);
      const answer = readiness.json as {
        soft: ReadinessFinding[];
        hidden: Array<{ scopeSlug: string; count: number; soft: number }>;
      };
      // The post is a document the reader may not read: it is one count among
      // the release's hidden documents, and none of its links is reported.
      expect(linksIn(answer.soft)).toEqual([]);
      expect(answer.hidden).toEqual([
        expect.objectContaining({ scopeSlug: "posts", count: 1, soft: 1 }),
      ]);
      expect(JSON.stringify(answer)).not.toContain(draftAuthor);
      expect(JSON.stringify(answer)).not.toContain('"fields"');
    });

    it("names a link in a protected field only to a reader who may read that field, and counts it for both", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const grants = ["read-content-releases", "read-posts", "read-authors"];
      const boss = await keyHolding(t, grants, BOSS);
      const clerk = await keyHolding(t, grants, {
        email: "clerk@example.com",
        name: "Clerk",
      });
      const draftAuthor = await entry(t, "authors");
      const post = await entry(t, "posts", { reviewer: draftAuthor });
      const { releaseId } = await releaseWith(t, author, {
        collection: "posts",
        id: post,
      });
      const softOf = async (key: string) =>
        (
          (await rest(key, "GET", ["releases", releaseId, "readiness"]))
            .json as { soft: ReadinessFinding[] }
        ).soft;

      const seenByBoss = await softOf(boss.key);
      const seenByClerk = await softOf(clerk.key);
      expect(linksIn(seenByBoss)).toEqual([
        [`authors/${draftAuthor}`, "draft"],
      ]);
      expect(seenByBoss[0]?.detail?.fields).toEqual(["reviewer"]);
      expect(linksIn(seenByClerk)).toEqual([["hidden field"]]);
      expect(JSON.stringify(seenByClerk)).not.toContain(draftAuthor);
      expect(JSON.stringify(seenByClerk)).not.toContain("reviewer");
      // The release's readiness counts the same for both.
      expect(seenByClerk).toHaveLength(seenByBoss.length);
    });

    it("tells a reader who may not read the linked collection the same of a live, a draft and a deleted target", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      // May read and add posts, and may not read categories.
      const { key } = await keyHolding(t, [
        "read-content-releases",
        "create-content-releases",
        "read-posts",
        "update-posts",
        "publish-posts",
      ]);
      const answers: unknown[] = [];
      for (const state of ["published", "draft", "deleted"] as const) {
        const category = await entry(
          t,
          "categories",
          {},
          state === "deleted" ? "published" : state
        );
        const post = await entry(t, "posts", { category });
        if (state === "deleted") {
          await t.nextly.delete({
            collection: "categories" as never,
            id: category,
          });
        }
        const { releaseId } = await releaseWith(t, author, {
          collection: "posts",
          id: post,
        });
        const soft = (
          (await rest(key, "GET", ["releases", releaseId, "readiness"]))
            .json as { soft: ReadinessFinding[] }
        ).soft;
        const own = await rest(key, "POST", ["releases"], { title: state });
        const added = await rest(
          key,
          "POST",
          ["releases", (own.json.item as { id: string }).id, "members"],
          {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: post,
            action: "publish",
          }
        );
        const told = {
          readiness: linksIn(soft),
          add: (added.json.item as { unpublishedLinks: unknown })
            .unpublishedLinks,
        };
        expect(JSON.stringify(told), state).not.toContain(category);
        answers.push(told);
      }
      // One count each time, with no cause, field or id: nothing tells the
      // three apart.
      expect(answers).toEqual(
        Array(3).fill({
          readiness: [["hidden", "1"]],
          add: {
            links: [],
            hiddenCount: 1,
            inHiddenFields: 0,
            deletedLinks: [],
          },
        })
      );
    });
  }
);
