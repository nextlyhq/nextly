/**
 * The retention pass's bookkeeping: a pass the deadline stops queues its
 * continuation rather than leaving the rest for the next night, one that
 * finishes queues nothing, and the plugin declares the nightly schedule that
 * starts it.
 */
import { describe, expect, it, vi } from "vitest";

import { formBuilder } from "../plugin";

import {
  RETENTION_JOB,
  RETENTION_SCHEDULE,
  type RetentionDeps,
  retentionCursorOf,
  runRetention,
} from "./retention";

/** Deps over one spam submission past keeping and no forms. */
function deps() {
  const deleted: string[] = [];
  const queue = vi.fn(async () => ({ id: "job", deduped: false }));
  const listEntries = vi.fn(async (slug: string) => ({
    data:
      slug === "form-submissions" && !deleted.includes("old-spam")
        ? [{ id: "old-spam" }]
        : [],
  }));
  const deleteEntry = vi.fn(async (_slug: string, id: string) => {
    deleted.push(id);
  });
  return {
    deleted,
    queue,
    value: {
      collections: { listEntries, deleteEntry },
      jobs: { queue },
      formsSlug: "forms",
      submissionsSlug: "form-submissions",
    } as unknown as RetentionDeps,
  };
}

describe("the retention pass", () => {
  it("queues its continuation when the deadline stops it", async () => {
    const { deleted, queue, value } = deps();
    expect(await runRetention(value, new Date(0))).toBe("continued");
    expect(deleted).toEqual([]);
    expect(queue).toHaveBeenCalledWith({ task: RETENTION_JOB, input: null });
  });

  it("queues nothing when it finishes", async () => {
    const { deleted, queue, value } = deps();
    const later = new Date(Date.now() + 60_000);
    expect(await runRetention(value, later)).toBe("done");
    expect(deleted).toEqual(["old-spam"]);
    expect(queue).not.toHaveBeenCalled();
  });

  it("carries on after the forms it finished, not from the first", async () => {
    // Two forms keeping submissions 30 days, each with one past keeping.
    const deleted: string[] = [];
    const queue = vi.fn(async () => ({ id: "job", deduped: false }));
    const formsAsked: unknown[] = [];
    const forms = [
      { id: "f1", settings: { keepDays: 30 } },
      { id: "f2", settings: { keepDays: 30 } },
    ];
    const deadline = new Date(Date.now() + 60_000);
    const value = {
      collections: {
        listEntries: vi.fn(
          async (
            slug: string,
            options: { where?: Record<string, unknown> }
          ) => {
            if (slug === "forms") {
              formsAsked.push(options.where);
              const after = (options.where?.id as { greater_than?: string })
                ?.greater_than;
              return {
                data: forms.filter(
                  form => after === undefined || form.id > after
                ),
              };
            }
            const form = (options.where?.form as { equals?: string })?.equals;
            const id = `${form}-old`;
            return { data: form && !deleted.includes(id) ? [{ id }] : [] };
          }
        ),
        deleteEntry: vi.fn(async (_slug: string, id: string) => {
          deleted.push(id);
          // The run's time is up once the first form's is deleted.
          deadline.setTime(0);
        }),
      },
      jobs: { queue },
      formsSlug: "forms",
      submissionsSlug: "form-submissions",
    } as unknown as RetentionDeps;

    expect(await runRetention(value, deadline, { spamDone: true })).toBe(
      "continued"
    );
    expect(deleted).toEqual(["f1-old"]);
    expect(queue).toHaveBeenCalledWith({
      task: RETENTION_JOB,
      input: { spamDone: true, afterForm: "f1" },
    });

    // The continuation starts past f1.
    deadline.setTime(Date.now() + 60_000);
    expect(
      await runRetention(value, deadline, { spamDone: true, afterForm: "f1" })
    ).toBe("done");
    expect(formsAsked.at(-1)).toEqual({ id: { greater_than: "f1" } });
    expect(deleted).toEqual(["f1-old", "f2-old"]);
  });

  it("reads a continuation's cursor from its job input", () => {
    expect(retentionCursorOf(null)).toEqual({});
    expect(retentionCursorOf({ spamDone: true, afterForm: "f1" })).toEqual({
      spamDone: true,
      afterForm: "f1",
    });
    expect(retentionCursorOf({ spamDone: "yes", afterForm: 3 })).toEqual({});
  });

  it("is started each night by the plugin's schedule", () => {
    const { plugin } = formBuilder();
    expect(plugin.contributes?.schedules).toContainEqual(RETENTION_SCHEDULE);
    expect(
      plugin.contributes?.jobs?.some(job => job.slug === RETENTION_JOB)
    ).toBe(true);
    expect(RETENTION_SCHEDULE).toMatchObject({
      cron: "@daily",
      job: RETENTION_JOB,
    });
  });
});
