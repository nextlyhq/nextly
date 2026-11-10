/**
 * Taking workflow steps through the steps service, on every configured dialect: who may take each
 * step (its named action, or `update-`/`publish-<slug>` by default), that approvals and requests
 * for changes come only from a signed-in person, self-approval refused to the person accountable
 * for the part's stage (a key's act counting as its owner's), comments, the compare-and-set on the
 * review-state revision, "all languages", a part with no state reading as the first stage, the
 * stage's default reviewer, and the event each step records in the same transaction.
 *
 * Refusal cases start from review state seeded through the repository, so what they observe is the
 * refusal and not a setup step; each refusal also asserts that the state and the record are as
 * they were, since a refusal reported after the write is the defect a precondition exists to stop.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { approvalDigest } from "../approval-digest";
import { workflowDefinitionHash } from "../hash";
import { reviewWorkflow } from "../preset";
import { updateReviewState } from "../review-state-repository";
import { takeWorkflowStep, type WorkflowCaller } from "../steps";
import { writeWorkflowSettings } from "../workflow-settings-repository";

import {
  apiKey,
  bootSteps,
  entry,
  partOf,
  person,
  seedState,
  stateDb,
  saveIn,
  shownVersion,
  stateOf,
  SYSTEM,
  snapshotOf,
  versionOf,
  workflowEvents,
} from "./helpers/step-harness";
import { editorial, handover } from "./helpers/step-workflows";

const HASH = workflowDefinitionHash(editorial);

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** The case's install; set by each case's boot. */
const app = (): TestNextly => {
  if (!t) throw new Error("not booted");
  return t;
};

/**
 * Takes `step` on one part of a Posts document, seen at `revision`, and at the content version
 * `version`: by default the version the part holds now, as a caller that just read it would.
 */
async function step(
  entryId: string,
  name: string,
  caller: WorkflowCaller,
  options: {
    part?: string | null;
    revision?: number;
    version?: string;
    comment?: string;
    slug?: string;
  } = {}
) {
  const part = options.part === undefined ? "en" : options.part;
  const slug = options.slug ?? "posts";
  const version =
    options.version ?? (await versionOf(app(), slug, entryId, part));
  return takeWorkflowStep(app().adapter, {
    document: { scopeKind: "collection", scopeSlug: slug, entryId },
    step: name,
    parts: [part],
    seen: [{ part, revision: options.revision ?? 0, version }],
    comment: options.comment,
    caller,
  });
}

/** What a caller who just read each part saw of it, at the review-state revision given. */
async function seenNow(
  entryId: string,
  parts: Array<[part: string | null, revision: number]>
) {
  const seen = [];
  for (const [part, revision] of parts) {
    seen.push({
      part,
      revision,
      version: await versionOf(app(), "posts", entryId, part),
    });
  }
  return seen;
}

