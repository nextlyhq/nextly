/**
 * The notice that is meant to be mountable anywhere.
 *
 * Its value depends entirely on staying silent: a component intended to sit on
 * a release or a webhook page must add nothing when there is nothing wrong, and
 * must not fire for a retry that needs nobody. A notice that appears routinely
 * is one its reader learns to skip, which costs exactly the failure it exists
 * to surface.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import {
  JOB_DISPLAY_STATUSES,
  jobNeedsAttention,
  type JobListItem,
} from "@admin/types/jobs";

import { JobFailureSummary, jobsNeedingAttention } from "../JobFailureSummary";

const { useJobs, canFor } = vi.hoisted(() => ({
  useJobs: vi.fn(),
  canFor: vi.fn((_slug: string) => true),
}));

vi.mock("@admin/hooks/queries/useJobs", () => ({
  useJobs: (params: unknown, opts: unknown) => useJobs(params, opts),
  JOBS_POLL_INTERVAL_MS: 15_000,
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));

function job(overrides: Partial<JobListItem> = {}): JobListItem {
  return {
    id: "j1",
    slug: "releases:drain",
    state: "failed",
    status: "failed",
    attemptCount: 5,
    lastError: "boom",
    runAt: null,
    nextAttemptAt: null,
    createdAt: "2026-09-02T11:00:00.000Z",
    updatedAt: "2026-09-02T11:30:00.000Z",
    ...overrides,
  };
}

const holding = (items: JobListItem[], hasNext = false) => ({
  data: { items, meta: { hasNext } },
});

describe("jobsNeedingAttention", () => {
  it("agrees with the CORE predicate on every status it declares", () => {
    /*
     * A guard rather than a defect test, and worth saying so: the core answers
     * `failed` and nothing else today, so a reverted `=== "failed"` would still
     * pass this. What it pins is the day that changes — a second actionable
     * terminal state makes the two disagree, and this is what notices it, since
     * the exhaustive presentation map would compile either way.
     */
    for (const status of JOB_DISPLAY_STATUSES) {
      const rows = [job({ status })];
      expect(jobsNeedingAttention(rows).length, status).toBe(
        jobNeedsAttention(status) ? 1 : 0
      );
    }
    // The premise: the vocabulary really has both kinds in it, so agreeing
    // everywhere is not agreement over a single case.
    expect(JOB_DISPLAY_STATUSES.some(s => jobNeedsAttention(s))).toBe(true);
    expect(JOB_DISPLAY_STATUSES.some(s => !jobNeedsAttention(s))).toBe(true);
  });

  it("takes terminal failures and NOT retries", () => {
    const rows = [
      job({ id: "a", status: "failed" }),
      job({ id: "b", status: "retrying" }),
      job({ id: "c", status: "waiting" }),
      job({ id: "d", status: "succeeded" }),
    ];
    expect(
      jobsNeedingAttention(rows).map((row: JobListItem) => row.id)
    ).toEqual(["a"]);
  });

  it("restricts to one task when asked, and admits it otherwise", () => {
    const rows = [
      job({ id: "a", slug: "releases:drain" }),
      job({ id: "b", slug: "webhooks:drain" }),
    ];
    expect(
      jobsNeedingAttention(rows, "webhooks:drain").map(
        (row: JobListItem) => row.id
      )
    ).toEqual(["b"]);
    // The control: without the filter both are failures, so the case above
    // narrowed something rather than matching nothing for another reason.
    expect(jobsNeedingAttention(rows)).toHaveLength(2);
  });
});

describe("JobFailureSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canFor.mockImplementation(() => true);
  });

  it("names the task that failed", () => {
    useJobs.mockReturnValue(holding([job()]));
    render(<JobFailureSummary />);
    expect(screen.getByRole("status")).toHaveTextContent("releases:drain");
  });

  it("reports a count from a TRUNCATED window as a lower bound", () => {
    /*
     * `hasNext` says the server held more rows than this read asked for, so
     * failures may sit outside the window. A headline number stated flatly
     * would under-report them with the confidence of a total — the same lie the
     * screen's truncation notice exists to prevent, in the one place a reader
     * looks first.
     */
    useJobs.mockReturnValue(holding([job(), job({ id: "j2" })], true));
    render(<JobFailureSummary />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /At least 2 background jobs failed/i
    );
  });

  it("states a count PLAINLY when the window is complete", () => {
    // The control: without it the qualifier could be permanent, which would
    // make every count read as uncertain whether or not it is.
    useJobs.mockReturnValue(holding([job(), job({ id: "j2" })], false));
    render(<JobFailureSummary />);
    const alert = screen.getByRole("status");
    expect(alert).toHaveTextContent(/2 background jobs failed/i);
    expect(alert).not.toHaveTextContent(/At least/i);
  });

  it("renders NOTHING when every job is fine", () => {
    useJobs.mockReturnValue(holding([job({ status: "succeeded" })]));
    const { container } = render(<JobFailureSummary />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders NOTHING for a job that is merely retrying", () => {
    // The distinction the whole component turns on. A retry is the system
    // healing itself; a notice here would train its reader to ignore the one
    // that matters.
    useJobs.mockReturnValue(holding([job({ status: "retrying" })]));
    const { container } = render(<JobFailureSummary />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders NOTHING, and asks for nothing, without the permission", () => {
    canFor.mockImplementation(() => false);
    useJobs.mockReturnValue(holding([job()]));
    const { container } = render(<JobFailureSummary />);
    expect(container).toBeEmptyDOMElement();
    // The query is held rather than fired-and-discarded: a viewer who may not
    // read jobs must not issue a request that can only be refused.
    expect(useJobs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
  });

  it("shows only the named task's failure when scoped to one", () => {
    useJobs.mockReturnValue(
      holding([job({ id: "a", slug: "releases:drain" })])
    );
    const { container } = render(<JobFailureSummary slug="webhooks:drain" />);
    expect(container).toBeEmptyDOMElement();
  });
});
