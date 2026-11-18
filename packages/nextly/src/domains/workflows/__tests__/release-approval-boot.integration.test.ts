/**
 * A deploy that withdraws approvals, or attaches a workflow, stops a scheduled release holding a
 * document it leaves unapproved before the release's moment.
 *
 * Neither leaves an event of its own to signal from: a deploy's definition sweep may run in
 * another process (`nextly migrate`), and a workflow's attachment is recorded nowhere. So a
 * server's start checks every scheduled member of a collection or Single with a workflow
 * attached, after the sweep.
 *
 * A deploy is simulated by booting again on the first boot's adapter, and the test harness
 * releases the database a server-backed boot provisioned when the next boot starts: only SQLite
 * keeps one database across the two boots, as in the approval tests' deploy cases. What the start
 * checks, it reads and writes through the adapter, the same on every dialect.
 */
import { afterEach, describe, expect, it } from "vitest";

import { clearServices } from "../../../di/register";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { defineWorkflow } from "../define-workflow";

import {
  approve,
  arrange,
  bootApprovals,
  doc,
  hardCodes,
  LATER,
  publishPage,
  releaseState,
  saveBanner,
  stoppedNotices,
} from "./helpers/release-approval-harness";
import { editorial } from "./helpers/step-workflows";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Boots, or boots again on `previous`'s database as a deploy does. */
async function boot(
  dialect: TestDialect,
  options: Parameters<typeof bootApprovals>[1] = {}
): Promise<TestNextly> {
  if (current !== undefined) clearServices();
  current = await bootApprovals(dialect, { seedPublic: false, ...options });
  return current;
}

/** `editorial` with a stage before writing, and approvals not kept across the change. */
const withIntake = defineWorkflow({
  slug: "editorial",
  label: "Editorial",
  stages: [{ name: "intake", label: "Intake" }, ...editorial.stages],
  steps: [
    {
      name: "start",
      label: "Start",
      kind: "move",
      from: "intake",
      to: "writing",
    },
    ...editorial.steps.map(step => ({
      ...step,
      permission: step.permission ?? undefined,
    })),
  ],
});

describe.each(getConfiguredTestDialects().filter(d => d === "sqlite"))(
  "a deploy stops a release it leaves unapproved (%s)",
  dialect => {
    it("when a change of definition withdraws its member's approval", async () => {
      const first = await boot(dialect);
      const page = await doc(first, "pages");
      await approve(first, "pages", page);
      const arranged = await arrange(first, [publishPage(page)], LATER);
      expect(await hardCodes(first, arranged.releaseId)).toEqual([]);

      const t = await boot(dialect, {
        workflow: withIntake,
        adapter: first.adapter,
      });

      expect(await releaseState(t, arranged.releaseId)).toBe("blocked");
      expect(await stoppedNotices(t, arranged)).toBe(1);
      expect(await hardCodes(t, arranged.releaseId)).toEqual(["NOT_APPROVED"]);
    });

    it("when a workflow is first attached to the collection of its member", async () => {
      const first = await boot(dialect, { workflow: null });
      const page = await doc(first, "pages");
      const arranged = await arrange(first, [publishPage(page)], LATER);
      expect(await hardCodes(first, arranged.releaseId)).toEqual([]);

      const t = await boot(dialect, { adapter: first.adapter });

      expect(await releaseState(t, arranged.releaseId)).toBe("blocked");
      expect(await stoppedNotices(t, arranged)).toBe(1);
      expect(await hardCodes(t, arranged.releaseId)).toEqual(["NOT_APPROVED"]);
    });

    it("when a workflow is first attached to the Single it holds", async () => {
      const first = await boot(dialect, { workflow: null });
      const banner = await saveBanner(first, "Unreviewed");
      const arranged = await arrange(
        first,
        [
          {
            scopeKind: "single",
            scopeSlug: "banner",
            entryId: banner,
            action: "publish",
          },
        ],
        LATER
      );
      expect(await hardCodes(first, arranged.releaseId)).toEqual([]);

      // The publish gate does not judge a Single yet, so a Single is judged by the stand-in.
      const t = await boot(dialect, { adapter: first.adapter, standIn: true });

      expect(await releaseState(t, arranged.releaseId)).toBe("blocked");
      expect(await stoppedNotices(t, arranged)).toBe(1);
      expect(await hardCodes(t, arranged.releaseId)).toEqual(["NOT_APPROVED"]);
    });

    it("and leaves one whose member is still approved scheduled", async () => {
      // The control: a start with nothing changed checks the release and finds it ready.
      const first = await boot(dialect);
      const page = await doc(first, "pages");
      await approve(first, "pages", page);
      const arranged = await arrange(first, [publishPage(page)], LATER);

      const t = await boot(dialect, { adapter: first.adapter });

      expect(await releaseState(t, arranged.releaseId)).toBe("scheduled");
      expect(await stoppedNotices(t, arranged)).toBe(0);
    });
  }
);
