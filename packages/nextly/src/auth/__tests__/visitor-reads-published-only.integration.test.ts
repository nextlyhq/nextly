/**
 * A visitor reads published content only, whatever the Public role holds.
 *
 * A checked call with no user (`overrideAccess: false`) is judged by the
 * Public role. Boot seeding grants Public the read of a collection or Single
 * whose read rule answers a visitor `true`, so these visitors may read. A read
 * asking for drafts (`status: "draft"` or `"all"`) still returns what is
 * published and nothing else: a visitor never sees a draft.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../config";
import { Nextly } from "../../direct-api/nextly";
import { seedPermissionsAndRolePresets } from "../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";

type Doc = Record<string, unknown>;

const posts = defineCollection({
  slug: "vposts",
  status: true,
  access: { read: () => true },
  fields: [text({ name: "title" })],
});

const page = defineSingle({
  slug: "vpage",
  status: true,
  access: { read: () => true },
  fields: [text({ name: "title" })],
});

const titlesOf = (result: unknown) =>
  ((result as { items?: Doc[] }).items ?? []).map(item => item.title).sort();

describe.each(getConfiguredTestDialects())(
  "a visitor reads published content only (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let visitor: Nextly;
    let draftId = "";

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [posts],
        singles: [page],
      });
      // The boot's seeding: permissions, the Public role, and its read of
      // `vposts` and `vpage`, whose read rules answer `true`.
      await seedPermissionsAndRolePresets();
      trusted = new Nextly();
      visitor = new Nextly({ overrideAccess: false });

      await trusted.create({
        collection: "vposts",
        data: { title: "published", status: "published" },
      } as never);
      const draft = await trusted.create({
        collection: "vposts",
        data: { title: "draft", status: "draft" },
      } as never);
      draftId = String((draft.item as { id: string | number }).id);

      // Saved published, then as a draft: the Single's one row is the draft.
      await trusted.updateSingle({
        slug: "vpage",
        data: { title: "published page", status: "published" },
      } as never);
      await trusted.updateSingle({
        slug: "vpage",
        data: { title: "draft page", status: "draft" },
      } as never);
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("lets a visitor read what is published", async () => {
      // The control: a visitor may read here, so a refusal below is about
      // drafts, not about reading at all.
      expect(
        titlesOf(await visitor.find({ collection: "vposts" } as never))
      ).toEqual(["published"]);
      // And the draft exists, for a trusted read.
      expect(
        titlesOf(
          await trusted.find({ collection: "vposts", status: "all" } as never)
        )
      ).toEqual(["draft", "published"]);
    });

    it("returns only what is published when a visitor asks for drafts", async () => {
      for (const status of ["all", "draft"] as const) {
        expect(
          titlesOf(
            await visitor.find({ collection: "vposts", status } as never)
          )
        ).toEqual(status === "all" ? ["published"] : []);
      }
      await expect(
        visitor.findByID({
          collection: "vposts",
          id: draftId,
          status: "draft",
        } as never)
      ).rejects.toBeTruthy();
    });

    it("shows a visitor no Single content held as a draft", async () => {
      // The Single keeps one row, last saved as a draft: there is no
      // published content for a visitor to read.
      const stored = (await trusted.findSingle({
        slug: "vpage",
        status: "draft",
      } as never)) as Doc;
      expect(stored.title).toBe("draft page");

      await expect(
        visitor.findSingle({ slug: "vpage", status: "draft" } as never)
      ).rejects.toBeTruthy();
    });
  }
);
