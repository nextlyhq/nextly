/**
 * `nextly workflow:stranded` and `nextly workflow:move-stranded`, on every configured dialect: the
 * list names each part in a stage its workflow no longer has, and the move takes them to a named
 * stage in one transaction, recording one event per document with the person `--as` names and
 * the comment. A move refused, for an unknown or deactivated person, a stage the workflow does not
 * have or one that allows publishing, or no comment, moves nothing.
 *
 * Driven through the two functions the commands run, `strandedReviewStates` and
 * `moveStrandedReviewStates`, on the workflows the configuration registers, as the commands hand
 * them, and once through the table resolver the commands install (`installStrandedRunResolver`).
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { defineWorkflow } from "../../../domains/workflows/define-workflow";
import { workflowDefinitionHash } from "../../../domains/workflows/hash";
import { registeredWorkflows } from "../../../domains/workflows/registry";
import {
  moveStrandedReviewStates,
  strandedReviewStates,
} from "../../../domains/workflows/stranded-stages";
import {
  entry,
  partOf,
  person,
  seedState,
  stateOf,
  workflowEvents,
} from "../../../domains/workflows/__tests__/helpers/step-harness";
import { installStrandedRunResolver } from "../workflow-stranded";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

/** A workflow whose stored states include a stage it no longer has: `archive`. */
const desk = defineWorkflow({
  slug: "desk",
  label: "Desk",
  stages: [
    { name: "draft", label: "Draft" },
    { name: "legal", label: "Legal check" },
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
});
const HASH = workflowDefinitionHash(desk);

/** Another workflow, with no stage named `legal` and nothing stranded. */
const memo = defineWorkflow({
  slug: "memo",
  label: "Memo",
  stages: [
    { name: "open", label: "Open" },
    { name: "done", label: "Done", allowsPublish: true },
  ],
  steps: [
    {
      name: "close",
      label: "Close",
      kind: "approve",
      from: "open",
      to: "done",
      primary: true,
    },
  ],
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
        fields: [text({ name: "title", localized: true })],
      }),
      defineCollection({
        slug: "pages",
        ...drafts,
        workflow: desk,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "notes",
        ...drafts,
        workflow: memo,
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "home",
        ...drafts,
        workflow: desk,
        fields: [text({ name: "headline" })],
      }),
      defineSingle({
        slug: "about",
        ...drafts,
        workflow: memo,
        fields: [text({ name: "headline" })],
      }),
    ],
  });
  return t;
}

/** Two posts and a page, each with a part stranded in `archive`, and one post part in `legal`. */
async function strandedInstall() {
  const n = app();
  const both = await entry(n, "posts");
  const one = await entry(n, "posts");
  const page = await entry(n, "pages");
  const seed = (slug: string, id: string, part: string | null, stage: string) =>
    seedState(n, partOf(slug, id, part), stage, { definitionHash: HASH });
  await seed("posts", both, "en", "archive");
  await seed("posts", both, "es", "archive");
  await seed("posts", one, "en", "archive");
  await seed("posts", one, "es", "legal");
  await seed("pages", page, null, "archive");
  await person(n, "ann", []);
  await person(n, "zed", [], { active: false });
  return { both, one, page };
}

const moves = (slug: string, id: string) =>
  workflowEvents(app(), slug, id).then(events =>
    events.filter(event => event.kind === "workflow-stranded-moved")
  );

