/**
 * A collection list's stage filter: `_stage: "<stage>"` keeps the documents with a part in that
 * stage, read as every step reads a part's stage (`partStage`). That is its review state's stage,
 * read as the first stage when the workflow no longer has it; for a part with none, the first stage
 * while it is not live, the after-publish stage while it is live with a working draft, and no stage
 * while it is live with nothing unpublished. The list and its count agree, and a read in a language
 * considers only the parts it may see. On every configured dialect.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { defineWorkflow } from "../define-workflow";
import { workflowDefinitionHash } from "../hash";

import {
  entry,
  partOf,
  person,
  publishedPastReview,
  seedState,
} from "./helpers/step-harness";

/** Draft → Legal → Approved, where each next draft starts On hold after a publish. */
const desk = defineWorkflow({
  slug: "desk",
  label: "Desk",
  stages: [
    { name: "draft", label: "Draft" },
    { name: "legal", label: "Legal check" },
    { name: "hold", label: "On hold" },
    { name: "approved", label: "Approved", allowsPublish: true },
  ],
  steps: [
    {
      name: "submit",
      label: "Submit",
      kind: "submit",
      from: "draft",
      to: "legal",
    },
    { name: "park", label: "Park", kind: "move", from: "legal", to: "hold" },
    {
      name: "resume",
      label: "Resume",
      kind: "move",
      from: "hold",
      to: "legal",
    },
    {
      name: "approve",
      label: "Approve",
      kind: "approve",
      from: "legal",
      to: "approved",
      primary: true,
    },
  ],
  afterPublish: "hold",
});
const HASH = workflowDefinitionHash(desk);

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

const app = (): TestNextly => {
  if (!t) throw new Error("not booted");
  return t;
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  t = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        status: true,
        versions: { drafts: true },
        workflow: desk,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "code", localized: false }),
        ],
      }),
    ],
  });
  return t;
}

/** Saves `data` in `locale` as trusted code's ordinary save. */
async function save(
  entryId: string,
  data: Record<string, unknown>,
  locale: string
): Promise<void> {
  const result = await (
    app().getService("collectionsHandler") as CollectionsHandler
  ).updateEntry(
    { collectionName: "posts", entryId, overrideAccess: true, locale },
    // An update names its version or says it overwrites; this one read none.
    { ...publishedPastReview(data), _overwrite: true }
  );
  // A refused save fails the test rather than leaving the document as it was.
  if (!result.success) {
    throw new Error(`save refused: ${result.statusCode} ${result.message}`);
  }
}

/** A post published in both languages, with nothing unpublished: no part has a stage. */
async function livePost(): Promise<string> {
  const post = await entry(app(), "posts");
  await save(post, { title: "Hello", status: "published" }, "en");
  await save(post, { title: "Hola", status: "published" }, "es");
  return post;
}

/**
 * The ids a list keeps under `where`, and its count: trusted, considering every language, or as
 * `userId` reading in `locale`.
 */
async function kept(
  stage: string,
  reader?: { userId: string; locale: string }
): Promise<{ ids: string[]; total: number }> {
  const read = {
    collection: "posts",
    where: { _stage: stage },
    status: "all",
    ...(reader
      ? {
          overrideAccess: false,
          user: { id: reader.userId },
          locale: reader.locale,
        }
      : { overrideAccess: true }),
  } as never;
  const listed = await app().nextly.find(read);
  const counted = (await app().nextly.count(read)) as { total: number };
  return {
    ids: listed.items.map(item => String(item.id)).sort(),
    total: counted.total,
  };
}

describe.each(getConfiguredTestDialects())(
  "a list's stage filter (%s)",
  dialect => {
    it("keeps the documents with a part in the stage, as each part's stage is read", async () => {
      await boot(dialect);
      // Never published: every part starts at the first stage.
      const fresh = await entry(app(), "posts");
      // Live everywhere with nothing unpublished: no stage at all.
      const live = await livePost();
      // Live, with an English working draft: it starts at the after-publish stage.
      const pending = await livePost();
      await save(pending, { title: "Pending" }, "en");
      // Live, its English part recorded in Legal check.
      const recorded = await livePost();
      await seedState(app(), partOf("posts", recorded, "en"), "legal", {
        definitionHash: HASH,
      });
      // Live, its Spanish part recorded in a stage the workflow no longer has: the first stage.
      const stranded = await livePost();
      await seedState(app(), partOf("posts", stranded, "es"), "gone", {
        definitionHash: HASH,
      });

      // Never published, every part recorded in Legal check: its review state decides, not its
      // content, so it is not at the first stage.
      const inLegal = await entry(app(), "posts");
      for (const part of [null, "en", "es"]) {
        await seedState(app(), partOf("posts", inLegal, part), "legal", {
          definitionHash: HASH,
        });
      }

      expect(await kept("draft")).toEqual({
        ids: [fresh, stranded].sort(),
        total: 2,
      });
      expect(await kept("hold")).toEqual({ ids: [pending], total: 1 });
      expect(await kept("legal")).toEqual({
        ids: [recorded, inLegal].sort(),
        total: 2,
      });
      expect(await kept("approved")).toEqual({ ids: [], total: 0 });
      // A stage the workflow does not have keeps nothing, and is not refused.
      expect(await kept("gone")).toEqual({ ids: [], total: 0 });
      expect(live).toBeTruthy();
    });

    it("considers only the parts a read in a language may see", async () => {
      await boot(dialect);
      await person(app(), "sam", [["read", "posts"]]);
      // Its Spanish part alone in Legal check; the rest live with nothing unpublished.
      const spanish = await livePost();
      await seedState(app(), partOf("posts", spanish, "es"), "legal", {
        definitionHash: HASH,
      });

      expect(await kept("legal", { userId: "sam", locale: "es" })).toEqual({
        ids: [spanish],
        total: 1,
      });
      // Read in English the Spanish part is withheld, so it keeps no entry.
      expect(await kept("legal", { userId: "sam", locale: "en" })).toEqual({
        ids: [],
        total: 0,
      });
    });
  }
);
