/**
 * A held draft of a document without languages compares with its earlier
 * saves, on every dialect.
 *
 * In an install that has languages, a collection without them still tags a
 * save whose snapshot carries a component with the default language, since
 * the component was read in it. A held draft's version is tagged the same way,
 * and a comparison of a document without languages reads an untagged version
 * and a default-language one as the same part, so rows already stored untagged
 * compare too, with no stored data rewritten.
 */

process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { getVersionDiffForDocument } from "../../../dispatcher/handlers/versions-methods";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { seedLiveAuthor } from "../../releases/__tests__/helpers/live-author";
import { VersionsRepository } from "../versions-repository";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    fieldGroups: [
      defineFieldGroup({ slug: "hero", fields: [text({ name: "heading" })] }),
    ],
    collections: [
      // No languages of its own, with a component.
      defineCollection({
        slug: "notes",
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "hero", component: "hero" }),
        ],
      }),
    ],
  });
  await seedPermissionsAndRolePresets();
  // The first person is a super-admin, who may read every version.
  const reader = await seedLiveAuthor(current);
  return { t: current, reader };
}

/** Each durable version, oldest first, with its language tag. */
async function versionsOf(t: TestNextly, entryId: string) {
  const rows = await t.getService("versionsService").list(
    { scopeKind: "collection", scopeSlug: "notes", entryId },
    {
      limit: 50,
    }
  );
  return [...rows]
    .reverse()
    .filter(row => typeof row.versionNo === "number")
    .map(row => ({
      versionNo: row.versionNo!,
      locale: row.locale,
      status: row.status,
    }));
}

describe.each(getConfiguredTestDialects())(
  "a held draft without languages, compared (integration, %s)",
  dialect => {
    it("is tagged as other saves are, and compares with an earlier save", async () => {
      const { t, reader } = await boot(dialect);
      const created = await t.nextly.create({
        collection: "notes",
        data: { title: "live", hero: { heading: "h1" }, status: "published" },
      });
      const id = (created.item as { id: string }).id;
      // No status on a published document: the edit is held as a draft.
      await t.nextly.update({
        collection: "notes",
        id,
        data: { hero: { heading: "h2" } },
      });

      const versions = await versionsOf(t, id);
      const draft = versions.at(-1)!;
      const save = versions.at(-2)!;
      expect(draft.status).toBe("draft");
      // The draft's version carries the language its component was read in,
      // as the save before it does.
      expect([save.locale, draft.locale]).toEqual(["en", "en"]);

      const diff = await getVersionDiffForDocument({
        scopeKind: "collection",
        slug: "notes",
        entryId: id,
        user: { id: reader },
        from: save.versionNo,
        to: draft.versionNo,
      });
      expect(diff.hasChanges).toBe(true);
    }, 120_000);

    it("compares a version stored untagged with a default-language one", async () => {
      const { t, reader } = await boot(dialect);
      const created = await t.nextly.create({
        collection: "notes",
        data: { title: "live", hero: { heading: "h1" }, status: "published" },
      });
      const id = (created.item as { id: string }).id;
      const [save] = await versionsOf(t, id);
      expect(save!.locale).toBe("en");
      // A held draft stored before drafts were tagged: no language.
      const repo = new VersionsRepository(
        t.adapter as unknown as ConstructorParameters<
          typeof VersionsRepository
        >[0]
      );
      await repo.insertVersion({
        ref: { scopeKind: "collection", scopeSlug: "notes", entryId: id },
        versionNo: save!.versionNo + 1,
        status: "draft",
        isAutosave: false,
        snapshot: { title: "live", hero: { heading: "h2" } },
        locale: null,
      });

      const diff = await getVersionDiffForDocument({
        scopeKind: "collection",
        slug: "notes",
        entryId: id,
        user: { id: reader },
        from: save!.versionNo,
        to: save!.versionNo + 1,
      });
      expect(diff.hasChanges).toBe(true);
    }, 120_000);
  }
);
