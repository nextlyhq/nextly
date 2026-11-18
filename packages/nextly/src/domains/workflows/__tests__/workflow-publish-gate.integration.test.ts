/**
 * The workflow's publish gate, asked as core asks it on a move's transaction, on every configured
 * dialect.
 *
 * Its verdict holds back a part that is not in a stage allowing publishing with a current
 * approval: one given under the definition attached now, whose content is still what goes live.
 * A Single's saves do not withdraw its approval, so its content is compared with the approval's
 * digest. "Publish without review" lets a person who holds it, or trusted code, with a reason, and
 * refuses an API key, a visitor, a person who does not hold it and a request with no reason. An
 * unpublish, and a collection with no workflow, are never held.
 *
 * Its `settle` closes each published part's review cycle on the same transaction: the review
 * state is removed by a compare-and-set on the revision judged, and the approval the part went
 * live under is kept in the history; a publish without review is recorded with its reason. A
 * part whose review state moved after the judgement refuses the whole publish, writing nothing.
 *
 * The plausible broken gates: one that checks only that an approval exists (an edited Single goes
 * live), one that closes the cycle without comparing the revision (a step that lands in between
 * is lost), and one that takes the reason or the caller's kind on trust.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it } from "vitest";

import { apiKeyScope } from "../../../auth/authenticated-scope";
import { defineCollection, defineSingle, text } from "../../../config";
import { container } from "../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type {
  PublishCaller,
  PublishGate,
  PublishGateQuestion,
  PublishGateVerdict,
} from "../../collections/services/publish-gate";
import { ContentEventsRepository } from "../../content-events/repository";
import type { VersionsDbApi } from "../../versions/db-api";
import { VersionsRepository } from "../../versions/versions-repository";
import { defineWorkflow } from "../define-workflow";
import { workflowDefinitionHash } from "../hash";
import {
  readReviewState,
  updateReviewState,
  type ReviewPart,
  type ReviewStatesDb,
} from "../review-state-repository";
import { takeWorkflowStep, type WorkflowCaller } from "../steps";

import { person, versionOf } from "./helpers/step-harness";

const gated = defineWorkflow({
  slug: "gated",
  label: "Gated",
  stages: [
    { name: "draft", label: "Draft" },
    { name: "review", label: "Review" },
    { name: "approved", label: "Approved", allowsPublish: true },
  ],
  steps: [
    {
      name: "submit",
      label: "Submit",
      kind: "submit",
      from: "draft",
      to: "review",
      primary: true,
    },
    {
      name: "approve",
      label: "Approve",
      kind: "approve",
      from: "review",
      to: "approved",
      permission: "sign-off",
      primary: true,
    },
    {
      name: "sendBack",
      label: "Send back",
      kind: "request-changes",
      from: ["review", "approved"],
      to: "draft",
      permission: "sign-off",
    },
  ],
});
const HASH = workflowDefinitionHash(gated);

const PAGES = "wg_pages";
const LOOSE = "wg_loose";
const BANNER = "wg_banner";
const drafts = { status: true, versions: { drafts: true } } as const;

type Doc = Record<string, unknown>;

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const app = (): TestNextly => {
  if (!current) throw new Error("not booted");
  return current;
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: PAGES,
        ...drafts,
        workflow: gated,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: LOOSE,
        ...drafts,
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        ...drafts,
        workflow: gated,
        fields: [text({ name: "title" })],
      }),
    ],
  });
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

const stateDb = (): ReviewStatesDb =>
  app().adapter as unknown as ReviewStatesDb;

const gate = (): PublishGate => container.get<PublishGate>("publishGate");

async function draftOf(slug: string, title = "First"): Promise<string> {
  const handler = app().getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: slug, overrideAccess: true },
    { title }
  );
  const id = (created.data as Doc | undefined)?.id;
  if (typeof id !== "string") throw new Error(`no id from create on ${slug}`);
  return id;
}

async function take(
  id: string,
  step: string,
  caller: WorkflowCaller,
  comment?: string
): Promise<void> {
  const state = await readReviewState(stateDb(), pagePart(id));
  await takeWorkflowStep(app().adapter, {
    document: { scopeKind: "collection", scopeSlug: PAGES, entryId: id },
    step,
    parts: [null],
    seen: [
      {
        part: null,
        revision: state?.revision ?? 0,
        version: await versionOf(app(), PAGES, id, null),
      },
    ],
    comment,
    caller,
  });
}

const pagePart = (id: string): ReviewPart => ({
  scopeKind: "collection",
  scopeSlug: PAGES,
  entryId: id,
  part: null,
});

/** A Page submitted by trusted code and approved by rita. */
async function approvedPage(): Promise<string> {
  const rita = await person(app(), "rita", [["sign-off", PAGES]]);
  const id = await draftOf(PAGES);
  await take(id, "submit", { kind: "system" });
  await take(id, "approve", rita);
  return id;
}

