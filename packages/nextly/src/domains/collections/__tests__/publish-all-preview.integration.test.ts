// A publish of every language of a collection entry can be previewed,
// language by language, and the preview says what the publish then does.
//
// The preview and the publish read one verdict and pass one gate. The
// plausible broken implementations compute the preview alongside the publish,
// so the two drift (a pending change the preview says goes live and the
// publish refuses, a language it says shows its own content that reads the
// fallback), or name a field the caller may not read where the publish's
// refusal only counts it.

import { afterEach, describe, expect, it } from "vitest";

import {
  superAdminUser,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { runWithRequestCaller } from "../../../auth/caller-scope";
import { defineCollection, number, text } from "../../../config";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ServiceContainer } from "../../../services/index";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const ARTICLES = "previewarticles";

async function boot(dialect: TestDialect): Promise<CollectionEntryService> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: ARTICLES,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title", localized: true }),
          // Shared by every language.
          text({ name: "tagline", localized: false }),
          // Shared, readable, and no caller may write it.
          text({
            name: "lockState",
            localized: false,
            access: { update: () => false },
          }),
          // Shared, and no caller may read it.
          number({
            name: "internalScore",
            localized: false,
            access: { read: () => false, update: () => false },
          }),
        ],
      }),
    ],
    localization: { locales: ["en", "de", "fr"], defaultLocale: "en" },
  });
  return (
    current.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

const at = (entryId: string, locale: string) => ({
  collectionName: ARTICLES,
  entryId,
  locale,
  overrideAccess: true,
});

async function save(
  entries: CollectionEntryService,
  entryId: string,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  const saved = await entries.updateEntry(at(entryId, locale), {
    ...data,
    _overwrite: true,
  });
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

/** An entry live in English, with `data` its first values. */
async function liveEntry(
  entries: CollectionEntryService,
  data: Record<string, unknown>
): Promise<string> {
  const created = await entries.createEntry(
    { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
    { ...data, status: "published" }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  return (created.data as { id: string }).id;
}

interface Preview {
  id: string;
  languages: { locale: string; outcome: string }[];
  blockers: unknown[];
}

const previewOf = (result: { data?: unknown }) => result.data as Preview;

async function titleIn(
  entries: CollectionEntryService,
  id: string,
  locale: string
): Promise<unknown> {
  const read = await entries.getEntry(at(id, locale));
  return (read.data as { title?: unknown } | null)?.title;
}

describe.each(getConfiguredTestDialects())(
  "previewing a publish of every language of a collection entry (integration, %s)",
  dialect => {
    it("says what the publish does to each language, and the publish does it", async () => {
      const entries = await boot(dialect);
      const id = await liveEntry(entries, { title: "Hello" });
      // English's pending change, and German's first text, held as a
      // pending change too: the entry is live.
      await save(entries, id, "en", { title: "Hello again" });
      await save(entries, id, "de", { title: "Hallo" });
      const every = { collectionName: ARTICLES, entryId: id };

      const preview = await entries.previewPublishAllLocales({
        ...every,
        overrideAccess: true,
      });
      expect(preview.success, JSON.stringify(preview)).toBe(true);
      expect(previewOf(preview)).toEqual({
        id,
        languages: [
          { locale: "en", outcome: "goes-live-with-pending-change" },
          { locale: "de", outcome: "goes-live-with-pending-change" },
          { locale: "fr", outcome: "shows-fallback", fallback: "en" },
        ],
        blockers: [],
      });

      const published = await entries.publishAllLocales({
        ...every,
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(published.success, JSON.stringify(published)).toBe(true);
      expect(
        (published.data as { languages?: unknown } | null)?.languages
      ).toEqual(previewOf(preview).languages);
      expect(await titleIn(entries, id, "en")).toBe("Hello again");
      expect(await titleIn(entries, id, "de")).toBe("Hallo");
    });

    it("names the out-of-date fields the publish refuses over, and counts the ones the caller can't read", async () => {
      const entries = await boot(dialect);
      const id = await liveEntry(entries, {
        title: "Hello",
        tagline: "Old",
        internalScore: 1,
      });
      await save(entries, id, "de", { title: "Hallo", status: "published" });
      // German's pending change begins from the live shared values...
      await save(entries, id, "de", { title: "Hallo wieder" });
      // ...and English then publishes new ones.
      await save(entries, id, "en", {
        tagline: "New",
        internalScore: 2,
        status: "published",
      });

      // A routed request: trusted, but answering to the caller's field read
      // rules, which no caller passes for the score.
      const every = {
        collectionName: ARTICLES,
        entryId: id,
        overrideAccess: true,
        routeAuthorized: true,
      };
      const preview = await entries.previewPublishAllLocales(every);
      expect(preview.success, JSON.stringify(preview)).toBe(true);
      expect(
        previewOf(preview).languages.find(language => language.locale === "de")
      ).toEqual({
        locale: "de",
        outcome: "out-of-date",
        fields: ["tagline"],
        hiddenCount: 1,
      });

      const refused = await entries.publishAllLocales({
        ...every,
        data: { _overwrite: true },
      });
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(409);
      expect((refused as { publicData?: unknown }).publicData).toMatchObject({
        reason: "shared-fields-out-of-date",
        fields: ["tagline"],
        hiddenCount: 1,
      });
    });

    it("tells only a caller who may publish what a publish would do", async () => {
      const entries = await boot(dialect);
      const id = await liveEntry(entries, { title: "Hello" });
      await save(entries, id, "en", { title: "Hello again" });
      await userWhoMay(current!, "reader-1", "read", [ARTICLES]);
      await userWhoMay(current!, "publisher-1", "publish", [ARTICLES]);
      const asked = (userId: string) =>
        entries.previewPublishAllLocales({
          collectionName: ARTICLES,
          entryId: id,
          user: { id: userId },
          overrideAccess: false,
        });

      const refused = await asked("reader-1");
      expect(refused.statusCode).toBe(403);
      expect(refused.data ?? null).toBeNull();

      const told = await asked("publisher-1");
      expect(told.success, JSON.stringify(told)).toBe(true);
      expect(previewOf(told).languages[0]).toEqual({
        locale: "en",
        outcome: "goes-live-with-pending-change",
      });
    });

    it("answers over REST with the preview, kept to the caller who asked", async () => {
      const entries = await boot(dialect);
      const id = await liveEntry(entries, { title: "Hello" });
      await save(entries, id, "en", { title: "Hello again" });
      const admin = await superAdminUser(current!, "admin-1");

      const response = (await runWithRequestCaller(
        {
          userId: admin,
          actor: { type: "user", id: admin },
          roles: ["super-admin"],
        },
        () =>
          dispatchCollections(
            new ServiceContainer(current!.adapter),
            "previewPublishAllLocales",
            { collectionName: ARTICLES, entryId: id } as never,
            undefined
          )
      )) as Response;

      expect(response.status).toBe(200);
      // Who may publish, and which fields they may read, decide the answer,
      // so no shared cache may hand it to anyone else.
      expect(response.headers.get("cache-control")).toMatch(/private/);
      expect(response.headers.get("cache-control")).toMatch(/no-store/);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        id,
        blockers: [],
        languages: expect.arrayContaining([
          { locale: "en", outcome: "goes-live-with-pending-change" },
        ]),
      });
    });

    it("reports a pending change the caller may not publish, as the publish refuses it", async () => {
      const entries = await boot(dialect);
      const id = await liveEntry(entries, {
        title: "Hello",
        lockState: "open",
      });
      // English's pending change edits a field no caller may write.
      await save(entries, id, "en", {
        title: "Hello again",
        lockState: "shut",
      });
      await userWhoMay(current!, "publisher-1", "publish", [ARTICLES]);
      const every = {
        collectionName: ARTICLES,
        entryId: id,
        user: { id: "publisher-1" },
        overrideAccess: false,
      };

      const preview = await entries.previewPublishAllLocales(every);
      expect(preview.success, JSON.stringify(preview)).toBe(true);
      expect(previewOf(preview).blockers).toEqual([
        { reason: "pending-change-forbidden", fields: ["lockState"] },
      ]);

      const refused = await entries.publishAllLocales({
        ...every,
        data: { _overwrite: true },
      });
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(400);
      expect((refused as { publicData?: unknown }).publicData).toMatchObject({
        errors: [
          expect.objectContaining({ path: "lockState", code: "FORBIDDEN" }),
        ],
      });
    });
  }
);
