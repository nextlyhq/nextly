/**
 * Changing a workflow in code, or the content under it, never leaves review state behind, on
 * every configured dialect:
 * - a deploy that renames a stage moves its parts to the new name, recorded, keeping approvals
 *   where the rename was the only change; one that maps a removed stage moves its parts there,
 *   recorded, withdrawing approvals; one that removes a stage with no mapping leaves its parts
 *   where they are, listed as stranded and kept by the `_strandedStage` filter;
 * - a deploy that detaches a workflow removes its review state and pins, recorded per document,
 *   so attaching it again revives nothing;
 * - deleting a document, by each delete path, removes its review state in the delete;
 * - discarding a working draft removes that part's review state and pins, recorded.
 *
 * Each is observed on the review states, the record of content events and the history's pins.
 */
import { afterEach, describe, expect, it } from "vitest";

import { followWorkflowsAfterMigrate } from "../../../cli/commands/follow-workflows";
import { defineCollection, defineConfig, text } from "../../../config";
import { clearServices } from "../../../di/register";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { VersionsDbApi } from "../../versions/db-api";
import { defineWorkflow } from "../define-workflow";
import { workflowDefinitionHash } from "../hash";
import { readDocumentReviewStates } from "../review-state-repository";
import { takeWorkflowStep, type WorkflowCaller } from "../steps";
import { strandedReviewStates } from "../stranded-stages";
import type { Workflow } from "../types";
import { workflowPins } from "../workflow-pins";

import {
  entry,
  partOf,
  person,
  seedState,
  shownVersion,
  stateDb,
  stateOf,
  versionOf,
  workflowEvents,
} from "./helpers/step-harness";

/**
 * The desk's first definition: Draft → Legal → Approved, with a stage to park in (Hold), one a
 * draft may be fact-checked in (Fact check) and one it may be shelved in (Archive).
 */
