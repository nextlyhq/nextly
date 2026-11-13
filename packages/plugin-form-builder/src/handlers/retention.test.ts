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

  it("carries the uploads' sweep on past the files it kept, into the unclaimed ones", async () => {
    const queue = vi.fn(async () => ({ id: "job", deduped: false }));
    const deadline = new Date(Date.now() + 60_000);
    // Three released uploads whose files the site still uses, so each is
    // kept, and checked again only by a later night's pass.
    const released = ["u1", "u2", "u3"].map(id => ({
      id,
      media: `m-${id}`,
      releasedAt: new Date(),
    }));
    const asked: Array<Record<string, unknown>> = [];
    const checked: string[] = [];
    const uploads = {
      own: {
        listEntries: vi.fn(
          async (
            _slug: string,
            options: { where: Record<string, unknown> }
          ) => {
            asked.push(options.where);
            if (!("releasedAt" in options.where)) return { data: [] };
            if (
              (options.where.releasedAt as { exists?: boolean }).exists !== true
            ) {
              return { data: [] };
            }
            const after = (options.where.id as { greater_than?: string })
              ?.greater_than;
            return {
              data: released.filter(
                upload => after === undefined || upload.id > after
              ),
            };
          }
        ),
        count: vi.fn(async () => 0),
      },
      collections: { deleteEntry: vi.fn() },
      media: {
        findById: vi.fn(async () => ({})),
        isInUse: vi.fn(async (mediaId: string) => {
          checked.push(mediaId);
          // The run's time is up once the second file is checked.
          if (checked.length === 2) deadline.setTime(0);
          return true;
        }),
        delete: vi.fn(),
      },
      uploadsSlug: "form-uploads",
    };
    const value = {
      collections: {
        listEntries: vi.fn(async () => ({ data: [] })),
        deleteEntry: vi.fn(),
      },
      jobs: { queue },
      formsSlug: "forms",
      submissionsSlug: "form-submissions",
      uploads,
    } as unknown as RetentionDeps;
    const start = { spamDone: true, formsDone: true };

    expect(await runRetention(value, deadline, start)).toBe("continued");
    expect(checked).toEqual(["m-u1", "m-u2"]);
    expect(queue).toHaveBeenCalledWith({
      task: RETENTION_JOB,
      input: { spamDone: true, formsDone: true, afterUpload: "u2" },
    });

    // The continuation starts past u2, checks u3 alone, and goes on to the
    // uploads nobody claimed.
    deadline.setTime(Date.now() + 60_000);
    asked.length = 0;
    expect(
      await runRetention(
        value,
        deadline,
        retentionCursorOf({
          ...start,
          afterUpload: "u2",
        })
      )
    ).toBe("done");
    expect(checked).toEqual(["m-u1", "m-u2", "m-u3"]);
    expect(asked[0]).toMatchObject({ id: { greater_than: "u2" } });
    expect(asked.some(where => "createdAt" in where)).toBe(true);
    expect(uploads.media.delete).not.toHaveBeenCalled();
  });

  it("reads a continuation's cursor from its job input", () => {
    expect(retentionCursorOf(null)).toEqual({});
    expect(retentionCursorOf({ spamDone: true, afterForm: "f1" })).toEqual({
      spamDone: true,
      afterForm: "f1",
    });
    expect(
      retentionCursorOf({
        spamDone: true,
        formsDone: true,
        releasedDone: true,
        afterUpload: "u2",
      })
    ).toEqual({
      spamDone: true,
      formsDone: true,
      releasedDone: true,
      afterUpload: "u2",
    });
    expect(
      retentionCursorOf({ spamDone: "yes", afterForm: 3, afterUpload: 4 })
    ).toEqual({});
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
