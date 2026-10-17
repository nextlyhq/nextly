/**
 * A single-document release, against a REAL database.
 *
 * What only an integration test can establish is that the one-member rule is
 * the database's, not a count's: two adds racing past the service's early
 * check both reach the insert, and only the unique single-slot index stops the
 * second. That holds on every dialect or it holds on none, so the race is run
 * on each one the integration run configures; CI covers SQLite, PostgreSQL
 * and MySQL. The `kind` filter is checked here too, through the same Direct
 * API a caller uses.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ReleasesRepository } from "../releases-repository";

import { seedLiveAuthor } from "./helpers/live-author";
import { ANY_EDITABLE_STATE } from "./helpers/release-writes";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

/** A drafted post, by id. */
async function post(t: TestNextly, title: string): Promise<string> {
  const created = await t.nextly.create({
    collection: "posts",
    data: { title, status: "draft" },
    overrideAccess: true,
  });
  const id = (created.item as { id?: unknown }).id;
  if (typeof id !== "string") throw new Error("the post has no id");
  return id;
}

/** Add a post to a release as `userId`, through the Direct API. */
function add(
  t: TestNextly,
  releaseId: string,
  entryId: string,
  userId: string
) {
  return t.nextly.releases.addMember({
    releaseId,
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId,
    locale: null,
    action: "publish",
    userId,
  });
}

describe.each(getConfiguredTestDialects())(
  "a single-document release (%s)",
  dialect => {
    it("stores the kind, and reads a release made without one as ordinary", async () => {
      const t = await boot(dialect);
      const single = await t.nextly.releases.create({
        title: "Launch post",
        kind: "single",
      });
      const plain = await t.nextly.releases.create({ title: "Spring" });
      expect(single.kind).toBe("single");
      expect(plain.kind).toBe("release");
      const read = await t.nextly.releases.findByID({ id: single.id });
      expect(read?.kind).toBe("single");
    });

    it("refuses a second document, naming what to do instead", async () => {
      const t = await boot(dialect);
      const userId = await seedLiveAuthor(t);
      const release = await t.nextly.releases.create({
        title: "Launch post",
        kind: "single",
      });
      await add(t, release.id, await post(t, "first"), userId);
      await expect(
        add(t, release.id, await post(t, "second"), userId)
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringMatching(/ordinary release/),
      });
      const members = await t.nextly.releases.listMembers({
        releaseId: release.id,
      });
      expect(members).toHaveLength(1);
    });

    it("lets an ordinary release take many documents", async () => {
      // The control: a rule that refused every second member would pass the
      // case above.
      const t = await boot(dialect);
      const userId = await seedLiveAuthor(t);
      const release = await t.nextly.releases.create({ title: "Spring" });
      for (const title of ["one", "two", "three"]) {
        await add(t, release.id, await post(t, title), userId);
      }
      const members = await t.nextly.releases.listMembers({
        releaseId: release.id,
      });
      expect(members).toHaveLength(3);
    });

    it("keeps exactly one when two adds race past the early check", async () => {
      // Both adds are started before either writes, so both can count an
      // empty release. Whatever interleaving the engine gives them, one lands
      // and the other is refused — by the index, when the count saw nothing.
      const t = await boot(dialect);
      const userId = await seedLiveAuthor(t);
      const release = await t.nextly.releases.create({
        title: "Launch post",
        kind: "single",
      });
      const [a, b] = [await post(t, "a"), await post(t, "b")];
      const outcomes = await Promise.allSettled([
        add(t, release.id, a, userId),
        add(t, release.id, b, userId),
      ]);
      expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
      const refused = outcomes.find(o => o.status === "rejected");
      expect(refused).toMatchObject({ reason: { code: "CONFLICT" } });
      const members = await t.nextly.releases.listMembers({
        releaseId: release.id,
      });
      expect(members).toHaveLength(1);
    });

    it("refuses a second member at the database, whatever the caller checked", async () => {
      // Below the service, so no count runs at all: what is left is the
      // single-slot index, and it alone has to refuse the second row.
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({
        title: "Launch post",
        kind: "single",
      });
      const member = (entryId: string) => ({
        releaseId: release.id,
        scopeKind: "collection" as const,
        scopeSlug: "posts",
        entryId,
        locale: null,
        action: "publish" as const,
      });
      await repo.addMember(member(await post(t, "first")), ANY_EDITABLE_STATE);
      await expect(
        repo.addMember(member(await post(t, "second")), ANY_EDITABLE_STATE)
      ).rejects.toThrow();
      expect(await repo.listMembers(release.id)).toHaveLength(1);
    });

    it("filters the list and the count by kind", async () => {
      const t = await boot(dialect);
      await t.nextly.releases.create({ title: "Launch post", kind: "single" });
      await t.nextly.releases.create({ title: "Spring" });
      await t.nextly.releases.create({ title: "Summer" });

      const ordinary = await t.nextly.releases.find({ kind: "release" });
      expect(ordinary.items.map(row => row.title).sort()).toEqual([
        "Spring",
        "Summer",
      ]);
      expect(ordinary.meta.total).toBe(2);
      expect(await t.nextly.releases.count({ kind: "release" })).toBe(2);

      const singles = await t.nextly.releases.find({ kind: "single" });
      expect(singles.items.map(row => row.title)).toEqual(["Launch post"]);
      expect(await t.nextly.releases.count({ kind: "single" })).toBe(1);
      expect(await t.nextly.releases.count({})).toBe(3);
    });
  }
);
