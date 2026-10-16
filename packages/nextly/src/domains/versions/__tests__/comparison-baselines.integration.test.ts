/**
 * A comparison starts from a useful baseline, resolved on the server: the
 * previous version of the same part, what is published, the current draft, or
 * one the reader picks; with defaults that open on the comparison a reader
 * most likely wants. Histories are seeded so each case is exact, then compared
 * through the same function REST's diff route calls.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { getVersionDiffForDocument } from "../../../dispatcher/handlers/versions-methods";
import { NextlyError } from "../../../errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { registerComparisonBaseline } from "../comparison-baselines";
import { VersionsRepository } from "../versions-repository";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const superAdmin = { id: "tester", roles: ["super-admin"] };

type Seed = {
  status: "draft" | "published";
  locale: string | null;
  title: string;
};

/**
 * A translated collection whose first version (v1, English, draft) comes from
 * a real create; the rest of the history is seeded in order, from v2.
 */
async function documentWithHistory(dialect: TestDialect, seeds: Seed[]) {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        status: true,
        versions: { drafts: false, maxPerDoc: false },
        fields: [text({ name: "title" })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  const handler = current.getService("collectionsHandler");
  const created = await handler.createEntry(
    { collectionName: "posts", overrideAccess: true, locale: "en" },
    { title: "v1", status: "draft" }
  );
  const id = (created.data as { id: string }).id;
  const repo = new VersionsRepository(
    current.adapter as unknown as ConstructorParameters<
      typeof VersionsRepository
    >[0]
  );
  const ref = {
    scopeKind: "collection" as const,
    scopeSlug: "posts",
    entryId: id,
  };
  let versionNo = 2;
  for (const seed of seeds) {
    await repo.insertVersion({
      ref,
      versionNo,
      status: seed.status,
      isAutosave: false,
      snapshot: { title: seed.title },
      locale: seed.locale,
    });
    versionNo += 1;
  }
  return id;
}

function compare(
  id: string,
  args: { from?: number; to?: number; baseline?: string; locale?: string }
) {
  return getVersionDiffForDocument({
    scopeKind: "collection",
    slug: "posts",
    entryId: id,
    user: superAdmin,
    ...args,
  });
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err
  );
  expect(NextlyError.is(error)).toBe(true);
  return error as NextlyError;
}

// v1 en draft (the create), then:
const history: Seed[] = [
  { status: "published", locale: "en", title: "en published" }, // v2
  { status: "draft", locale: "de", title: "de draft" }, // v3
  { status: "draft", locale: "en", title: "en edit 1" }, // v4
  { status: "published", locale: "de", title: "de published" }, // v5
  { status: "draft", locale: "en", title: "en edit 2" }, // v6
];