describe.each(getConfiguredTestDialects())(
  "nextly workflow:stranded and workflow:move-stranded (%s)",
  dialect => {
    it("lists the stranded parts, then moves one collection's to a named stage, one event per document", async () => {
      await boot(dialect);
      const { both, one, page } = await strandedInstall();
      const workflows = registeredWorkflows();

      const listed = await strandedReviewStates(app().adapter, { workflows });
      expect(
        listed.map(state => [state.scopeSlug, state.entryId, state.part])
      ).toEqual(
        [
          ["pages", page, null],
          ["posts", both, "en"],
          ["posts", both, "es"],
          ["posts", one, "en"],
        ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      );
      expect(listed[0]?.message).toBe("Stage 'archive' no longer exists");

      const moved = await moveStrandedReviewStates(app().adapter, {
        workflows,
        collection: "posts",
        to: "draft",
        as: "ANN@example.test",
        comment: "Archive was retired.",
      });
      expect(moved).toHaveLength(2);

      for (const [id, part] of [
        [both, "en"],
        [both, "es"],
        [one, "en"],
      ] as const) {
        expect(await stateOf(app(), partOf("posts", id, part))).toMatchObject({
          stage: "draft",
          enteredBy: "ann",
          approval: null,
        });
      }
      // A part in a stage the workflow has is no part of the move.
      expect(await stateOf(app(), partOf("posts", one, "es"))).toMatchObject({
        stage: "legal",
        revision: 1,
      });
      const [bothMove, ...bothMore] = await moves("posts", both);
      expect(bothMore).toEqual([]);
      expect(bothMove).toMatchObject({
        actorKind: "person",
        actorId: "ann",
        note: "Archive was retired.",
        fromState: "archive",
        toState: "draft",
        payload: { from: ["archive"] },
        definitionHash: HASH,
      });
      expect([...(bothMove?.parts ?? [])].sort()).toEqual(["en", "es"]);
      expect(await moves("posts", one)).toEqual([
        expect.objectContaining({ actorId: "ann", parts: ["en"] }),
      ]);

      // The page was not named, and stays stranded.
      expect(await stateOf(app(), partOf("pages", page, null))).toMatchObject({
        stage: "archive",
      });
      expect(await moves("pages", page)).toEqual([]);
      expect(
        (await strandedReviewStates(app().adapter, { workflows })).map(
          state => state.entryId
        )
      ).toEqual([page]);
    });

    it("moves through the tables the command itself registers, with no boot to have registered them", async () => {
      await boot(dialect);
      const { page } = await strandedInstall();
      const workflows = [...registeredWorkflows()];
      // The resolver the command installs, in place of the one this boot registered.
      await installStrandedRunResolver(app().adapter, workflows);

      const moved = await moveStrandedReviewStates(app().adapter, {
        workflows,
        collection: "pages",
        to: "draft",
        as: "ann@example.test",
        comment: "Back to draft.",
      });

      expect(moved.map(each => each.document.entryId)).toEqual([page]);
      expect(await stateOf(app(), partOf("pages", page, null))).toMatchObject({
        stage: "draft",
      });
    });

    it("judges the stage only by the workflows whose parts it moves", async () => {
      await boot(dialect);
      const { both, one, page } = await strandedInstall();

      // `memo` has no `legal`, but nothing of it is stranded, so it has no say in where they go.
      const moved = await moveStrandedReviewStates(app().adapter, {
        workflows: registeredWorkflows(),
        to: "legal",
        as: "ann@example.test",
        comment: "Back to legal.",
      });

      expect(moved.map(each => each.document.entryId).sort()).toEqual(
        [both, one, page].sort()
      );
      expect(await stateOf(app(), partOf("pages", page, null))).toMatchObject({
        stage: "legal",
      });
    });

    it("moves one Single's stranded parts where the workflows' stages differ, and only one scope at a time", async () => {
      await boot(dialect);
      await person(app(), "ann", []);
      const singlePart = (slug: string) => ({
        scopeKind: "single" as const,
        scopeSlug: slug,
        entryId: `${slug}-entry`,
        part: null,
      });
      // Each Single's workflow is stranded in a stage of its own; `memo` has no `draft`.
      await seedState(app(), singlePart("home"), "archive", {
        definitionHash: HASH,
      });
      await seedState(app(), singlePart("about"), "retired", {
        definitionHash: workflowDefinitionHash(memo),
      });
      const workflows = registeredWorkflows();
      const move = (over: { single?: string; collection?: string }) =>
        moveStrandedReviewStates(app().adapter, {
          workflows,
          to: "draft",
          as: "ann@example.test",
          comment: "Archive was retired.",
          ...over,
        });
      const refusal = (attempt: Promise<unknown>) =>
        attempt.then(
          () => null,
          (thrown: unknown) =>
            (
              thrown as {
                publicData?: { errors?: { path: string; code: string }[] };
              }
            ).publicData?.errors?.[0]
        );

      // Unscoped, `memo` has no `draft`, so nothing moves.
      expect(await refusal(move({}))).toMatchObject({
        path: "to",
        code: "WORKFLOW_UNKNOWN_STAGE",
      });
      // Named, only `home` is judged and moved.
      const moved = await move({ single: "home" });
      expect(moved.map(each => each.document.scopeSlug)).toEqual(["home"]);
      expect(await stateOf(app(), singlePart("home"))).toMatchObject({
        stage: "draft",
        enteredBy: "ann",
      });
      expect(await stateOf(app(), singlePart("about"))).toMatchObject({
        stage: "retired",
      });
      expect(
        (
          await strandedReviewStates(app().adapter, {
            workflows,
            single: "about",
          })
        ).map(state => state.scopeSlug)
      ).toEqual(["about"]);

      // A Single no workflow is attached to, and both scopes at once, are refused.
      expect(await refusal(move({ single: "nowhere" }))).toMatchObject({
        path: "single",
        code: "WORKFLOW_NOT_ATTACHED",
      });
      expect(
        await refusal(move({ single: "about", collection: "posts" }))
      ).toMatchObject({ path: "single", code: "WORKFLOW_ONE_SCOPE" });
      expect(await stateOf(app(), singlePart("about"))).toMatchObject({
        stage: "retired",
        revision: 1,
      });
    });

    it("refuses an unknown or deactivated person, a stage the workflow lacks or one that allows publishing, and no comment, moving nothing", async () => {
      await boot(dialect);
      const { page } = await strandedInstall();
      const workflows = registeredWorkflows();
      const move = (
        over: Partial<Parameters<typeof moveStrandedReviewStates>[1]>
      ) =>
        moveStrandedReviewStates(app().adapter, {
          workflows,
          to: "draft",
          as: "ann@example.test",
          comment: "Moving on.",
          ...over,
        });
      const codeOf = async (attempt: Promise<unknown>) => {
        const error = await attempt.then(
          () => null,
          (thrown: unknown) => thrown
        );
        return (
          error as {
            publicData?: { errors?: { path: string; code: string }[] };
          } | null
        )?.publicData?.errors?.[0];
      };

      expect(await codeOf(move({ as: "nobody@example.test" }))).toMatchObject({
        path: "as",
        code: "WORKFLOW_PERSON_NOT_FOUND",
      });
      expect(await codeOf(move({ as: "zed@example.test" }))).toMatchObject({
        path: "as",
        code: "WORKFLOW_PERSON_DEACTIVATED",
      });
      expect(await codeOf(move({ to: "archive" }))).toMatchObject({
        path: "to",
        code: "WORKFLOW_UNKNOWN_STAGE",
      });
      expect(await codeOf(move({ to: "approved" }))).toMatchObject({
        path: "to",
        code: "WORKFLOW_STAGE_ALLOWS_PUBLISH",
      });
      expect(await codeOf(move({ comment: "  " }))).toMatchObject({
        path: "comment",
        code: "WORKFLOW_COMMENT_REQUIRED",
      });
      expect(await codeOf(move({ collection: "nowhere" }))).toMatchObject({
        path: "collection",
        code: "WORKFLOW_NOT_ATTACHED",
      });

      expect(await stateOf(app(), partOf("pages", page, null))).toMatchObject({
        stage: "archive",
        revision: 1,
      });
      expect(await moves("pages", page)).toEqual([]);
      expect(
        await strandedReviewStates(app().adapter, { workflows })
      ).toHaveLength(4);
    });
  }
);
