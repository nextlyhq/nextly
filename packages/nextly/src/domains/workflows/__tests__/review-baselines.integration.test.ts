/**
 * The comparisons a review shows, "since submitted" and "since approved", resolved from the
 * versions workflows pinned for the part (`entered-review:<part>`, `approved:<part>`), through
 * the same function REST's diff route calls, on every configured dialect. A part with no such pin
 * is refused with its reason, as core's baselines are.
 */
import { afterEach, describe, expect, it } from "vitest";

import { getVersionDiffForDocument } from "../../../dispatcher/handlers/versions-methods";
import { NextlyError } from "../../../errors";
import type { CollectionsHandler } from "../../../services/collections-handler";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  approvedSlot,
  enteredReviewSlot,
  workflowPins,
} from "../workflow-pins";

import { bootSteps, entry, shownVersion } from "./helpers/step-harness";

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

const app = (): TestNextly => {
  if (!t) throw new Error("not booted");
  return t;
};

const superAdmin = { id: "tester", roles: ["super-admin"] };

/** A page saved three times after its create, and the version each save recorded. */
async function pageWithSaves(): Promise<{ id: string; saves: number[] }> {
  const id = await entry(app(), "pages");
  const saves: number[] = [];
  for (const title of ["First", "Second", "Third"]) {
    // An update names its version or says it overwrites; this one read none.
    const saved = await (
      app().getService("collectionsHandler") as CollectionsHandler
    ).updateEntry(
      { collectionName: "pages", entryId: id, overrideAccess: true },
      { title, _overwrite: true }
    );
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    saves.push(await shownVersion(app(), "pages", id, null));
  }
  return { id, saves };
}

/** Points the workflows slot `slot` of the page at `versionNo`, as a step does. */
async function pin(id: string, slot: string, versionNo: number) {
  await app().adapter.transaction(tx =>
    workflowPins.pin(tx, {
      ref: { scopeKind: "collection", scopeSlug: "pages", entryId: id },
      slot,
      versionNo,
    })
  );
}

function compare(id: string, args: { to: number; baseline: string }) {
  return getVersionDiffForDocument({
    scopeKind: "collection",
    slug: "pages",
    entryId: id,
    user: superAdmin,
    ...args,
  });
}

/** The refusal `promise` ends in: its code and message, as a reader is told them. */
async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err
  );
  expect(NextlyError.is(error)).toBe(true);
  const errors = (error as NextlyError).publicData as {
    errors?: Array<{ code: string; message: string }>;
  };
  return errors.errors?.[0];
}

describe.each(getConfiguredTestDialects())(
  "the review baselines (integration, %s)",
  dialect => {
    it("compares with the version the part entered review at, and the one last approved", async () => {
      t = await bootSteps(dialect);
      const { id, saves } = await pageWithSaves();
      const [submitted, approved, latest] = saves;
      await pin(id, enteredReviewSlot(null), submitted);
      await pin(id, approvedSlot(null), approved);

      expect(
        await compare(id, { to: latest, baseline: "since-submitted" })
      ).toMatchObject({
        from: submitted,
        to: latest,
        baseline: { name: "since-submitted", versionNo: submitted },
      });
      expect(
        await compare(id, { to: latest, baseline: "since-approved" })
      ).toMatchObject({
        from: approved,
        to: latest,
        baseline: { name: "since-approved", versionNo: approved },
      });
    });

    it("refuses a part never submitted or approved, and the pinned version itself, with why", async () => {
      t = await bootSteps(dialect);
      const { id, saves } = await pageWithSaves();
      const latest = saves[2];

      expect(
        await refusalOf(
          compare(id, { to: latest, baseline: "since-submitted" })
        )
      ).toEqual({
        path: "baseline",
        code: "NO_BASELINE",
        message:
          "This part has not been submitted for review since it was last published, so there is no version to compare with.",
      });
      expect(
        await refusalOf(compare(id, { to: latest, baseline: "since-approved" }))
      ).toEqual({
        path: "baseline",
        code: "NO_BASELINE",
        message:
          "This part has not been approved since it was last published, so there is no approved version to compare with.",
      });

      await pin(id, approvedSlot(null), latest);
      expect(
        await refusalOf(compare(id, { to: latest, baseline: "since-approved" }))
      ).toMatchObject({
        code: "NO_BASELINE",
        message: "This is the version approved, so nothing has changed since.",
      });
    });
  }
);