/** The question core asks to publish a never-published document whole. */
function publishing(
  scope: PublishGateQuestion["scope"],
  entryId: string,
  caller: PublishCaller = { kind: "trusted" },
  extra: Partial<PublishGateQuestion> = {}
): PublishGateQuestion {
  return {
    scope,
    entryId,
    direction: "publish",
    parts: [{ kind: "shared" }],
    live: { languages: [], shared: false },
    caller,
    ...extra,
  };
}

const pages = { kind: "collection", slug: PAGES } as const;

/**
 * Asks the gate on a transaction, as core does after locking the row, and settles the verdict
 * when it holds nothing back. `between` runs on the same transaction after the judgement and
 * before the settle, as a write that landed in between would.
 */
async function judgeAndSettle(
  question: PublishGateQuestion,
  between?: (tx: TransactionContext) => Promise<void>
): Promise<PublishGateVerdict> {
  return app().adapter.transaction(async tx => {
    const verdict = await gate().judge(tx, question);
    if (verdict.refusals.length > 0) return verdict;
    if (between) await between(tx);
    await verdict.settle();
    return verdict;
  });
}

/** Everything the document's history records, as one string to search. */
async function historyOf(
  kind: "collection" | "single",
  slug: string,
  id: string
) {
  const repo = new ContentEventsRepository(app().adapter, {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  });
  const { items } = await repo.listForSubject(
    { kind, slug, id },
    { limit: 100 }
  );
  return items;
}

/** The Banner's document id and its newest recorded content, written with `title`. */
async function bannerWith(title: string) {
  await app().nextly.updateSingle({
    slug: BANNER as never,
    data: { title, _overwrite: true },
  } as never);
  const doc = (await app().nextly.findSingle({
    slug: BANNER as never,
    status: "all",
  } as never)) as Doc;
  const id = String(doc.id);
  const newest = await app().adapter.transaction(tx =>
    new VersionsRepository(tx as unknown as VersionsDbApi).findNewest({
      scopeKind: "single",
      scopeSlug: BANNER,
      entryId: id,
    })
  );
  if (!newest?.versionNo) throw new Error("the Banner has no recorded version");
  return { id, newest };
}