describe.each(getConfiguredTestDialects())(
  "taking a workflow step (%s)",
  dialect => {
    describe("permissions", () => {
      it("lets a holder of a step's named action take it on one collection, and refuses it on another naming that one's permission", async () => {
        t = await bootSteps(dialect);
        const bob = await person(t, "bob", [
          ["sign-off", "posts"],
          ["update", "posts"],
          ["update", "pages"],
        ]);
        const post = await entry(t, "posts");
        const page = await entry(t, "pages");
        await seedState(t, partOf("posts", post, "en"), "legal", {
          enteredBy: "alice",
          definitionHash: HASH,
        });
        await seedState(t, partOf("pages", page, null), "legal", {
          enteredBy: "alice",
          definitionHash: HASH,
        });

        const cleared = await step(post, "clear", bob, { revision: 1 });
        expect(cleared.moved).toEqual([
          { part: "en", from: "legal", to: "cleared", revision: 2 },
        ]);
        expect(await stateOf(t, partOf("posts", post, "en"))).toMatchObject({
          stage: "cleared",
          enteredBy: "bob",
          revision: 2,
        });

        // The same action on Pages is its own permission, which bob does not hold.
        await expect(
          step(page, "clear", bob, { slug: "pages", part: null, revision: 1 })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: { reason: "no-permission", permission: "sign-off-pages" },
        });
        expect(await stateOf(t, partOf("pages", page, null))).toMatchObject({
          stage: "legal",
          enteredBy: "alice",
          revision: 1,
        });
        expect(await workflowEvents(t, "pages", page)).toEqual([]);
      });

      it("needs update-<slug> for a step naming no action, and publish-<slug> for one into a publishable stage", async () => {
        t = await bootSteps(dialect);
        const dave = await person(t, "dave", [["update", "posts"]]);
        const erin = await person(t, "erin", [["publish", "posts"]]);
        const post = await entry(t, "posts");

        // Sending names no action and moves into a stage that does not allow publishing.
        await step(post, "send", dave, { part: "en" });
        expect((await stateOf(t, partOf("posts", post, "en")))?.stage).toBe(
          "legal"
        );
        await expect(
          step(post, "send", erin, { part: "ar" })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: { reason: "no-permission", permission: "update-posts" },
        });

        // The fast track out of On hold names no action but moves into Cleared, which allows
        // publishing: editing is not enough for it.
        const es = partOf("posts", post, "es");
        // Spanish is written, so it has a version to approve.
        await saveIn(t, "posts", post, "es", { title: "Hola" });
        await seedState(t, es, "hold", {
          enteredBy: "alice",
          definitionHash: HASH,
        });
        await expect(
          step(post, "fastTrack", dave, { part: "es", revision: 1 })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: { reason: "no-permission", permission: "publish-posts" },
        });
        expect(await stateOf(t, es)).toMatchObject({
          stage: "hold",
          revision: 1,
        });
        await step(post, "fastTrack", erin, { part: "es", revision: 1 });
        expect(await stateOf(t, es)).toMatchObject({
          stage: "cleared",
          revision: 2,
        });
        expect(await stateOf(t, partOf("posts", post, "ar"))).toBeNull();
      });

      it("lets an API key take a step its key holds, recorded as the key's act with its owner accountable", async () => {
        t = await bootSteps(dialect);
        await person(t, "alice", []);
        const key = apiKey("key-alice", "alice", [["update", "posts"]]);
        const post = await entry(t, "posts");

        await step(post, "send", key, { part: "en" });

        expect(await stateOf(t, partOf("posts", post, "en"))).toMatchObject({
          stage: "legal",
          enteredBy: "alice",
          revision: 1,
        });
        const [event, ...more] = await workflowEvents(t, "posts", post);
        expect(more).toEqual([]);
        expect(event).toMatchObject({
          kind: "workflow-submit",
          actorKind: "apiKey",
          actorId: "key-alice",
          payload: expect.objectContaining({ step: "send", ownerId: "alice" }),
        });
      });
    });

    describe("the collection's own access rule", () => {
      it("refuses a step needing update when the collection's update rule refuses it, though the person holds update, writing nothing", async () => {
        t = await bootSteps(dialect);
        const dave = await person(t, "dave", [["update", "locked"]]);
        const doc = await entry(t, "locked");

        await expect(
          step(doc, "send", dave, { slug: "locked", part: null })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: { reason: "no-permission", permission: "update-locked" },
        });
        expect(await stateOf(t, partOf("locked", doc, null))).toBeNull();
        expect(await workflowEvents(t, "locked", doc)).toEqual([]);
      });

      it("refuses a step needing publish when the collection's publish rule refuses it, though the person holds publish", async () => {
        t = await bootSteps(dialect);
        const erin = await person(t, "erin", [["publish", "locked"]]);
        const doc = await entry(t, "locked");
        const shared = partOf("locked", doc, null);
        await seedState(t, shared, "hold", {
          enteredBy: "alice",
          definitionHash: HASH,
        });

        await expect(
          step(doc, "fastTrack", erin, {
            slug: "locked",
            part: null,
            revision: 1,
          })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: {
            reason: "no-permission",
            permission: "publish-locked",
          },
        });
        expect(await stateOf(t, shared)).toMatchObject({
          stage: "hold",
          approval: null,
          revision: 1,
        });
        expect(await workflowEvents(t, "locked", doc)).toEqual([]);
      });
    });

    describe("a rule that answers by language", () => {
      it("judges a step needing update in the part's own language: allowed on Spanish, which the rule allows, and refused on English", async () => {
        t = await bootSteps(dialect);
        const dave = await person(t, "dave", [["update", "translations"]]);
        const doc = await entry(t, "translations");
        const opts = { slug: "translations" };

        const sent = await step(doc, "send", dave, { ...opts, part: "es" });
        expect(sent.moved).toEqual([
          { part: "es", from: "writing", to: "legal", revision: 1 },
        ]);

        await expect(
          step(doc, "send", dave, { ...opts, part: "en" })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: {
            reason: "no-permission",
            permission: "update-translations",
          },
        });
        expect(await stateOf(t, partOf("translations", doc, "en"))).toBeNull();
      });
    });

    describe("approvals come only from a signed-in person", () => {
      const callers: Array<[string, () => WorkflowCaller]> = [
        [
          "an API key holding the step's permission",
          () =>
            apiKey("key-bob", "bob", [
              ["sign-off", "posts"],
              ["update", "posts"],
            ]),
        ],
        ["trusted code acting as no person", () => SYSTEM],
      ];

      it.each(callers)(
        "refuses an approval and a request for changes from %s, changing nothing",
        async (_label, caller) => {
          t = await bootSteps(dialect);
          await person(t, "bob", [["sign-off", "posts"]]);
          const post = await entry(t, "posts");
          const en = partOf("posts", post, "en");
          await seedState(t, en, "legal", {
            enteredBy: "alice",
            definitionHash: HASH,
          });

          // Custom names: the rule follows the steps' kinds.
          await expect(
            step(post, "clear", caller(), { revision: 1 })
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            publicMessage: expect.stringMatching(
              /^Only a signed-in person can/
            ),
          });
          await expect(
            step(post, "bounce", caller(), {
              revision: 1,
              comment: "Not yet",
            })
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            publicMessage: expect.stringMatching(
              /^Only a signed-in person can/
            ),
          });

          expect(await stateOf(t, en)).toMatchObject({
            stage: "legal",
            enteredBy: "alice",
            revision: 1,
          });
          expect(await workflowEvents(t, "posts", post)).toEqual([]);
        }
      );
    });

    describe("self-approval", () => {
      it("refuses the clearing to the person who sent the part, and allows it to someone else", async () => {
        t = await bootSteps(dialect);
        const grants = [
          ["sign-off", "posts"],
          ["update", "posts"],
        ] as const;
        const alice = await person(t, "alice", grants);
        const bob = await person(t, "bob", grants);
        const post = await entry(t, "posts");
        const en = partOf("posts", post, "en");

        await step(post, "send", alice);
        await expect(
          step(post, "clear", alice, { revision: 1 })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: { reason: "self-approval" },
        });
        expect(await stateOf(t, en)).toMatchObject({
          stage: "legal",
          revision: 1,
        });

        await step(post, "clear", bob, { revision: 1 });
        expect(await stateOf(t, en)).toMatchObject({
          stage: "cleared",
          revision: 2,
        });
      });

      it("refuses the clearing to the owner of the key that sent the part", async () => {
        t = await bootSteps(dialect);
        const grants = [
          ["sign-off", "posts"],
          ["update", "posts"],
        ] as const;
        const alice = await person(t, "alice", grants);
        const bob = await person(t, "bob", grants);
        const post = await entry(t, "posts");

        await step(post, "send", apiKey("key-alice", "alice", grants));
        await expect(
          step(post, "clear", alice, { revision: 1 })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: { reason: "self-approval" },
        });
        await step(post, "clear", bob, { revision: 1 });
        expect((await stateOf(t, partOf("posts", post, "en")))?.stage).toBe(
          "cleared"
        );
      });

      it("refuses the sign-off to the person whose move brought the part into review, on a workflow with no submit step", async () => {
        t = await bootSteps(dialect);
        const grants = [
          ["sign-off", "memos"],
          ["update", "memos"],
        ] as const;
        const alice = await person(t, "alice", grants);
        const bob = await person(t, "bob", grants);
        const memo = await entry(t, "memos");
        const opts = { slug: "memos", part: null };

        await step(memo, "handOver", alice, opts);
        await expect(
          step(memo, "signOff", alice, { ...opts, revision: 1 })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: { reason: "self-approval" },
        });
        await step(memo, "signOff", bob, { ...opts, revision: 1 });
        expect(await stateOf(t, partOf("memos", memo, null))).toMatchObject({
          stage: "ok",
          definitionHash: workflowDefinitionHash(handover),
        });
      });

      it("holds accountable the person whose move re-entered review, not the one who first sent it", async () => {
        t = await bootSteps(dialect);
        const grants = [
          ["sign-off", "posts"],
          ["update", "posts"],
        ] as const;
        const alice = await person(t, "alice", grants);
        const bob = await person(t, "bob", grants);
        const post = await entry(t, "posts");

        await step(post, "send", alice);
        await step(post, "park", bob, {
          revision: 1,
          comment: "Waiting on the lawyer",
        });
        await step(post, "resume", bob, { revision: 2 });
        expect((await stateOf(t, partOf("posts", post, "en")))?.enteredBy).toBe(
          "bob"
        );

        await expect(
          step(post, "clear", bob, { revision: 3 })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: { reason: "self-approval" },
        });
        await step(post, "clear", alice, { revision: 3 });
        expect((await stateOf(t, partOf("posts", post, "en")))?.stage).toBe(
          "cleared"
        );
      });

      it("lets the person who submitted approve where the step does not refuse it", async () => {
        t = await bootSteps(dialect);
        const alice = await person(t, "alice", [
          ["approve", "notes"],
          ["update", "notes"],
        ]);
        const note = await entry(t, "notes");
        const opts = { slug: "notes", part: null };

        await step(note, "submit", alice, opts);
        await step(note, "approve", alice, { ...opts, revision: 1 });

        expect(await stateOf(t, partOf("notes", note, null))).toMatchObject({
          stage: "approved",
          definitionHash: workflowDefinitionHash(reviewWorkflow()),
        });
      });
    });

    describe("comments", () => {
      it("refuses a request for changes with no comment or a blank one, changing nothing", async () => {
        t = await bootSteps(dialect);
        const bob = await person(t, "bob", [["sign-off", "posts"]]);
        const post = await entry(t, "posts");
        const en = partOf("posts", post, "en");
        await seedState(t, en, "legal", {
          enteredBy: "alice",
          definitionHash: HASH,
        });

        for (const comment of [undefined, "   "]) {
          await expect(
            step(post, "bounce", bob, { revision: 1, comment })
          ).rejects.toMatchObject({
            code: "VALIDATION_ERROR",
            publicData: {
              errors: [
                expect.objectContaining({
                  path: "comment",
                  code: "WORKFLOW_COMMENT_REQUIRED",
                }),
              ],
            },
          });
        }
        expect(await stateOf(t, en)).toMatchObject({
          stage: "legal",
          revision: 1,
        });
        expect(await workflowEvents(t, "posts", post)).toEqual([]);
      });

      it("refuses a step whose definition requires a comment, taken without one", async () => {
        t = await bootSteps(dialect);
        const bob = await person(t, "bob", [["update", "posts"]]);
        const post = await entry(t, "posts");
        const en = partOf("posts", post, "en");
        await seedState(t, en, "legal", {
          enteredBy: "alice",
          definitionHash: HASH,
        });

        // A move, not a request for changes: required only because the step says so.
        await expect(
          step(post, "park", bob, { revision: 1 })
        ).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
          publicData: {
            errors: [
              expect.objectContaining({
                path: "comment",
                code: "WORKFLOW_COMMENT_REQUIRED",
              }),
            ],
          },
        });
        expect((await stateOf(t, en))?.stage).toBe("legal");
      });

      it("refuses a comment longer than the record keeps, and keeps one at the limit as the event's note", async () => {
        t = await bootSteps(dialect);
        const bob = await person(t, "bob", [["sign-off", "posts"]]);
        const post = await entry(t, "posts");
        const en = partOf("posts", post, "en");
        await seedState(t, en, "legal", {
          enteredBy: "alice",
          definitionHash: HASH,
        });

        await expect(
          step(post, "bounce", bob, { revision: 1, comment: "x".repeat(4001) })
        ).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
          publicData: {
            errors: [
              expect.objectContaining({
                path: "comment",
                code: "WORKFLOW_COMMENT_TOO_LONG",
              }),
            ],
          },
        });
        expect((await stateOf(t, en))?.revision).toBe(1);

        const longest = "y".repeat(4000);
        await step(post, "bounce", bob, { revision: 1, comment: longest });
        const events = await workflowEvents(t, "posts", post);
        expect(events.map(event => event.note)).toEqual([longest]);
      });
    });

    describe("compare-and-set on the review state", () => {
      it("refuses a step over a revision that moved since it was seen, keeping nothing", async () => {
        t = await bootSteps(dialect);
        const bob = await person(t, "bob", [["sign-off", "posts"]]);
        const post = await entry(t, "posts");
        const en = partOf("posts", post, "en");
        await seedState(t, en, "legal", {
          enteredBy: "alice",
          definitionHash: HASH,
        });
        // Someone else wrote the part after bob loaded it.
        expect(
          await updateReviewState(stateDb(t), en, 1, {
            assignee: { kind: "user", id: "carol" },
          })
        ).toBe(true);

        await expect(
          step(post, "clear", bob, { revision: 1 })
        ).rejects.toMatchObject({
          code: "CONFLICT",
          publicData: { reason: "stale", parts: ["en"] },
        });
        expect(await stateOf(t, en)).toMatchObject({
          stage: "legal",
          revision: 2,
        });
        expect(await workflowEvents(t, "posts", post)).toEqual([]);
      });

      it("refuses a step seen as having no state on a part that has one", async () => {
        t = await bootSteps(dialect);
        const dave = await person(t, "dave", [["update", "posts"]]);
        const post = await entry(t, "posts");
        const en = partOf("posts", post, "en");
        await seedState(t, en, "writing", {
          enteredBy: "alice",
          definitionHash: HASH,
        });

        await expect(
          step(post, "send", dave, { revision: 0 })
        ).rejects.toMatchObject({
          code: "CONFLICT",
          publicData: { reason: "stale", parts: ["en"] },
        });
        expect(await stateOf(t, en)).toMatchObject({
          stage: "writing",
          enteredBy: "alice",
          revision: 1,
        });
      });

      it("lets exactly one of an approval and a request for changes taken at once succeed", async () => {
        t = await bootSteps(dialect);
        const bob = await person(t, "bob", [["sign-off", "posts"]]);
        const carol = await person(t, "carol", [["sign-off", "posts"]]);
        const post = await entry(t, "posts");
        const en = partOf("posts", post, "en");
        await seedState(t, en, "legal", {
          enteredBy: "alice",
          definitionHash: HASH,
        });

        const [approve, requestChanges] = await Promise.allSettled([
          step(post, "clear", bob, { revision: 1 }),
          step(post, "bounce", carol, { revision: 1, comment: "No" }),
        ]);

        const won = [approve, requestChanges].filter(
          result => result.status === "fulfilled"
        );
        const lost = [approve, requestChanges].filter(
          result => result.status === "rejected"
        );
        expect(won).toHaveLength(1);
        expect(lost).toHaveLength(1);
        expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({
          code: "CONFLICT",
          publicData: { reason: "stale" },
        });
        const approved = approve.status === "fulfilled";
        expect(await stateOf(t, en)).toMatchObject({
          stage: approved ? "cleared" : "writing",
          enteredBy: approved ? "bob" : "carol",
          revision: 2,
        });
        expect(
          (await workflowEvents(t, "posts", post)).map(event => event.kind)
        ).toEqual([approved ? "workflow-approve" : "workflow-request-changes"]);
      });
    });

    describe("stages", () => {
      it("reads a part with no review state as the workflow's first stage", async () => {
        t = await bootSteps(dialect);
        const dave = await person(t, "dave", [["update", "posts"]]);
        const bob = await person(t, "bob", [["sign-off", "posts"]]);
        const post = await entry(t, "posts");

        const sent = await step(post, "send", dave, { part: "en" });
        expect(sent.moved).toEqual([
          { part: "en", from: "writing", to: "legal", revision: 1 },
        ]);

        // Spanish has no state either, so it is in Writing, from which Clear is not taken.
        await expect(
          step(post, "clear", bob, { part: "es" })
        ).rejects.toMatchObject({
          code: "CONFLICT",
          publicData: {
            reason: "not-from-stage",
            left: [{ part: "es", stage: "writing", reason: "not-from-stage" }],
          },
        });
        expect(await stateOf(t, partOf("posts", post, "es"))).toBeNull();
      });

      it("withdraws the approval when a part steps out of a publishable stage", async () => {
        t = await bootSteps(dialect);
        const bob = await person(t, "bob", [["sign-off", "posts"]]);
        const post = await entry(t, "posts");
        const en = partOf("posts", post, "en");
        await seedState(t, en, "cleared", {
          enteredBy: "bob",
          approval: {
            versionNo: 1,
            digest: "d1",
            by: "bob",
            at: new Date("2026-11-02T10:00:00.000Z"),
          },
          definitionHash: HASH,
        });

        await step(post, "bounce", bob, {
          revision: 1,
          comment: "Spotted a typo",
        });

        expect(await stateOf(t, en)).toMatchObject({
          stage: "writing",
          approval: null,
          revision: 2,
        });
      });
    });

    describe("all languages", () => {
      it("approves all languages of an untranslated document as its shared part alone", async () => {
        t = await bootSteps(dialect);
        const bob = await person(t, "bob", [["sign-off", "pages"]]);
        const page = await entry(t, "pages");
        const shared = partOf("pages", page, null);
        await seedState(t, shared, "legal", {
          enteredBy: "alice",
          definitionHash: HASH,
        });

        const result = await takeWorkflowStep(t.adapter, {
          document: {
            scopeKind: "collection",
            scopeSlug: "pages",
            entryId: page,
          },
          step: "clear",
          parts: "all",
          seen: [
            {
              part: null,
              revision: 1,
              version: await versionOf(t, "pages", page, null),
            },
          ],
          caller: bob,
        });

        // Pages keeps no translations: its one part is the shared part, and there is nothing
        // else to name as left.
        expect(result.moved).toEqual([
          { part: null, from: "legal", to: "cleared", revision: 2 },
        ]);
        expect(result.left).toEqual([]);
        expect((await stateOf(t, shared))?.approval).toMatchObject({
          versionNo: await shownVersion(t, "pages", page, null),
          by: "bob",
        });
        for (const locale of ["en", "es", "ar"]) {
          expect(await stateOf(t, partOf("pages", page, locale))).toBeNull();
        }
      });

      it("submits all languages of an untranslated document as its shared part alone", async () => {
        t = await bootSteps(dialect);
        const dave = await person(t, "dave", [["update", "pages"]]);
        const page = await entry(t, "pages");

        const result = await takeWorkflowStep(t.adapter, {
          document: {
            scopeKind: "collection",
            scopeSlug: "pages",
            entryId: page,
          },
          step: "send",
          parts: "all",
          seen: [
            {
              part: null,
              revision: 0,
              version: await versionOf(t, "pages", page, null),
            },
          ],
          caller: dave,
        });

        expect(result.moved).toEqual([
          { part: null, from: "writing", to: "legal", revision: 1 },
        ]);
        expect(result.left).toEqual([]);
        expect((await stateOf(t, partOf("pages", page, null)))?.stage).toBe(
          "legal"
        );
        for (const locale of ["en", "es", "ar"]) {
          expect(await stateOf(t, partOf("pages", page, locale))).toBeNull();
        }
      });

      it("sends every part it can from its stage in one step, naming the parts it left", async () => {
        t = await bootSteps(dialect);
        const dave = await person(t, "dave", [["update", "posts"]]);
        const post = await entry(t, "posts");
        await seedState(t, partOf("posts", post, "en"), "legal", {
          definitionHash: HASH,
        });
        await seedState(t, partOf("posts", post, "ar"), "cleared", {
          definitionHash: HASH,
        });

        const result = await takeWorkflowStep(t.adapter, {
          document: {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: post,
          },
          step: "send",
          parts: "all",
          seen: await seenNow(post, [
            ["es", 0],
            [null, 0],
          ]),
          caller: dave,
        });

        const byPart = (
          a: { part: string | null },
          b: { part: string | null }
        ) => String(a.part).localeCompare(String(b.part));
        expect([...result.moved].sort(byPart)).toEqual(
          [
            { part: "es", from: "writing", to: "legal", revision: 1 },
            { part: null, from: "writing", to: "legal", revision: 1 },
          ].sort(byPart)
        );
        expect([...result.left].sort(byPart)).toEqual(
          [
            { part: "en", stage: "legal", reason: "not-from-stage" },
            { part: "ar", stage: "cleared", reason: "not-from-stage" },
          ].sort(byPart)
        );
        expect((await stateOf(t, partOf("posts", post, "es")))?.stage).toBe(
          "legal"
        );
        expect((await stateOf(t, partOf("posts", post, null)))?.stage).toBe(
          "legal"
        );
        // The parts it left are untouched.
        expect(await stateOf(t, partOf("posts", post, "en"))).toMatchObject({
          stage: "legal",
          revision: 1,
        });
        expect(await stateOf(t, partOf("posts", post, "ar"))).toMatchObject({
          stage: "cleared",
          revision: 1,
        });
        const events = await workflowEvents(t, "posts", post);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          kind: "workflow-submit",
          fromState: "writing",
          toState: "legal",
        });
        expect([...(events[0]?.parts ?? [])].sort()).toEqual(
          ["es", "~shared"].sort()
        );
      });

      it("refuses all languages when no part can take the step", async () => {
        t = await bootSteps(dialect);
        const dave = await person(t, "dave", [["update", "posts"]]);
        const post = await entry(t, "posts");
        for (const part of ["en", "es", "ar", null]) {
          await seedState(t, partOf("posts", post, part), "legal", {
            definitionHash: HASH,
          });
        }

        await expect(
          takeWorkflowStep(t.adapter, {
            document: {
              scopeKind: "collection",
              scopeSlug: "posts",
              entryId: post,
            },
            step: "send",
            parts: "all",
            seen: [],
            caller: dave,
          })
        ).rejects.toMatchObject({
          code: "CONFLICT",
          publicData: {
            reason: "not-from-stage",
            left: expect.arrayContaining([
              { part: "en", stage: "legal", reason: "not-from-stage" },
              { part: "es", stage: "legal", reason: "not-from-stage" },
              { part: "ar", stage: "legal", reason: "not-from-stage" },
              { part: null, stage: "legal", reason: "not-from-stage" },
            ]),
          },
        });
        expect(await workflowEvents(t, "posts", post)).toEqual([]);
      });

      it("refuses clearing all languages when any part moved since it was seen, keeping none", async () => {
        t = await bootSteps(dialect);
        const bob = await person(t, "bob", [["sign-off", "posts"]]);
        const post = await entry(t, "posts");
        const en = partOf("posts", post, "en");
        const es = partOf("posts", post, "es");
        await saveIn(t, "posts", post, "es", { title: "Hola" });
        for (const part of [en, es]) {
          await seedState(t, part, "legal", { definitionHash: HASH });
        }
        // Spanish moved after bob loaded the parts.
        await updateReviewState(stateDb(t), es, 1, {
          assignee: { kind: "user", id: "carol" },
        });

        await expect(
          takeWorkflowStep(t.adapter, {
            document: {
              scopeKind: "collection",
              scopeSlug: "posts",
              entryId: post,
            },
            step: "clear",
            parts: "all",
            seen: await seenNow(post, [
              ["en", 1],
              ["es", 1],
            ]),
            caller: bob,
          })
        ).rejects.toMatchObject({
          code: "CONFLICT",
          publicData: { reason: "stale", parts: ["es"] },
        });
        // English, which matched, is not cleared on its own.
        expect(await stateOf(t, en)).toMatchObject({
          stage: "legal",
          revision: 1,
        });
        expect(await stateOf(t, es)).toMatchObject({
          stage: "legal",
          revision: 2,
        });
        expect(await workflowEvents(t, "posts", post)).toEqual([]);
      });
    });

    describe("the content version", () => {
      it("refuses a step when the part's content changed since it was seen, keeping nothing", async () => {
        t = await bootSteps(dialect);
        const bob = await person(t, "bob", [["sign-off", "posts"]]);
        const post = await entry(t, "posts");
        const en = partOf("posts", post, "en");
        await seedState(t, en, "legal", {
          enteredBy: "alice",
          definitionHash: HASH,
        });
        const shown = await versionOf(t, "posts", post, "en");
        // English is edited while bob reads it; the review state does not move.
        await saveIn(t, "posts", post, "en", { title: "Edited" });

        await expect(
          step(post, "clear", bob, { revision: 1, version: shown })
        ).rejects.toMatchObject({
          code: "CONFLICT",
          publicData: { reason: "stale", parts: ["en"] },
        });
        expect(await stateOf(t, en)).toMatchObject({
          stage: "legal",
          approval: null,
          revision: 1,
        });
        expect(await workflowEvents(t, "posts", post)).toEqual([]);
      });

      it("judges a language by its own content and the shared fields, not by another language's", async () => {
        t = await bootSteps(dialect);
        const dave = await person(t, "dave", [["update", "posts"]]);
        const post = await entry(t, "posts");
        const spanish = await versionOf(t, "posts", post, "es");
        const arabic = await versionOf(t, "posts", post, "ar");

        // A translated field changed in English only: Spanish is as it was shown.
        await saveIn(t, "posts", post, "en", { title: "Edited" });
        await step(post, "send", dave, { part: "es", version: spanish });
        expect((await stateOf(t, partOf("posts", post, "es")))?.stage).toBe(
          "legal"
        );

        // A shared field changed: every language shows it, so Arabic is not as it was shown.
        await saveIn(t, "posts", post, "en", { code: "X-1" });
        await expect(
          step(post, "send", dave, { part: "ar", version: arabic })
        ).rejects.toMatchObject({
          code: "CONFLICT",
          publicData: { reason: "stale", parts: ["ar"] },
        });
        expect(await stateOf(t, partOf("posts", post, "ar"))).toBeNull();
      });

      it("records the approval against the version the reviewer was shown, with a digest of that version's content", async () => {
        t = await bootSteps(dialect);
        const bob = await person(t, "bob", [["sign-off", "posts"]]);
        // A document as made, and one edited since it was made.
        const made = await entry(t, "posts");
        const edited = await entry(t, "posts");
        await saveIn(t, "posts", edited, "en", { title: "Different" });
        for (const post of [made, edited]) {
          await seedState(t, partOf("posts", post, "en"), "legal", {
            enteredBy: "alice",
            definitionHash: HASH,
          });
          await step(post, "clear", bob, { revision: 1 });
        }

        const approvals = [];
        for (const post of [made, edited]) {
          const approval = (await stateOf(t, partOf("posts", post, "en")))
            ?.approval;
          expect(approval).toMatchObject({
            versionNo: await shownVersion(t, "posts", post, "en"),
            by: "bob",
            digest: expect.stringMatching(/^[0-9a-f]{64}$/),
          });
          expect(approval?.at).toBeInstanceOf(Date);
          // The digest is of that version's content, as the history recorded it.
          expect(approval?.digest).toBe(
            approvalDigest(
              await snapshotOf(t, "posts", post, approval?.versionNo ?? 0),
              "collection"
            )
          );
          approvals.push(approval);
          // The event names the version approved.
          const [event] = await workflowEvents(t, "posts", post);
          expect(event).toMatchObject({
            kind: "workflow-approve",
            versionNo: approval?.versionNo,
          });
        }
        // The edited document's approval is of its later version, and other content.
        expect(approvals[1]?.versionNo).toBeGreaterThan(
          approvals[0]?.versionNo ?? Number.POSITIVE_INFINITY
        );
        expect(approvals[1]?.digest).not.toBe(approvals[0]?.digest);
      });

      it("names the part's version on a step's event", async () => {
        t = await bootSteps(dialect);
        const dave = await person(t, "dave", [["update", "posts"]]);
        const post = await entry(t, "posts");
        await saveIn(t, "posts", post, "en", { title: "Second" });

        await step(post, "send", dave);

        const [event] = await workflowEvents(t, "posts", post);
        expect(event?.versionNo).toBe(
          await shownVersion(t, "posts", post, "en")
        );
      });

      it("refuses approving all languages when English changed while the reviewer looked, approving none", async () => {
        t = await bootSteps(dialect);
        const bob = await person(t, "bob", [["sign-off", "posts"]]);
        const post = await entry(t, "posts");
        await saveIn(t, "posts", post, "es", { title: "Hola" });
        const en = partOf("posts", post, "en");
        const es = partOf("posts", post, "es");
        for (const part of [en, es]) {
          await seedState(t, part, "legal", {
            enteredBy: "alice",
            definitionHash: HASH,
          });
        }
        const seen = await seenNow(post, [
          ["en", 1],
          ["es", 1],
        ]);
        await saveIn(t, "posts", post, "en", { title: "Changed" });

        await expect(
          takeWorkflowStep(t.adapter, {
            document: {
              scopeKind: "collection",
              scopeSlug: "posts",
              entryId: post,
            },
            step: "clear",
            parts: "all",
            seen,
            caller: bob,
          })
        ).rejects.toMatchObject({
          code: "CONFLICT",
          publicData: { reason: "stale", parts: ["en"] },
        });
        // Spanish, as shown, is not approved on its own.
        for (const part of [en, es]) {
          expect(await stateOf(t, part)).toMatchObject({
            stage: "legal",
            approval: null,
            revision: 1,
          });
        }
        expect(await workflowEvents(t, "posts", post)).toEqual([]);
      });
    });

    describe("events", () => {
      it("records each step as its kind's event, with parts, stages, actor, comment and definition hash", async () => {
        t = await bootSteps(dialect);
        const grants = [
          ["sign-off", "posts"],
          ["update", "posts"],
        ] as const;
        const alice = await person(t, "alice", grants);
        const bob = await person(t, "bob", grants);
        const post = await entry(t, "posts");

        await step(post, "send", alice);
        await step(post, "clear", bob, { revision: 1 });
        await step(post, "bounce", bob, {
          revision: 2,
          comment: "Fix the intro",
        });
        await step(post, "send", alice, { revision: 3 });
        await step(post, "park", bob, {
          revision: 4,
          comment: "Legal is away",
        });

        const events = await workflowEvents(t, "posts", post);
        expect(
          events.map(event => ({
            kind: event.kind,
            parts: event.parts,
            fromState: event.fromState,
            toState: event.toState,
            actorKind: event.actorKind,
            actorId: event.actorId,
            note: event.note,
            step: event.payload?.step,
            definitionHash: event.definitionHash,
          }))
        ).toEqual(
          [
            ["workflow-submit", "writing", "legal", "alice", null, "send"],
            ["workflow-approve", "legal", "cleared", "bob", null, "clear"],
            [
              "workflow-request-changes",
              "cleared",
              "writing",
              "bob",
              "Fix the intro",
              "bounce",
            ],
            ["workflow-submit", "writing", "legal", "alice", null, "send"],
            ["workflow-move", "legal", "hold", "bob", "Legal is away", "park"],
          ].map(([kind, fromState, toState, actorId, note, name]) => ({
            kind,
            parts: ["en"],
            fromState,
            toState,
            actorKind: "person",
            actorId,
            note,
            step: name,
            definitionHash: HASH,
          }))
        );
      });
    });

    describe("default reviewer", () => {
      it("assigns the stage's default reviewer to a part entering it", async () => {
        t = await bootSteps(dialect);
        const dave = await person(t, "dave", [["update", "posts"]]);
        await person(t, "bob", [["sign-off", "posts"]]);
        await writeWorkflowSettings(
          stateDb(t),
          "editorial",
          { defaultReviewers: { legal: { kind: "user", id: "bob" } } },
          null,
          "admin"
        );
        const post = await entry(t, "posts");

        const sent = await step(post, "send", dave);

        expect(sent.reviewer).toEqual({ kind: "user", id: "bob" });
        expect(sent.skippedReviewer).toBeNull();
        expect(
          (await stateOf(t, partOf("posts", post, "en")))?.assignee
        ).toEqual({ kind: "user", id: "bob" });
      });

      it("skips a default reviewer who does not hold the stage's primary step, naming them in the event, and still takes the step", async () => {
        t = await bootSteps(dialect);
        const dave = await person(t, "dave", [["update", "posts"]]);
        // Carol may edit but not clear, so she cannot review Legal check.
        await person(t, "carol", [["update", "posts"]]);
        await writeWorkflowSettings(
          stateDb(t),
          "editorial",
          { defaultReviewers: { legal: { kind: "user", id: "carol" } } },
          null,
          "admin"
        );
        const post = await entry(t, "posts");

        const sent = await step(post, "send", dave);

        expect(sent.reviewer).toBeNull();
        expect(sent.skippedReviewer).toEqual({
          assignee: { kind: "user", id: "carol" },
          reason: "WORKFLOW_ASSIGNEE_LACKS_STEP",
        });
        expect(await stateOf(t, partOf("posts", post, "en"))).toMatchObject({
          stage: "legal",
          assignee: null,
        });
        const [event] = await workflowEvents(t, "posts", post);
        expect(event?.payload).toMatchObject({
          step: "send",
          skippedReviewer: {
            kind: "user",
            id: "carol",
            reason: "WORKFLOW_ASSIGNEE_LACKS_STEP",
          },
        });
      });
    });
  }
);
