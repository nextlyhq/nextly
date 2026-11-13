/**
 * Where a part with no review state stands, on every configured dialect, as a step and an
 * assignment read it:
 * - a never-published part, and a part whose collection a workflow was just attached to, is in
 *   the first stage;
 * - a live part with nothing unpublished has no stage: published content stays live, and a step
 *   or an assignment on it is refused;
 * - a live part's next working draft starts at the stage the definition names for after a
 *   publish, also after its earlier draft was discarded in review;
 * - a part recorded in a stage the workflow no longer has reads as the first stage.
 */
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
  assignWorkflowParts,
  takeWorkflowStep,
  type WorkflowCaller,
} from "../steps";

import {
  entry,
  partOf,
  person,
  seedState,
  stateOf,
  versionOf,
} from "./helpers/step-harness";

/** Draft → Legal → Approved, with Hold to park in, where each next draft starts after a publish. */
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
    {
      name: "sendBack",
      label: "Send back",
      kind: "request-changes",
      from: ["legal", "approved"],
      to: "draft",
    },
  ],
  afterPublish: "hold",
});
const drafts = { status: true, versions: { drafts: true } } as const;

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
        ...drafts,
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

const handlerOf = (n: TestNextly) =>
  n.getService("collectionsHandler") as CollectionsHandler;

/** Saves `data` in `locale` as trusted code's ordinary save. */
async function save(
  entryId: string,
  data: Record<string, unknown>,
  locale: string
): Promise<void> {
  const result = await handlerOf(app()).updateEntry(
    { collectionName: "posts", entryId, overrideAccess: true, locale },
    // An update names its version or says it overwrites; this one read none.
    { ...data, _overwrite: true }
  );
  // A refused save fails the test rather than leaving the document as it was.
  if (!result.success) {
    throw new Error(`save refused: ${result.statusCode} ${result.message}`);
  }
}

/** A post published in English. */
async function livePost(): Promise<string> {
  const post = await entry(app(), "posts");
  await save(post, { status: "published" }, "en");
  return post;
}

/** What a caller that just read each part saw of it. */
async function seenOf(entryId: string, parts: readonly (string | null)[]) {
  return Promise.all(
    parts.map(async part => ({
      part,
      revision:
        (await stateOf(app(), partOf("posts", entryId, part)))?.revision ?? 0,
      version: await versionOf(app(), "posts", entryId, part),
    }))
  );
}

/** Takes `name` on `parts`, as a caller that just read every part. */
async function take(
  entryId: string,
  parts: readonly (string | null)[] | "all",
  name: string,
  caller: WorkflowCaller
) {
  return takeWorkflowStep(app().adapter, {
    document: { scopeKind: "collection", scopeSlug: "posts", entryId },
    step: name,
    parts,
    seen: await seenOf(entryId, parts === "all" ? ["en", "es", null] : parts),
    caller,
  });
}

/** Assigns nobody to one part, as a caller that just read it. */
async function clearAssignee(
  entryId: string,
  part: string | null,
  caller: WorkflowCaller
) {
  return assignWorkflowParts(app().adapter, {
    assignments: [
      {
        document: { scopeKind: "collection", scopeSlug: "posts", entryId },
        part,
        revision:
          (await stateOf(app(), partOf("posts", entryId, part)))?.revision ?? 0,
        assignee: null,
      },
    ],
    caller,
  });
}

/** The refusal a call was made with: its status, and its first error's place and code. */
async function refusalOf(attempt: Promise<unknown>) {
  const error = (await attempt.then(
    () => null,
    (thrown: unknown) => thrown
  )) as {
    statusCode?: number;
    publicData?: {
      reason?: string;
      left?: unknown;
      errors?: { path: string; code: string }[];
    };
  } | null;
  return {
    statusCode: error?.statusCode,
    reason: error?.publicData?.reason,
    left: error?.publicData?.left,
    error: error?.publicData?.errors?.[0],
  };
}

