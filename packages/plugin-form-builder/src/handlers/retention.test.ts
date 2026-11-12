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