describe.each(getConfiguredTestDialects())(
  "the workflow's publish gate (%s)",
  dialect => {
    it("is the gate core asks, once a workflow is attached", async () => {
      await boot(dialect);
      // A positive control: an open gate would let every case below through.
      const id = await draftOf(PAGES);
      expect((await gate().refusals(publishing(pages, id))).length).toBe(1);
    });

    describe("holds back", () => {
      it("a part that was never approved, on the early ask and under the lock", async () => {
        await boot(dialect);
        const id = await draftOf(PAGES);

        const early = await gate().refusals(publishing(pages, id));
        const verdict = await judgeAndSettle(publishing(pages, id));

        expect(early.map(refusal => refusal.code)).toEqual(["NOT_APPROVED"]);
        expect(verdict.refusals).toEqual([
          expect.objectContaining({
            part: { kind: "shared" },
            code: "NOT_APPROVED",
          }),
        ]);
      });

      it("a part sent back out of the approved stage", async () => {
        await boot(dialect);
        const id = await approvedPage();
        const rita: WorkflowCaller = { kind: "user", userId: "rita" };
        // Request changes always asks for a comment.
        await take(id, "sendBack", rita, "Not yet");

        const verdict = await judgeAndSettle(publishing(pages, id));

        expect(verdict.refusals.map(refusal => refusal.code)).toEqual([
          "NOT_APPROVED",
        ]);
      });

      it("an approval given under another definition", async () => {
        await boot(dialect);
        const id = await approvedPage();
        const state = await readReviewState(stateDb(), pagePart(id));
        await updateReviewState(stateDb(), pagePart(id), state!.revision, {
          definitionHash: "an-earlier-definition",
        });

        const verdict = await judgeAndSettle(publishing(pages, id));

        expect(verdict.refusals.map(refusal => refusal.code)).toEqual([
          "NOT_APPROVED",
        ]);
      });
    });

    describe("lets through", () => {
      it("a Single, approved or not, until a Single's steps can approve it", async () => {
        await boot(dialect);
        const banner = { kind: "single", slug: BANNER } as const;
        const never = await bannerWith("Never reviewed");

        const early = await gate().refusals(publishing(banner, never.id));
        const locked = await app().adapter.transaction(tx =>
          gate().judge(tx, publishing(banner, never.id))
        );

        expect(early).toEqual([]);
        expect(locked.refusals).toEqual([]);
      });

      it("an approved part", async () => {
        await boot(dialect);
        const id = await approvedPage();

        expect(await gate().refusals(publishing(pages, id))).toEqual([]);
        expect((await judgeAndSettle(publishing(pages, id))).refusals).toEqual(
          []
        );
      });

      it("an unpublish, in any stage", async () => {
        await boot(dialect);
        const id = await draftOf(PAGES);

        const verdict = await judgeAndSettle({
          ...publishing(pages, id),
          direction: "unpublish",
          live: { languages: [], shared: true },
        });

        expect(verdict.refusals).toEqual([]);
      });

      it("a collection with no workflow", async () => {
        await boot(dialect);
        const id = await draftOf(LOOSE);

        const verdict = await judgeAndSettle(
          publishing({ kind: "collection", slug: LOOSE }, id)
        );

        expect(verdict.refusals).toEqual([]);
      });
    });

    describe("settling a publish", () => {
      it("closes the part's review cycle and keeps the approval it went live under", async () => {
        await boot(dialect);
        const id = await approvedPage();
        const approval = (await readReviewState(stateDb(), pagePart(id)))!
          .approval!;

        await judgeAndSettle(publishing(pages, id));

        expect(await readReviewState(stateDb(), pagePart(id))).toBeNull();
        const published = (await historyOf("collection", PAGES, id)).find(
          event => event.kind === "workflow-published"
        );
        expect(published?.payload).toEqual({
          approval: {
            versionNo: approval.versionNo,
            by: "rita",
            at: approval.at.toISOString(),
          },
        });
      });

      it("refuses the whole publish when the review state moved after the judgement", async () => {
        await boot(dialect);
        const id = await approvedPage();
        const before = (await readReviewState(stateDb(), pagePart(id)))!;

        const settled = judgeAndSettle(publishing(pages, id), async tx => {
          // A step that landed between the judgement and the write.
          await updateReviewState(
            tx as unknown as ReviewStatesDb,
            pagePart(id),
            before.revision,
            { stage: "review", approval: null }
          );
        });

        await expect(settled).rejects.toMatchObject({ statusCode: 409 });
        // Rolled back with the move: the part is where it was, still approved.
        const after = await readReviewState(stateDb(), pagePart(id));
        expect(after?.revision).toBe(before.revision);
        expect(after?.approval).not.toBeNull();
        expect(
          (await historyOf("collection", PAGES, id)).some(
            event => event.kind === "workflow-published"
          )
        ).toBe(false);
      });
    });

    describe("publish without review", () => {
      const asked = (reason: string) => ({ withoutReview: { reason } });

      it("lets a person who holds it through, and records the reason", async () => {
        await boot(dialect);
        await person(app(), "una", [["publish-without-review", PAGES]]);
        const id = await draftOf(PAGES);

        const verdict = await judgeAndSettle(
          publishing(
            pages,
            id,
            { kind: "user", userId: "una" },
            {
              ...asked("Embargo lifted early"),
              actor: { type: "user", id: "una" },
            }
          )
        );

        expect(verdict.refusals).toEqual([]);
        const recorded = (await historyOf("collection", PAGES, id)).find(
          event => event.kind === "workflow-published-without-review"
        );
        expect(recorded?.note).toBe("Embargo lifted early");
      });

      it("lets trusted code with a reason through", async () => {
        await boot(dialect);
        const id = await draftOf(PAGES);

        const verdict = await judgeAndSettle(
          publishing(pages, id, { kind: "trusted" }, asked("Nightly import"))
        );

        expect(verdict.refusals).toEqual([]);
      });

      it.each([
        [
          "a person who does not hold it",
          { kind: "user", userId: "paula" },
          "Embargo",
        ],
        ["a request with no reason", { kind: "trusted" }, "   "],
        ["a visitor", { kind: "visitor" }, "Embargo"],
      ] as const)("refuses %s", async (_name, caller, reason) => {
        await boot(dialect);
        await person(app(), "paula", [["publish", PAGES]]);
        const id = await draftOf(PAGES);

        const question = publishing(pages, id, caller, asked(reason));
        const early = await gate().refusals(question);
        const verdict = await judgeAndSettle(question);

        expect(early.map(refusal => refusal.code)).toEqual([
          "WITHOUT_REVIEW_REFUSED",
        ]);
        expect(verdict.refusals.map(refusal => refusal.code)).toEqual([
          "WITHOUT_REVIEW_REFUSED",
        ]);
      });

      it("refuses an API key, whatever the key holds", async () => {
        await boot(dialect);
        await person(app(), "una", [["publish-without-review", PAGES]]);
        const id = await draftOf(PAGES);
        const scope = apiKeyScope(
          ["publish", "publish-without-review"].map(action => ({
            slug: `${action}-${PAGES}`,
            action,
            resource: PAGES,
          }))
        );

        const verdict = await judgeAndSettle(
          publishing(
            pages,
            id,
            { kind: "api-key", userId: "una", scope },
            asked("Embargo lifted early")
          )
        );

        expect(verdict.refusals.map(refusal => refusal.code)).toEqual([
          "WITHOUT_REVIEW_REFUSED",
        ]);
      });
    });
  }
);