const desk = defineWorkflow({
  slug: "desk",
  label: "Desk",
  stages: [
    { name: "draft", label: "Draft" },
    { name: "legal", label: "Legal check" },
    { name: "hold", label: "On hold" },
    { name: "factcheck", label: "Fact check" },
    { name: "archive", label: "Archive" },
    { name: "approved", label: "Approved", allowsPublish: true },
  ],
  steps: [
    {
      name: "submit",
      label: "Submit",
      kind: "submit",
      from: "draft",
      to: "legal",
      primary: true,
    },
    {
      name: "check",
      label: "Check",
      kind: "move",
      from: "draft",
      to: "factcheck",
    },
    {
      name: "verified",
      label: "Verified",
      kind: "move",
      from: "factcheck",
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
      name: "shelve",
      label: "Shelve",
      kind: "move",
      from: "legal",
      to: "archive",
    },
    {
      name: "unshelve",
      label: "Unshelve",
      kind: "move",
      from: "archive",
      to: "draft",
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

/** The desk with On hold renamed to Paused, and nothing else changed. */
const deskRenamed = defineWorkflow({
  slug: "desk",
  label: "Desk",
  stages: desk.stages.map(stage =>
    stage.name === "hold"
      ? { ...stage, name: "paused", label: "Paused", renamedFrom: "hold" }
      : stage
  ),
  steps: desk.steps.map(step => ({
    ...step,
    permission: step.permission ?? undefined,
    from: step.from.map(stage => (stage === "hold" ? "paused" : stage)),
    to: step.to === "hold" ? "paused" : step.to,
  })),
});

/**
 * The desk redrawn: On hold renamed to Paused, Fact check removed with its parts sent back to
 * Draft, and Archive removed with nowhere named for its parts.
 */
const deskRedrawn = defineWorkflow({
  slug: "desk",
  label: "Desk",
  stages: [
    { name: "draft", label: "Draft" },
    { name: "legal", label: "Legal check" },
    { name: "paused", label: "Paused", renamedFrom: "hold" },
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
    { name: "park", label: "Park", kind: "move", from: "legal", to: "paused" },
    {
      name: "resume",
      label: "Resume",
      kind: "move",
      from: "paused",
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
  removedStages: { factcheck: "draft" },
});

const DESK = workflowDefinitionHash(desk);
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

/**
 * Boots Posts (translated, with a shared `code`) and Pages, each on `posts` and `pages` as given
 * (none detaches it), in English and Spanish.
 */
async function boot(
  dialect: TestDialect,
  options: {
    posts?: Workflow | null;
    pages?: Workflow | null;
    adapter?: TestNextly["adapter"];
  } = {}
): Promise<TestNextly> {
  t = await createTestNextly({
    ...(options.adapter ? { adapter: options.adapter } : { dialect }),
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: collectionsOn(options),
  });
  return t;
}

/** Posts and Pages, each on `posts` and `pages` as given (`desk` when not; none detaches it). */
function collectionsOn(options: {
  posts?: Workflow | null;
  pages?: Workflow | null;
}) {
  const posts = options.posts === undefined ? desk : options.posts;
  const pages = options.pages === undefined ? desk : options.pages;
  return [
    defineCollection({
      slug: "posts",
      localized: true,
      ...drafts,
      ...(posts ? { workflow: posts } : {}),
      fields: [
        text({ name: "title", localized: true }),
        text({ name: "code", localized: false }),
      ],
    }),
    defineCollection({
      slug: "pages",
      ...drafts,
      ...(pages ? { workflow: pages } : {}),
      fields: [text({ name: "title" })],
    }),
  ];
}

/** Boots again on the same database, as a deploy does. */
async function redeploy(
  dialect: TestDialect,
  options: { posts?: Workflow | null; pages?: Workflow | null }
): Promise<TestNextly> {
  const adapter = app().adapter;
  clearServices();
  return boot(dialect, { ...options, adapter });
}

const handlerOf = (n: TestNextly) =>
  n.getService("collectionsHandler") as CollectionsHandler;

/** Saves `data` as trusted code's ordinary save. */
async function save(
  slug: string,
  entryId: string,
  data: Record<string, unknown>,
  locale?: string
): Promise<void> {
  const result = await handlerOf(app()).updateEntry(
    {
      collectionName: slug,
      entryId,
      overrideAccess: true,
      ...(locale ? { locale } : {}),
    },
    // An update names its version or says it overwrites; this one read none.
    { ...data, _overwrite: true }
  );
  // A refused save fails the test rather than leaving the document as it was.
  if (!result.success) {
    throw new Error(`save refused: ${result.statusCode} ${result.message}`);
  }
}

/** Takes `name` on one part, as a caller that just read it. */
async function take(
  slug: string,
  entryId: string,
  part: string | null,
  name: string,
  caller: WorkflowCaller
) {
  const state = await stateOf(app(), partOf(slug, entryId, part));
  return takeWorkflowStep(app().adapter, {
    document: { scopeKind: "collection", scopeSlug: slug, entryId },
    step: name,
    parts: [part],
    seen: [
      {
        part,
        revision: state?.revision ?? 0,
        version: await versionOf(app(), slug, entryId, part),
      },
    ],
    caller,
  });
}

/** The workflows holder's slots on a document, by slot. */
async function pinsOf(slug: string, entryId: string) {
  const slots = await workflowPins.list(
    app().adapter as unknown as VersionsDbApi,
    { scopeKind: "collection", scopeSlug: slug, entryId }
  );
  return Object.fromEntries(slots.map(pin => [pin.slot, pin.versionNo]));
}

/** Points one of the workflows holder's slots at `versionNo`, as a step would. */
async function pin(
  slug: string,
  entryId: string,
  slot: string,
  versionNo: number
) {
  await app().adapter.transaction(tx =>
    workflowPins.pin(tx, {
      ref: { scopeKind: "collection", scopeSlug: slug, entryId },
      slot,
      versionNo,
    })
  );
}

/** Every review state of a document, by part. */
async function statesOf(slug: string, entryId: string) {
  return readDocumentReviewStates(stateDb(app()), {
    scopeKind: "collection",
    scopeSlug: slug,
    entryId,
  });
}

/** The document's workflow events of `kind`. */
async function eventsOf(slug: string, entryId: string, kind: string) {
  return (await workflowEvents(app(), slug, entryId)).filter(
    event => event.kind === kind
  );
}

/** The ids `_strandedStage` keeps, and how many a count with it answers. */
async function strandedListed(slug: "posts" | "pages") {
  const where = { _strandedStage: true } as never;
  const listed = await app().nextly.find({
    collection: slug,
    where,
    status: "all",
    overrideAccess: true,
  } as never);
  const counted = await app().nextly.count({
    collection: slug,
    where,
    status: "all",
    overrideAccess: true,
  } as never);
  return {
    // Each listed row's id, narrowed from the untyped row a slug the types do not know returns.
    ids: listed.items.flatMap(item =>
      typeof item.id === "string" ? [item.id] : []
    ),
    total: counted.total,
  };
}

/** An approval of the part's newest recorded version, by bob. */
async function approvalOf(slug: string, entryId: string, part: string | null) {
  return {
    versionNo: await shownVersion(app(), slug, entryId, part),
    digest: "seeded",
    by: "bob",
    at: new Date("2026-11-02T10:00:00.000Z"),
  };
}

describe.each(getConfiguredTestDialects())(
  "a workflow never strands a document (%s)",
  dialect => {
    // SQLite only: a deploy boots again on the same database, and the test harness releases a
    // server-backed database when the next instance boots, so the second boot would find it gone.
    // The sweep reads and writes through the adapter alike on every dialect.
    describe.skipIf(dialect !== "sqlite")(
      "a deploy that removes, renames and redirects stages",
      () => {
        it("renames, redirects with approvals withdrawn, and leaves an unmapped stage's parts stranded, listed and filtered", async () => {
          await boot(dialect);
          const shelved = await entry(app(), "posts");
          const checking = await entry(app(), "posts");
          const parked = await entry(app(), "posts");
          const clean = await entry(app(), "posts");
          await seedState(app(), partOf("posts", shelved, "en"), "archive", {
            definitionHash: DESK,
          });
          await seedState(app(), partOf("posts", shelved, "es"), "legal", {
            definitionHash: DESK,
          });
          await seedState(app(), partOf("posts", checking, "en"), "factcheck", {
            definitionHash: DESK,
            approval: await approvalOf("posts", checking, "en"),
          });
          await seedState(app(), partOf("posts", parked, "en"), "hold", {
            definitionHash: DESK,
          });
          await seedState(app(), partOf("posts", clean, "en"), "legal", {
            definitionHash: DESK,
          });

          await redeploy(dialect, { posts: deskRedrawn, pages: deskRedrawn });
          const now = workflowDefinitionHash(deskRedrawn);

          // Renamed: the part follows its stage to the new name, recorded as the system's act.
          expect(
            await stateOf(app(), partOf("posts", parked, "en"))
          ).toMatchObject({ stage: "paused" });
          expect(
            await eventsOf("posts", parked, "workflow-stage-renamed")
          ).toEqual([
            expect.objectContaining({
              actorKind: "system",
              fromState: "hold",
              toState: "paused",
              parts: ["en"],
              definitionHash: now,
            }),
          ]);

          // Redirected: moved where the definition says, its approval withdrawn, recorded.
          expect(
            await stateOf(app(), partOf("posts", checking, "en"))
          ).toMatchObject({
            stage: "draft",
            approval: null,
            definitionHash: now,
          });
          expect(
            await eventsOf("posts", checking, "workflow-stage-removed")
          ).toEqual([
            expect.objectContaining({
              actorKind: "system",
              fromState: "factcheck",
              toState: "draft",
              parts: ["en"],
              payload: { approvalWithdrawn: true },
              definitionHash: now,
            }),
          ]);

          // Removed with nowhere named: left as it is, and the only part listed as stranded.
          expect(
            await stateOf(app(), partOf("posts", shelved, "en"))
          ).toMatchObject({ stage: "archive" });
          const stranded = await strandedReviewStates(app().adapter);
          expect(
            stranded.map(state => [state.entryId, state.part, state.stage])
          ).toEqual([[shelved, "en", "archive"]]);
          expect(stranded[0]).toMatchObject({
            workflow: "desk",
            message: "Stage 'archive' no longer exists",
          });
          expect(await strandedListed("posts")).toEqual({
            ids: [shelved],
            total: 1,
          });
          expect(await strandedListed("pages")).toEqual({ ids: [], total: 0 });

          // A second boot of the same definition finds nothing left to move.
          await redeploy(dialect, { posts: deskRedrawn, pages: deskRedrawn });
          expect(
            await eventsOf("posts", parked, "workflow-stage-renamed")
          ).toHaveLength(1);
          expect(
            await eventsOf("posts", checking, "workflow-stage-removed")
          ).toHaveLength(1);
        });

        it("keeps approvals across a deploy whose only change is a rename", async () => {
          await boot(dialect);
          const approved = await entry(app(), "posts");
          const parked = await entry(app(), "posts");
          const approval = await approvalOf("posts", approved, "en");
          await seedState(app(), partOf("posts", approved, "en"), "approved", {
            definitionHash: DESK,
            approval,
          });
          await seedState(app(), partOf("posts", parked, "en"), "hold", {
            definitionHash: DESK,
          });

          await redeploy(dialect, { posts: deskRenamed, pages: deskRenamed });
          const now = workflowDefinitionHash(deskRenamed);

          expect(
            await stateOf(app(), partOf("posts", approved, "en"))
          ).toMatchObject({ stage: "approved", approval, definitionHash: now });
          expect(
            await eventsOf(
              "posts",
              approved,
              "workflow-approval-withdrawn-by-definition"
            )
          ).toEqual([]);
          expect(
            await stateOf(app(), partOf("posts", parked, "en"))
          ).toMatchObject({ stage: "paused", definitionHash: now });
          expect(
            await eventsOf("posts", parked, "workflow-stage-renamed")
          ).toHaveLength(1);
        });
      }
    );

    // SQLite only: a deploy boots again on the same database, and the test harness releases a
    // server-backed database when the next instance boots, so the second boot would find it gone.
    // The sweep reads and writes through the adapter alike on every dialect.
    describe.skipIf(dialect !== "sqlite")(
      "a deploy that detaches a workflow",
      () => {
        it("removes the collection's review state and pins, records it per document, and revives nothing when attached again", async () => {
          await boot(dialect);
          const post = await entry(app(), "posts");
          const page = await entry(app(), "pages");
          const approvedNo = await shownVersion(app(), "posts", post, "en");
          await seedState(app(), partOf("posts", post, "en"), "approved", {
            definitionHash: DESK,
            approval: await approvalOf("posts", post, "en"),
          });
          await seedState(app(), partOf("posts", post, "es"), "legal", {
            definitionHash: DESK,
          });
          await pin("posts", post, "approved:en", approvedNo);
          await seedState(app(), partOf("pages", page, null), "legal", {
            definitionHash: DESK,
          });

          await redeploy(dialect, { posts: null });

          expect(await statesOf("posts", post)).toEqual([]);
          expect(await pinsOf("posts", post)).toEqual({});
          const [detached, ...more] = await eventsOf(
            "posts",
            post,
            "workflow-detached"
          );
          expect(more).toEqual([]);
          expect(detached).toMatchObject({ actorKind: "system" });
          expect([...(detached?.parts ?? [])].sort()).toEqual(["en", "es"]);
          // Pages keeps its workflow, and its review state.
          expect(
            await stateOf(app(), partOf("pages", page, null))
          ).toMatchObject({ stage: "legal" });

          // Edited and published while detached, then attached again.
          await save("posts", post, { title: "Detached edit" }, "en");
          await save("posts", post, { status: "published" }, "en");
          await redeploy(dialect, { posts: desk });

          expect(await statesOf("posts", post)).toEqual([]);
          expect(
            await eventsOf("posts", post, "workflow-detached")
          ).toHaveLength(1);
        });
      }
    );

    // A production start reads nothing of the schema, so `nextly migrate`, the deploy step, follows
    // the workflows instead: here on the database a development start left, on every dialect.
    describe("the deploy step", () => {
      it("follows a renamed stage when `nextly migrate` runs it, as a production start does not", async () => {
        await boot(dialect);
        const parked = await entry(app(), "posts");
        await seedState(app(), partOf("posts", parked, "en"), "hold", {
          definitionHash: DESK,
        });

        await followWorkflowsAfterMigrate(
          defineConfig({
            collections: collectionsOn({
              posts: deskRenamed,
              pages: deskRenamed,
            }),
          }),
          null,
          app().adapter
        );

        expect(
          await stateOf(app(), partOf("posts", parked, "en"))
        ).toMatchObject({
          stage: "paused",
          definitionHash: workflowDefinitionHash(deskRenamed),
        });
      });
    });

    describe("deleting a document", () => {
      it("removes its review state by every delete path, and no other document's", async () => {
        await boot(dialect);
        const one = await entry(app(), "posts");
        const byQuery = await entry(app(), "posts");
        const batched = await entry(app(), "posts");
        const kept = await entry(app(), "posts");
        for (const id of [one, byQuery, batched, kept]) {
          await seedState(app(), partOf("posts", id, "en"), "legal", {
            definitionHash: DESK,
          });
          await seedState(app(), partOf("posts", id, null), "legal", {
            definitionHash: DESK,
          });
        }
        const handler = handlerOf(app());

        await handler.deleteEntry({
          collectionName: "posts",
          entryId: one,
          overrideAccess: true,
        });
        await handler.bulkDeleteByQuery(
          {
            collectionName: "posts",
            where: { id: { equals: byQuery } },
            overrideAccess: true,
          },
          {}
        );
        // The batch path takes no trust: it deletes as a person who may.
        await person(app(), "ed", [["delete", "posts"]]);
        const batch = await handler
          .getEntryService()
          .deleteEntries({ collectionName: "posts", user: { id: "ed" } }, [
            batched,
          ]);
        expect(batch, JSON.stringify(batch.errors)).toMatchObject({
          successful: 1,
        });

        expect(await statesOf("posts", one)).toEqual([]);
        expect(await statesOf("posts", byQuery)).toEqual([]);
        expect(await statesOf("posts", batched)).toEqual([]);
        expect(await statesOf("posts", kept)).toHaveLength(2);
      });
    });

    describe("discarding a working draft", () => {
      it("removes the part's review state and pins over a live page, recorded, and the shared part's with the last draft", async () => {
        await boot(dialect);
        const dave = await person(app(), "dave", [["update", "posts"]]);
        const post = await entry(app(), "posts");
        await save("posts", post, { status: "published" }, "en");
        await save("posts", post, { title: "Pending" }, "en");
        await save("posts", post, { title: "Pendiente" }, "es");
        await take("posts", post, "en", "submit", dave);
        expect(await stateOf(app(), partOf("posts", post, "en"))).toMatchObject(
          { stage: "legal" }
        );
        expect(Object.keys(await pinsOf("posts", post))).toEqual([
          "entered-review:en",
        ]);
        await seedState(app(), partOf("posts", post, "es"), "legal", {
          definitionHash: DESK,
        });
        await seedState(app(), partOf("posts", post, null), "legal", {
          definitionHash: DESK,
        });
        const handler = handlerOf(app());

        expect(
          await handler.discardWorkingDraftCounted({
            collectionName: "posts",
            // A discard names the version it read or says it overwrites; this one read none.
            version: { _overwrite: true },
            entryId: post,
            locale: "en",
            actor: { type: "user", id: "dave" },
            user: { id: "dave", name: "Dave" },
          })
        ).toBe(1);

        expect(await stateOf(app(), partOf("posts", post, "en"))).toBeNull();
        expect(await pinsOf("posts", post)).toEqual({});
        expect(await eventsOf("posts", post, "workflow-discarded")).toEqual([
          expect.objectContaining({
            actorKind: "person",
            actorId: "dave",
            fromState: "legal",
            parts: ["en"],
          }),
        ]);
        // Spanish still holds a draft, so it and the shared part keep their review state.
        expect(await stateOf(app(), partOf("posts", post, "es"))).toMatchObject(
          { stage: "legal" }
        );
        expect(await stateOf(app(), partOf("posts", post, null))).toMatchObject(
          { stage: "legal" }
        );

        await handler.discardWorkingDraftCounted({
          collectionName: "posts",
          // A discard names the version it read or says it overwrites; this one read none.
          version: { _overwrite: true },
          entryId: post,
          locale: "es",
        });
        expect(await statesOf("posts", post)).toEqual([]);
      });

      it("keeps the review state when there was no draft to discard", async () => {
        await boot(dialect);
        const page = await entry(app(), "pages");
        await seedState(app(), partOf("pages", page, null), "legal", {
          definitionHash: DESK,
        });

        expect(
          await handlerOf(app()).discardWorkingDraftCounted({
            collectionName: "pages",
            // A discard names the version it read or says it overwrites; this one read none.
            version: { _overwrite: true },
            entryId: page,
          })
        ).toBe(0);
        expect(await stateOf(app(), partOf("pages", page, null))).toMatchObject(
          { stage: "legal" }
        );
        expect(await eventsOf("pages", page, "workflow-discarded")).toEqual([]);
      });
    });
  }
);
