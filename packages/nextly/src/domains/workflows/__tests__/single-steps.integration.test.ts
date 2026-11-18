/**
 * Steps are taken on a Single as on a collection's document, on every configured dialect: a
 * person who may edit the Single submits it, one who holds the stage's named action approves it,
 * and the approval is one the publish gate accepts, since its digest is taken under the Single's
 * own kind. A step is held to the Single's own gate: a person who may not edit it may not submit
 * it, and an API key may not approve it, whatever it holds.
 *
 * The plausible broken implementations keep refusing every Single, or judge a Single's step by a
 * collection's gate.
 *
 * Not covered here: a step digests a Single's approval under the Single's own kind, as the gate
 * does. The two kinds differ only on the owner column (`createdBy`), which a Single's writes strip
 * as a collection's do, so no Single a client can write tells the two digests apart today; the
 * kind is passed so they agree if that ever changes.
 */
import { afterEach, describe, expect, it } from "vitest";

import { container } from "../../../di/container";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type {
  PublishGate,
  PublishGateQuestion,
} from "../../collections/services/publish-gate";
import { readReviewState, type ReviewPart } from "../review-state-repository";
import {
  assignWorkflowParts,
  takeWorkflowStep,
  type WorkflowCaller,
} from "../steps";

import { apiKey, bootSteps, person, stateDb } from "./helpers/step-harness";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const app = (): TestNextly => {
  if (!current) throw new Error("not booted");
  return current;
};

const single = "banner";

/** The Single's document, written with `title` by trusted code: its id and the version it holds. */
async function bannerWith(title: string): Promise<{ id: string; rev: string }> {
  await app().nextly.updateSingle({
    slug: single as never,
    data: { title, _overwrite: true },
  } as never);
  const doc = (await app().nextly.findSingle({
    slug: single as never,
    status: "all",
  } as never)) as Record<string, unknown>;
  if (typeof doc.id !== "string" || typeof doc._rev !== "string") {
    throw new Error("the Banner has no id or version");
  }
  return { id: doc.id, rev: doc._rev };
}

const bannerPart = (id: string): ReviewPart => ({
  scopeKind: "single",
  scopeSlug: single,
  entryId: id,
  part: null,
});

/** Takes `step` on the Banner's document, as a caller that just read it. */
async function take(step: string, caller: WorkflowCaller) {
  const { id, rev } = await bannerWith("Hello");
  const state = await readReviewState(stateDb(app()), bannerPart(id));
  return takeWorkflowStep(app().adapter, {
    document: { scopeKind: "single", scopeSlug: single, entryId: id },
    step,
    parts: [null],
    seen: [{ part: null, revision: state?.revision ?? 0, version: rev }],
    caller,
  });
}

/** The Banner sent to Legal check by `sender`: its id and the part's review revision there. */
async function bannerInLegal(
  sender: WorkflowCaller
): Promise<{ id: string; revision: number }> {
  await take("send", sender);
  const { id } = await bannerWith("Hello");
  const state = await readReviewState(stateDb(app()), bannerPart(id));
  if (state?.stage !== "legal") throw new Error("the Banner is not in Legal");
  return { id, revision: state.revision };
}

/** Assigns the Banner's part, at `revision`, to the person `assignee`, as `caller`. */
function assignBanner(
  caller: WorkflowCaller,
  id: string,
  revision: number,
  assignee: string
) {
  return assignWorkflowParts(app().adapter, {
    caller,
    assignments: [
      {
        document: { scopeKind: "single", scopeSlug: single, entryId: id },
        part: null,
        revision,
        assignee: { kind: "user", id: assignee },
      },
    ],
  });
}

describe.each(getConfiguredTestDialects())(
  "steps on a Single (%s)",
  dialect => {
    it("submits and approves a Single, and the publish gate accepts the approval", async () => {
      current = await bootSteps(dialect);
      const alice = await person(app(), "alice", [["update", single]]);
      const rita = await person(app(), "rita", [["sign-off", single]]);

      await take("send", alice);
      await take("clear", rita);

      const { id } = await bannerWith("Hello");
      const state = await readReviewState(stateDb(app()), bannerPart(id));
      expect(state?.stage).toBe("cleared");
      expect(state?.approval?.by).toBe("rita");
      // The approval matches the content going live, as the gate compares it.
      const question: PublishGateQuestion = {
        scope: { kind: "single", slug: single },
        entryId: id,
        direction: "publish",
        parts: [{ kind: "shared" }],
        live: { languages: [], shared: false },
        caller: { kind: "trusted" },
      };
      const verdict = await app().adapter.transaction(tx =>
        container.get<PublishGate>("publishGate").judge(tx, question)
      );
      expect(verdict.refusals).toEqual([]);
    });

    it("assigns a Single's part to a person who may take its stage's primary step", async () => {
      current = await bootSteps(dialect);
      const alice = await person(app(), "alice", [["update", single]]);
      const dave = await person(app(), "dave", [["update", single]]);
      await person(app(), "rita", [["sign-off", single]]);
      const { id, revision } = await bannerInLegal(alice);

      await assignBanner(dave, id, revision, "rita");

      const state = await readReviewState(stateDb(app()), bannerPart(id));
      expect(state?.assignee).toEqual({ kind: "user", id: "rita" });
      expect(state?.revision).toBe(revision + 1);
    });

    it("refuses to assign a Single's part to a person who may not take its stage's primary step", async () => {
      current = await bootSteps(dialect);
      const alice = await person(app(), "alice", [["update", single]]);
      const dave = await person(app(), "dave", [["update", single]]);
      await person(app(), "paula", [["read", single]]);
      const { id, revision } = await bannerInLegal(alice);

      await expect(
        assignBanner(dave, id, revision, "paula")
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              code: "WORKFLOW_ASSIGNEE_LACKS_STEP",
            }),
          ],
        },
      });
      const state = await readReviewState(stateDb(app()), bannerPart(id));
      expect(state?.assignee).toBeNull();
      expect(state?.revision).toBe(revision);
    });

    it("refuses an assignment by a person who may not edit the Single", async () => {
      current = await bootSteps(dialect);
      const alice = await person(app(), "alice", [["update", single]]);
      const paula = await person(app(), "paula", [["read", single]]);
      await person(app(), "rita", [["sign-off", single]]);
      const { id, revision } = await bannerInLegal(alice);

      await expect(
        assignBanner(paula, id, revision, "rita")
      ).rejects.toMatchObject({ statusCode: 403 });
      const state = await readReviewState(stateDb(app()), bannerPart(id));
      expect(state?.assignee).toBeNull();
    });

    it("refuses a submit to a person who may not edit the Single", async () => {
      current = await bootSteps(dialect);
      const paula = await person(app(), "paula", [["read", single]]);

      await expect(take("send", paula)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("refuses an approval to an API key, whatever it holds", async () => {
      current = await bootSteps(dialect);
      const alice = await person(app(), "alice", [["update", single]]);
      await person(app(), "kim", []);
      await take("send", alice);

      await expect(
        take(
          "clear",
          apiKey("key-1", "kim", [
            ["sign-off", single],
            ["update", single],
          ])
        )
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  }
);