describe.each(getConfiguredTestDialects())(
  "comparison baselines (integration, %s)",
  dialect => {
    it("compares with the previous version of the same part", async () => {
      const id = await documentWithHistory(dialect, history);
      // v6's previous English version is v4, not v5 (German).
      const diff = await compare(id, { to: 6, baseline: "previous" });
      expect(diff).toMatchObject({
        from: 4,
        to: 6,
        locale: "en",
        baseline: { name: "previous", versionNo: 4 },
      });
    });

    it("compares with what is published in the same part", async () => {
      const id = await documentWithHistory(dialect, history);
      const en = await compare(id, { to: 6, baseline: "published" });
      expect(en).toMatchObject({ from: 2, to: 6 });
      // German's own published version, not English's.
      const de = await compare(id, { to: 3, baseline: "published" });
      expect(de).toMatchObject({ from: 5, to: 3, locale: "de" });
    });

    it("compares with the current draft of the same part", async () => {
      const id = await documentWithHistory(dialect, history);
      // English's current draft is its newest draft after its latest publish.
      const diff = await compare(id, { to: 2, baseline: "draft" });
      expect(diff).toMatchObject({
        from: 6,
        to: 2,
        baseline: { name: "draft", versionNo: 6 },
      });
    });

    it("opens on the draft against what is live when both exist", async () => {
      const id = await documentWithHistory(dialect, history);
      const en = await compare(id, { locale: "en" });
      expect(en).toMatchObject({
        from: 2,
        to: 6,
        baseline: { name: "published", versionNo: 2 },
      });
    });

    it("opens on a version against the one before it while nothing is published", async () => {
      const id = await documentWithHistory(dialect, [
        { status: "draft", locale: "en", title: "second" }, // v2
        { status: "draft", locale: "en", title: "third" }, // v3
      ]);
      const diff = await compare(id, { locale: "en" });
      expect(diff).toMatchObject({
        from: 2,
        to: 3,
        baseline: { name: "previous", versionNo: 2 },
      });
    });

    it("says there is no baseline for a part's first version", async () => {
      const id = await documentWithHistory(dialect, []);
      const error = await refusal(compare(id, { to: 1, baseline: "previous" }));
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(error.publicData)).toContain("NO_BASELINE");
    });

    it("still compares an explicit pair", async () => {
      const id = await documentWithHistory(dialect, history);
      const diff = await compare(id, { from: 2, to: 4 });
      expect(diff).toMatchObject({ from: 2, to: 4 });
      expect(diff.baseline).toBeUndefined();
    });

    it("refuses a malformed target as invalid, not as missing", async () => {
      const id = await documentWithHistory(dialect, history);
      for (const to of [0, Number.NaN, 2.5]) {
        const error = await refusal(compare(id, { to, baseline: "previous" }));
        expect(error.code).toBe("VALIDATION_ERROR");
        expect(JSON.stringify(error.publicData)).toContain("INVALID_VALUE");
      }
    });

    it("tells a baseline of no user when an API key compares", async () => {
      const seen: (string | null)[] = [];
      registerComparisonBaseline({
        name: `test-who-${dialect}`,
        label: "Who is comparing",
        resolve: ({ userId, versions }) => {
          seen.push(userId);
          return versions[versions.length - 1]?.versionNo ?? null;
        },
      });
      const id = await documentWithHistory(dialect, history);

      await getVersionDiffForDocument({
        scopeKind: "collection",
        slug: "posts",
        entryId: id,
        user: superAdmin,
        to: 6,
        baseline: `test-who-${dialect}`,
      });
      await getVersionDiffForDocument({
        scopeKind: "collection",
        slug: "posts",
        entryId: id,
        user: superAdmin,
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["read-posts"],
        } as unknown as Parameters<
          typeof getVersionDiffForDocument
        >[0]["authenticatedScope"],
        to: 6,
        baseline: `test-who-${dialect}`,
      });

      // A person's comparison carries them; the key's carries no user.
      expect(seen).toEqual(["tester", null]);
    });

    it("refuses to compare a draft saved before saves were recorded", async () => {
      const id = await documentWithHistory(dialect, [
        { status: "published", locale: "en", title: "en published" }, // v2
      ]);
      // A working draft with no draft version after the publish.
      await new VersionsRepository(
        current!.adapter as unknown as ConstructorParameters<
          typeof VersionsRepository
        >[0]
      ).upsertWorkingDraft({
        ref: { scopeKind: "collection", scopeSlug: "posts", entryId: id },
        locale: "en",
        snapshot: { title: "pending" },
      });

      const error = await refusal(compare(id, { locale: "en" }));
      expect(JSON.stringify(error.publicData)).toContain("NO_BASELINE");
      expect(JSON.stringify(error.publicData)).toContain("Save it once");
    });

    it("refuses a pair and a baseline together, and an unknown baseline", async () => {
      const id = await documentWithHistory(dialect, history);
      const both = await refusal(
        compare(id, { from: 2, to: 4, baseline: "previous" })
      );
      expect(both.code).toBe("VALIDATION_ERROR");
      const unknown = await refusal(
        compare(id, { to: 4, baseline: "since-lunch" })
      );
      expect(unknown.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(unknown.publicData)).toContain("previous");
    });
  }
);
