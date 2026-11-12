/**
 * The files the retention pass frees, through a real jobs pass, on every
 * dialect: a file only the deleted submissions answered with is deleted;
 * one a newer submission still names is kept; one a document's upload field
 * uses is kept.
 */
import { randomUUID } from "node:crypto";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { runJobsPass } from "nextly";
import { defineCollection, text, upload } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { RETENTION_JOB } from "../handlers/retention";
import { formBuilder } from "../plugin";

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Core's mark that the media usage record is built, which a new site's is
 * from the start; until it is, every file reads as in use.
 */
const USAGE_RECORDED = "media.usage.recorded:3";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    plugins: [formBuilder().plugin],
    collections: [
      defineCollection({
        slug: "retentionposts",
        fields: [
          text({ name: "title" }),
          upload({ name: "cover", relationTo: "media" }),
        ],
      }),
    ],
  });
  const t = current;
  await (
    t.getService("metaService") as {
      set: (key: string, value: unknown) => Promise<void>;
    }
  ).set(USAGE_RECORDED, { rebuiltAt: new Date().toISOString() });

  const file = async (name: string) => {
    const id = randomUUID();
    const url = `/uploads/2026/11/${name}-${id.slice(0, 8)}.pdf`;
    await t.adapter.insert("media", {
      id,
      filename: url.slice("/uploads/".length),
      originalFilename: `${name}.pdf`,
      mimeType: "application/pdf",
      size: 1,
      url,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  };
  const exists = async (id: string) =>
    (
      await t.adapter.select<{ id: string }>("media", {
        where: { and: [{ column: "id", op: "=", value: id }] },
      })
    ).length === 1;

  const form = String(
    (
      await t.nextly.create({
        collection: "forms",
        data: {
          name: "Applications",
          slug: "applications",
          status: "published",
          fields: [
            { type: "text", name: "name", label: "Name" },
            { type: "file", name: "cv", label: "CV" },
          ],
          settings: { keepDays: 30 },
        },
      })
    ).item.id
  );

  /** A submission answering with `cv`, made `daysOld` days ago. */
  const submission = async (cv: string, daysOld: number) => {
    const id = String(
      (
        await t.nextly.create({
          collection: "form-submissions",
          data: {
            form,
            data: { name: "Ada", cv },
            submittedAt: new Date().toISOString(),
          },
        })
      ).item.id
    );
    await t.adapter.update(
      "dc_form_submissions",
      { created_at: new Date(Date.now() - daysOld * DAY_MS) },
      { and: [{ column: "id", op: "=", value: id }] }
    );
    return id;
  };

  const runRetention = async () => {
    await t.nextly.jobs.queue({ task: RETENTION_JOB, input: null } as never);
    await runJobsPass(t.adapter as never, t.getService("jobRegistry" as never));
  };

  return { t, file, exists, submission, runRetention };
}

describe.each(getConfiguredTestDialects())(
  "the files the retention pass frees (%s)",
  dialect => {
    it("deletes a file only its deleted submissions named, and keeps the rest", async () => {
      const { t, file, exists, submission, runRetention } = await boot(dialect);
      const only = await file("only");
      const shared = await file("shared");
      const used = await file("used");
      await t.nextly.create({
        collection: "retentionposts",
        data: { title: "Hello", cover: used },
      });

      await submission(only, 40);
      await submission(shared, 40);
      await submission(used, 40);
      // A newer submission still answers with the shared file.
      await submission(shared, 5);

      await runRetention();

      expect(await exists(only)).toBe(false);
      expect(await exists(shared)).toBe(true);
      expect(await exists(used)).toBe(true);
    }, 90_000);
  }
);
