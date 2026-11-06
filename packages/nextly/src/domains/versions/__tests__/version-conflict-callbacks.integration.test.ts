/**
 * A version_no allocation race, retried by the adapter rather than around it,
 * on every write that captures a version in a transaction of its own: a
 * collection entry's update and its publish of every language, a Single's
 * update and its publish of every language, and a versioned Single's default
 * document, made on its first read.
 *
 * Each attempt registers what should run once its transaction ends. The first
 * attempt loses the race, rolls back and is tried again; the second commits.
 * Retried inside the adapter, the adapter knows the first attempt was not the
 * last: its commit callback is dropped with it, its rollback callback never
 * runs, and the second attempt's commit callback runs once. Retried around the
 * adapter, each attempt is a transaction that ends for good, so the first
 * attempt's rollback callback runs although the write went on to commit; not
 * retried at all, the first attempt's conflict is the answer.
 *
 * When every attempt loses, the conflict itself reaches the caller, a 409,
 * and only the last attempt's rollback callback runs.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { VersionCaptureService } from "../version-capture-service";
import { VersionConflictError } from "../version-conflict";

let handle: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await handle?.destroy();
  handle = undefined;
});

/** A versioned collection, and one with languages and Draft/Published. */
const POSTS = "posts";
const ARTICLES = "articles";
/** A versioned Single, one with languages and Draft/Published, one never read. */
const BANNER = "banner";
const NOTICE = "notice";
const PREFERENCES = "preferences";

interface Booted {
  entries: CollectionEntryService;
  singles: SingleEntryService;
  adapter: DrizzleAdapter;
}

async function boot(dialect: TestDialect): Promise<Booted> {
  handle = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        versions: true,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: ARTICLES,
        versions: true,
        localized: true,
        status: true,
        fields: [text({ name: "heading", localized: true })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        versions: true,
        fields: [text({ name: "title" })],
      }),
      defineSingle({
        slug: NOTICE,
        versions: true,
        localized: true,
        status: true,
        fields: [text({ name: "headline", localized: true })],
      }),
      defineSingle({
        slug: PREFERENCES,
        versions: true,
        fields: [text({ name: "title" })],
      }),
    ],
    localization: { locales: ["en", "fr"], defaultLocale: "en" },
  });
  return {
    entries: (
      handle.getService("collectionsHandler") as CollectionsHandler
    ).getEntryService() as CollectionEntryService,
    singles: handle.getService("singleEntryService"),
    adapter: handle.adapter as unknown as DrizzleAdapter,
  };
}

/**
 * Each write whose transaction retries a version conflict: `prepare` makes
 * what it writes to, before the race is staged; `write` is the call under
 * test, whose answer is returned or thrown.
 */
const WRITES: ReadonlyArray<{
  name: string;
  prepare: (b: Booted) => Promise<() => Promise<unknown>>;
}> = [
  {
    name: "a collection entry's update",
    prepare: async ({ entries }) => {
      const created = await entries.createEntry(
        { collectionName: POSTS, overrideAccess: true },
        { title: "first" }
      );
      const entryId = (created.data as { id: string }).id;
      return () =>
        entries.updateEntry(
          { collectionName: POSTS, entryId, overrideAccess: true },
          { title: "second" }
        );
    },
  },
  {
    name: "a collection entry's publish of every language",
    prepare: async ({ entries }) => {
      const created = await entries.createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        { heading: "en", status: "draft" }
      );
      const entryId = (created.data as { id: string }).id;
      return () =>
        entries.publishAllLocales({
          collectionName: ARTICLES,
          entryId,
          overrideAccess: true,
        });
    },
  },
  {
    name: "a Single's update",
    prepare: async ({ singles }) => {
      // Its default document, and that document's first version, made now.
      await singles.get(BANNER, { overrideAccess: true });
      return () =>
        singles.update(BANNER, { title: "second" }, { overrideAccess: true });
    },
  },
  {
    name: "a Single's publish of every language",
    prepare: async ({ singles }) => {
      await singles.update(
        NOTICE,
        { headline: "en" },
        { locale: "en", overrideAccess: true }
      );
      return () => singles.publishAllLocales(NOTICE, { overrideAccess: true });
    },
  },
  {
    name: "a Single's default document, made on its first read",
    prepare:
      async ({ singles }) =>
      () =>
        singles.get(PREFERENCES, { overrideAccess: true }),
  },
];

/**
 * Makes version capture lose the allocation race on the attempts `loses`
 * names. An attempt is a transaction: the first capture in each registers a
 * commit and a rollback callback, recorded in `ran`.
 */
function stageRace(
  adapter: DrizzleAdapter,
  loses: (attempt: number) => boolean
) {
  const ran: string[] = [];
  const attempts = new Map<unknown, number>();
  const capture = VersionCaptureService.prototype.capture;
  vi.spyOn(VersionCaptureService.prototype, "capture").mockImplementation(
    async function (this: VersionCaptureService, tx, input) {
      if (!attempts.has(tx)) {
        const at = attempts.size + 1;
        attempts.set(tx, at);
        await adapter.afterCommit(() => ran.push(`commit ${String(at)}`));
        await adapter.afterRollback(() => ran.push(`rollback ${String(at)}`));
        if (loses(at)) throw new VersionConflictError();
      }
      return Reflect.apply(capture, this, [tx, input]);
    }
  );
  return { ran, attempts: () => attempts.size };
}

/** What a write answered, whether it returned it or threw it. */
async function answerOf(write: () => Promise<unknown>): Promise<unknown> {
  try {
    return await write();
  } catch (error) {
    return error;
  }
}

describe.each(getConfiguredTestDialects())(
  "a version conflict retried by the adapter (%s)",
  dialect => {
    it.each(WRITES)(
      "runs the committed attempt's callback once, and no lost attempt's: $name",
      async ({ prepare }) => {
        const b = await boot(dialect);
        const write = await prepare(b);
        const race = stageRace(b.adapter, at => at === 1);

        const answer = await answerOf(write);

        expect(answer).not.toBeInstanceOf(Error);
        expect(answer).not.toMatchObject({ success: false });
        expect(race.attempts()).toBe(2);
        expect(race.ran).toEqual(["commit 2"]);
      }
    );

    it.each(WRITES)(
      "answers 409 once every attempt has lost, running the last one's rollback callback only: $name",
      async ({ prepare }) => {
        const b = await boot(dialect);
        const write = await prepare(b);
        const race = stageRace(b.adapter, () => true);

        const answer = await answerOf(write);

        // Three attempts, and the conflict itself reaches the caller, not a
        // classification of it.
        expect(race.attempts()).toBe(3);
        expect(answer).toMatchObject({ statusCode: 409, code: "CONFLICT" });
        expect(race.ran).toEqual(["rollback 3"]);
      }
    );
  }
);