describe.each(getConfiguredTestDialects())(
  "where a part with no review state stands (%s)",
  dialect => {
    it("starts a never-published part at the first stage", async () => {
      await boot(dialect);
      const dave = await person(app(), "dave", [["update", "posts"]]);
      const post = await entry(app(), "posts");

      const taken = await take(post, ["en"], "submit", dave);

      expect(taken.moved).toEqual([
        expect.objectContaining({ part: "en", from: "draft", to: "legal" }),
      ]);
    });

    it("gives a live part with nothing unpublished no stage, refusing a step and an assignment on it", async () => {
      await boot(dialect);
      const dave = await person(app(), "dave", [["update", "posts"]]);
      const post = await livePost();

      expect(await refusalOf(take(post, ["en"], "submit", dave))).toMatchObject(
        {
          statusCode: 400,
          error: { path: "parts", code: "WORKFLOW_NOTHING_TO_REVIEW" },
        }
      );
      expect(await refusalOf(clearAssignee(post, "en", dave))).toMatchObject({
        statusCode: 400,
        error: {
          path: "assignments[0].part",
          code: "WORKFLOW_NOTHING_TO_REVIEW",
        },
      });
      expect(await stateOf(app(), partOf("posts", post, "en"))).toBeNull();
    });

    it("starts a live part's next working draft at the after-publish stage, for a step and an assignment", async () => {
      await boot(dialect);
      const dave = await person(app(), "dave", [["update", "posts"]]);
      const post = await livePost();
      await save(post, { title: "Pending" }, "en");

      expect(await refusalOf(take(post, ["en"], "submit", dave))).toMatchObject(
        {
          reason: "not-from-stage",
          left: [{ part: "en", stage: "hold", reason: "not-from-stage" }],
        }
      );
      const taken = await take(post, ["en"], "resume", dave);
      expect(taken.moved).toEqual([
        expect.objectContaining({ part: "en", from: "hold", to: "legal" }),
      ]);

      const other = await livePost();
      await save(other, { title: "Pending" }, "en");
      await clearAssignee(other, "en", dave);
      expect(await stateOf(app(), partOf("posts", other, "en"))).toMatchObject({
        stage: "hold",
        revision: 1,
      });
    });

    it("moves only the parts with something unpublished when a step names them all, and refuses naming one with nothing", async () => {
      await boot(dialect);
      const dave = await person(app(), "dave", [["update", "posts"]]);
      const post = await livePost();
      await save(post, { title: "Publicado", status: "published" }, "es");
      await save(post, { title: "Pending" }, "en");

      // Spanish is live with nothing unpublished: named, it refuses the step, which moves nothing.
      expect(
        await refusalOf(take(post, ["en", "es"], "resume", dave))
      ).toMatchObject({
        statusCode: 400,
        error: { path: "parts", code: "WORKFLOW_NOTHING_TO_REVIEW" },
      });
      expect(await stateOf(app(), partOf("posts", post, "en"))).toBeNull();

      const taken = await take(post, "all", "resume", dave);

      // English holds a draft, and so the shared part has pending content too; Spanish has none.
      const moved = taken.moved.map(each => [each.part, each.from]);
      expect(moved).toHaveLength(2);
      expect(moved).toEqual(
        expect.arrayContaining([
          ["en", "hold"],
          [null, "hold"],
        ])
      );
      expect(taken.left).toEqual([]);
      expect(await stateOf(app(), partOf("posts", post, "es"))).toBeNull();
    });

    it("starts the draft after a discard in review over a live page at the after-publish stage", async () => {
      await boot(dialect);
      const dave = await person(app(), "dave", [["update", "posts"]]);
      const post = await livePost();
      await save(post, { title: "Pending" }, "en");
      await take(post, ["en"], "resume", dave);
      expect(await stateOf(app(), partOf("posts", post, "en"))).toMatchObject({
        stage: "legal",
      });

      await handlerOf(app()).discardWorkingDraftCounted({
        collectionName: "posts",
        // A discard names the version it read or says it overwrites; this one read none.
        version: { _overwrite: true },
        entryId: post,
        locale: "en",
      });
      await save(post, { title: "Pending again" }, "en");

      const taken = await take(post, ["en"], "resume", dave);
      expect(taken.moved).toEqual([
        expect.objectContaining({ part: "en", from: "hold", to: "legal" }),
      ]);
    });

    it("reads a part recorded in a stage the workflow no longer has as the first stage", async () => {
      await boot(dialect);
      const dave = await person(app(), "dave", [["update", "posts"]]);
      const post = await entry(app(), "posts");
      await seedState(app(), partOf("posts", post, "en"), "archive", {
        definitionHash: workflowDefinitionHash(desk),
      });

      const taken = await take(post, ["en"], "submit", dave);

      expect(taken.moved).toEqual([
        expect.objectContaining({ part: "en", from: "draft", to: "legal" }),
      ]);
    });
  }
);
