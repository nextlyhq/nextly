/**
 * A release's run is never judged by version.
 *
 * A release moves each document's state as it stands when the release runs,
 * as it was scheduled to: a save made after the release was scheduled must
 * not stop it. The run carries no version of its own, so it is applied as an
 * unjudged write, document-wide members (every language) included, and the
 * document's version still moves, since a run is a real change of its state.
 *
 * @module domains/releases/__tests__/release-run-not-judged.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ReleasesRepository } from "../releases-repository";

import { seedLiveAuthor } from "./helpers/live-author";
import {
  ANY_EDITABLE_STATE,
  scheduleAsItStands,
} from "./helpers/release-writes";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const POSTS = "rn_posts";
const PAGES = "rn_pages";
const DAY = 24 * 60 * 60 * 1000;

const OPEN = {
  read: () => true,
  update: () => true,
  publish: () => true,
  unpublish: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        access: OPEN,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: PAGES,
        localized: true,
        status: true,
        access: OPEN,
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing
  // about those databases.
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

async function create(
  t: TestNextly,
  slug: string,
  data: Record<string, unknown>
): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: slug, overrideAccess: true, locale: "en" },
    data
  );
  return String((created.data as { id: string }).id);
}

async function stored(
  t: TestNextly,
  slug: string,
  id: string
): Promise<Record<string, unknown>> {
  const row = await t.adapter.selectOne<Record<string, unknown>>(`dc_${slug}`, {
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  if (!row) throw new Error(`no ${id} in ${slug}`);
  return row;
}

/** A release of `member`, scheduled for next week: only a run of it moves the document. */
async function scheduled(
  t: TestNextly,
  member: {
    slug: string;
    entryId: string;
    action: "publish" | "unpublish";
  }
): Promise<string> {
  const author = await seedLiveAuthor(t);
  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({
    title: "Launch",
    createdBy: author,
  });
  await repo.addMember(
    {
      releaseId: release.id,
      scopeKind: "collection",
      scopeSlug: member.slug,
      entryId: member.entryId,
      // The whole document, every language.
      locale: null,
      action: member.action,
      createdBy: author,
    },
    ANY_EDITABLE_STATE
  );
  await scheduleAsItStands(
    repo,
    release.id,
    new Date(Date.now() + 7 * DAY),
    "UTC"
  );
  return release.id;
}

describe.each(getConfiguredTestDialects())(
  "a release's run is not judged by version (%s)",
  dialect => {
    it("applies a release to a document saved after the release was scheduled", async () => {
      const t = await boot(dialect);
      const id = await create(t, POSTS, { title: "draft", status: "draft" });
      const release = await scheduled(t, {
        slug: POSTS,
        entryId: id,
        action: "publish",
      });
      // Saved after the release was scheduled: a run judged against what the
      // document was when it was scheduled would refuse it.
      await handlerOf(t).updateEntry(
        { collectionName: POSTS, entryId: id, overrideAccess: true },
        { title: "saved since" }
      );
      const before = Number((await stored(t, POSTS, id))._revision);

      const ran = await t.nextly.releases.publishNow({ id: release });

      expect(ran.state).toBe("published");
      const after = await stored(t, POSTS, id);
      expect(after.status).toBe("published");
      expect(after.title).toBe("saved since");
      // The run is a real change of the document's state: its version moves.
      expect(Number(after._revision)).toBeGreaterThan(before);
    });

    it("applies a release that takes a document down, after a save since it was scheduled", async () => {
      const t = await boot(dialect);
      const id = await create(t, POSTS, {
        title: "live",
        status: "published",
      });
      const release = await scheduled(t, {
        slug: POSTS,
        entryId: id,
        action: "unpublish",
      });
      await handlerOf(t).updateEntry(
        { collectionName: POSTS, entryId: id, overrideAccess: true },
        { title: "saved since" }
      );

      const ran = await t.nextly.releases.publishNow({ id: release });

      expect(ran.state).toBe("published");
      expect((await stored(t, POSTS, id)).status).toBe("draft");
    });

    it("applies a release of every language after one language was saved since", async () => {
      const t = await boot(dialect);
      const id = await create(t, PAGES, { title: "hello", status: "draft" });
      await handlerOf(t).updateEntry(
        {
          collectionName: PAGES,
          entryId: id,
          overrideAccess: true,
          locale: "es",
        },
        { title: "hola" }
      );
      const release = await scheduled(t, {
        slug: PAGES,
        entryId: id,
        action: "publish",
      });
      // A Spanish save since: a publish of every language from a version
      // read before it would be refused, and a run carries none.
      await handlerOf(t).updateEntry(
        {
          collectionName: PAGES,
          entryId: id,
          overrideAccess: true,
          locale: "es",
        },
        { title: "hola otra vez" }
      );

      const ran = await t.nextly.releases.publishNow({ id: release });

      expect(ran.state).toBe("published");
      expect((await stored(t, PAGES, id)).status).toBe("published");
      const q = (name: string) =>
        t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const p = t.adapter.dialect === "postgresql" ? "$1" : "?";
      const languages = await t.adapter.executeQuery<Record<string, unknown>>(
        `SELECT ${q("_locale")}, ${q("_status")} FROM ${q(`dc_${PAGES}_locales`)} WHERE ${q("_parent")} = ${p}`,
        [id]
      );
      expect(languages.map(row => [row._locale, row._status]).sort()).toEqual([
        ["en", "published"],
        ["es", "published"],
      ]);
    });
  }
);
