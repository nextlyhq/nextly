/**
 * A release's pending change judged against the document its write keeps.
 *
 * Readiness rebuilds each member's live document from batched reads and asks
 * whether the field rules would refuse the working draft the write folds in.
 * The write compares against what it reads under its row lock: every stored
 * relationship id, whatever its target's status, and the write language's
 * stored translations. A live document rebuilt from anything less makes an
 * unchanged protected value read as a change, and readiness then blocks a
 * release whose write succeeds. Each case runs that write as the author
 * afterwards, so the clean answer is shown to be the write's own.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { registerFieldFunctions } from "../../../shared/lib/field-level-registry";
import { resolveVersionsConfig } from "../../versions/resolve-config";

import { seedPlainAuthor } from "./helpers/live-author";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Only the editor-in-chief may write a field this guards. */
const chiefOnly = {
  update: ({ req }: { req: { user?: { email?: string } | null } }) =>
    req.user?.email === "chief@example.com",
};

const open = {
  read: () => true,
  update: () => true,
  publish: () => true,
  unpublish: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      // Localized drafts, with a translation only the chief may write.
      defineCollection({
        slug: "guides",
        localized: true,
        status: true,
        versions: { drafts: true },
        access: open,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "guarded", localized: true, access: chiefOnly }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

/**
 * Topics, and stories kept as drafts that point at them through a junction
 * table, with the relationship only the chief may write. Made as the Schema
 * Builder makes them: a code-first relationship stores its ids on the row, so
 * only a Builder collection keeps a many-to-many in a junction.
 */
async function seedStories(t: TestNextly): Promise<void> {
  await seedBuilderCollection(t.adapter, {
    slug: "topics",
    status: true,
    fields: [{ name: "name", type: "text" }],
  });
  const topics = {
    name: "topics",
    type: "relationship",
    options: { relationType: "manyToMany", target: "topics" },
  };
  await seedBuilderCollection(t.adapter, {
    slug: "stories",
    status: true,
    versions: resolveVersionsConfig({ drafts: true }, true),
    fields: [{ name: "title", type: "text" }, topics],
  });
  // The rules a code-first collection would declare, registered as boot
  // registers them.
  t.getService("rbacAccessControlService").registerCollectionAccess(
    "stories",
    open
  );
  registerFieldFunctions("collection", "stories", [
    { name: "title", type: "text" },
    { ...topics, access: chiefOnly },
  ]);
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

/** A document, stored through the ordinary trusted write. */
async function created(
  t: TestNextly,
  collection: "topics" | "stories" | "guides",
  data: Record<string, unknown>
): Promise<string> {
  const result = await handlerOf(t).createEntry(
    { collectionName: collection, overrideAccess: true },
    data
  );
  const id = (result.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

/**
 * A plain author, who holds read, update, publish and unpublish on
 * `collection`. A code rule only narrows the permission, so the open rules
 * admit the author only once they hold it.
 */
async function permittedAuthor(
  t: TestNextly,
  collection: "stories" | "guides"
): Promise<string> {
  const author = await seedPlainAuthor(t);
  for (const action of ["read", "update", "publish", "unpublish"]) {
    await grantTo(t, author, action, [collection]);
  }
  return author;
}

/** A release holding each document under its action, added by `author`. */
async function releaseOf(
  t: TestNextly,
  author: string,
  documents: Array<{
    collection: "stories" | "guides";
    id: string;
    action: "publish" | "unpublish";
  }>
): Promise<string> {
  const release = await t.nextly.releases.create({ title: "Launch" });
  for (const document of documents) {
    await t.nextly.releases.addMember({
      releaseId: release.id,
      scopeKind: "collection",
      scopeSlug: document.collection,
      entryId: document.id,
      locale: null,
      action: document.action,
      userId: author,
    });
  }
  return release.id;
}

/** The release's own write of one document, as its author. */
async function writeAsAuthor(
  t: TestNextly,
  author: string,
  collection: "stories" | "guides",
  id: string,
  status: "published" | "draft"
): Promise<unknown> {
  const user = (await t.nextly.users.findByID({
    id: author,
  })) as unknown as { email: string };
  return t.nextly.update({
    collection: collection as never,
    id,
    data: { status } as never,
    locale: "*",
    overrideAccess: false,
    user: { id: author, email: user.email, roles: [] },
  } as never);
}

describe.each(getConfiguredTestDialects())(
  "a release's pending change judged against what its write keeps (%s)",
  dialect => {
    it("keeps a protected relationship to a target taken down since as unchanged", async () => {
      const t = await boot(dialect);
      await seedStories(t);
      const author = await permittedAuthor(t, "stories");
      const topic = await created(t, "topics", {
        title: "Weather",
        name: "weather",
        status: "published",
      });
      const going = await created(t, "stories", {
        title: "Draft",
        status: "published",
        topics: [topic],
      });
      const coming = await created(t, "stories", {
        title: "Live",
        status: "published",
        topics: [topic],
      });
      // Pending work on the allowed field only; the relationship is untouched.
      for (const id of [going, coming]) {
        await t.nextly.update({
          collection: "stories" as never,
          id,
          data: { title: "Edited" } as never,
        });
      }
      // The target leaves the published set, and its junction rows stay.
      await t.nextly.update({
        collection: "topics" as never,
        id: topic,
        data: { status: "draft" } as never,
      });
      const releaseId = await releaseOf(t, author, [
        { collection: "stories", id: going, action: "publish" },
        { collection: "stories", id: coming, action: "unpublish" },
      ]);

      expect((await t.nextly.releases.readiness({ releaseId })).hard).toEqual(
        []
      );
      // The write the readiness answered for accepts both.
      await expect(
        writeAsAuthor(t, author, "stories", going, "published")
      ).resolves.toBeDefined();
      await expect(
        writeAsAuthor(t, author, "stories", coming, "draft")
      ).resolves.toBeDefined();
    });

    it("keeps a protected translation the pending change did not touch as unchanged", async () => {
      const t = await boot(dialect);
      const author = await permittedAuthor(t, "guides");
      const going = await created(t, "guides", {
        title: "Draft",
        guarded: "Kept",
        status: "published",
      });
      const coming = await created(t, "guides", {
        title: "Live",
        guarded: "Kept",
        status: "published",
      });
      // Pending work on the allowed translation only.
      for (const id of [going, coming]) {
        await t.nextly.update({
          collection: "guides" as never,
          id,
          data: { title: "Edited" } as never,
        });
      }
      const releaseId = await releaseOf(t, author, [
        { collection: "guides", id: going, action: "publish" },
        { collection: "guides", id: coming, action: "unpublish" },
      ]);

      expect((await t.nextly.releases.readiness({ releaseId })).hard).toEqual(
        []
      );
      // The write the readiness answered for accepts both.
      await expect(
        writeAsAuthor(t, author, "guides", going, "published")
      ).resolves.toBeDefined();
      await expect(
        writeAsAuthor(t, author, "guides", coming, "draft")
      ).resolves.toBeDefined();
    });
  }
);
