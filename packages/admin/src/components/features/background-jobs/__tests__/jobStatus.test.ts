/**
 * The status vocabulary, and the one distinction that must not be collapsed.
 *
 * A retrying job LOOKS like a failure in the log and is not one: the attempt
 * failed, another is scheduled, and nobody needs to act. Presenting it in the
 * same red as a terminal failure is the documented common mistake in queue
 * tooling — it raises an alarm for a self-healing job, and buries the dead one
 * among transient noise. So `failed` is the only destructive pill, and that is
 * asserted rather than left to a reviewer to notice.
 */
import { describe, expect, it } from "vitest";

import { JOB_DISPLAY_STATUSES } from "@admin/types/jobs";

import { dueAt } from "../JobsTable";
import { formatJobAge, jobStatusPresentation } from "../jobStatus";

describe("job status presentation", () => {
  it("gives every status the core declares a label", () => {
    // Iterated over the CORE's list, not a copy: a status added there and not
    // given a presentation here fails this test as well as the compiler.
    for (const status of JOB_DISPLAY_STATUSES) {
      const presentation = jobStatusPresentation(status);
      expect(presentation.label, status).not.toBe("");
      expect(presentation.label, status).not.toBe(status);
    }
    // The premise: the list is real and non-trivial.
    expect(JOB_DISPLAY_STATUSES.length).toBeGreaterThan(3);
  });

  it("reserves the alarming variant for the TERMINAL failure only", () => {
    expect(jobStatusPresentation("failed").variant).toBe("destructive");
    expect(jobStatusPresentation("retrying").variant).not.toBe("destructive");
    expect(jobStatusPresentation("succeeded").variant).toBe("success");
  });

  it("shows an unfamiliar status verbatim rather than nothing", () => {
    // A server ahead of this build must degrade to "unfamiliar", not "blank".
    const presentation = jobStatusPresentation("quarantined");
    expect(presentation.label).toBe("quarantined");
    expect(presentation.variant).toBe("default");
  });

  it("does not treat an inherited object property as a known status", () => {
    // `toString` is on every object's prototype, so a lookup that asks `in` or
    // reads the map directly would resolve it and render a function.
    expect(jobStatusPresentation("toString").label).toBe("toString");
    expect(jobStatusPresentation("constructor").label).toBe("constructor");
  });
});

describe("job age", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");

  it("reads in the past for a past instant and the future for a due one", () => {
    expect(formatJobAge("2026-09-02T11:56:00.000Z", now)).toBe("4 minutes ago");
    // A scheduled retry is in the future; "in 5 minutes" is the answer an
    // operator wants, and "-5 minutes ago" is the one a subtraction gives.
    expect(formatJobAge("2026-09-02T12:05:00.000Z", now)).toBe("in 5 minutes");
  });

  it("singularises, so nothing reads '1 minutes ago'", () => {
    expect(formatJobAge("2026-09-02T11:59:00.000Z", now)).toBe("1 minute ago");
  });

  it("climbs to the coarsest true unit", () => {
    expect(formatJobAge("2026-09-02T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(formatJobAge("2026-08-30T12:00:00.000Z", now)).toBe("3 days ago");
  });

  it("returns an unparseable value unchanged rather than NaN", () => {
    expect(formatJobAge("not-a-date", now)).toBe("not-a-date");
  });
});

describe("when a job is due", () => {
  /*
   * `runAt` is the SCHEDULE and `nextAttemptAt` is the RETRY. A job scheduled
   * for a future instant and never attempted carries the first and not the
   * second, so reading only the retry showed a dash for exactly the case this
   * screen exists to answer: a release scheduled to publish.
   */
  it("uses the schedule when nothing has been retried", () => {
    expect(
      dueAt({ runAt: "2026-09-03T09:00:00.000Z", nextAttemptAt: null } as never)
    ).toBe("2026-09-03T09:00:00.000Z");
  });

  it("prefers the retry, which is the later decision", () => {
    // A job that failed an attempt runs at its backoff, not at the time it was
    // originally scheduled for.
    expect(
      dueAt({
        runAt: "2026-09-03T09:00:00.000Z",
        nextAttemptAt: "2026-09-03T09:05:00.000Z",
      } as never)
    ).toBe("2026-09-03T09:05:00.000Z");
  });

  it("is null only when neither is set", () => {
    // The control: a job with no schedule and no retry is due now, and the
    // column has nothing to say. Without this the two cases above would pass
    // against a function that always returned its first argument.
    expect(dueAt({ runAt: null, nextAttemptAt: null } as never)).toBeNull();
  });
});
