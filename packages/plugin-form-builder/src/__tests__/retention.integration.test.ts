/**
 * The nightly retention pass, through a real jobs pass, on every dialect: a
 * form that keeps submissions for a while loses those older than that, and
 * keeps the newer ones; a form that keeps them forever keeps every answer;
 * spam older than 30 days goes whatever the form's setting, and newer spam
 * stays.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { runJobsPass } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { RETENTION_JOB } from "../handlers/retention";
import { formBuilder } from "../plugin";

const DAY_MS = 24 * 60 * 60 * 1000;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    plugins: [formBuilder().plugin],
  });
  const t = current;

  const form = async (slug: string, settings: Record<string, unknown>) =>
    String(
      (
        await t.nextly.create({
          collection: "forms",
          data: {
            name: slug,
            slug,
            status: "published",
            fields: [{ type: "text", name: "message", label: "Message" }],
            settings,
          },
        })
      ).item.id
    );

  /** A submission to `formId`, made `daysOld` days ago. */
  const submission = async (
    formId: string,
    daysOld: number,
    status = "new"
  ) => {
    const id = String(
      (
        await t.nextly.create({
          collection: "form-submissions",
          data: {
            form: formId,
            data: { message: `${daysOld} days` },
            status,
            submittedAt: new Date().toISOString(),
          },
        })
      ).item.id
    );
    // Aged as the system records it: the pass reads `createdAt`.
    await t.adapter.update(
      "dc_form_submissions",
      { created_at: new Date(Date.now() - daysOld * DAY_MS) },
      { and: [{ column: "id", op: "=", value: id }] }
    );
    return id;
  };

  const remaining = async () =>
    (await t.nextly.find({ collection: "form-submissions", limit: 100 })).items
      .map(item => String((item as { id: unknown }).id))
      .sort();

  /** The retention job, queued as its schedule queues it, and one pass. */
  const runRetention = async () => {
    await t.nextly.jobs.queue({ task: RETENTION_JOB, input: null } as never);
    await runJobsPass(t.adapter as never, t.getService("jobRegistry" as never));
  };

  return { t, form, submission, remaining, runRetention };
}

describe.each(getConfiguredTestDialects())(
  "the retention pass (%s)",
  dialect => {
    it("deletes what each form no longer keeps, and spam after 30 days", async () => {
      const { form, submission, remaining, runRetention } = await boot(dialect);
      const month = await form("kept-30-days", { keepDays: 30 });
      const forever = await form("kept-forever", {});

      const aged = await submission(month, 40);
      const fresh = await submission(month, 10);
      const oldForever = await submission(forever, 400);
      const oldSpam = await submission(forever, 31, "spam");
      const newSpam = await submission(forever, 10, "spam");

      await runRetention();

      expect(await remaining()).toEqual([fresh, oldForever, newSpam].sort());
      expect(await remaining()).not.toContain(aged);
      expect(await remaining()).not.toContain(oldSpam);
    }, 60_000);

    it("keeps everything once a form is set back to Never", async () => {
      const { t, form, submission, remaining, runRetention } =
        await boot(dialect);
      const month = await form("was-30-days", { keepDays: 30 });
      const aged = await submission(month, 40);
      // As the builder saves Never: the settings with no keep period.
      await t.nextly.update({
        collection: "forms",
        id: month,
        data: { settings: { submitButtonText: "Send" }, _overwrite: true },
      });

      await runRetention();

      expect(await remaining()).toEqual([aged]);
    }, 60_000);
  }
);
