/**
 * The two sentences that stop this screen from lying.
 *
 * A monitor's failure mode is not a wrong number, it is a confident absence.
 * If the window is truncated and says nothing, an operator reads fifty rows as
 * the whole story; if finished jobs are pruned and the screen does not say so,
 * a job that ran last week and was cleaned up is indistinguishable from one
 * that never ran. Both conclusions are wrong in the direction that stops
 * someone looking further, which is why they are asserted rather than trusted
 * to a reviewer's eye.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { JobListItem } from "@admin/types/jobs";

import { BackgroundJobsContent } from "../index";

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
    state: "done",
    status: "succeeded",
    attemptCount: 1,
    lastError: null,
    runAt: null,
    nextAttemptAt: null,
    createdAt: "2026-09-02T11:00:00.000Z",
    updatedAt: "2026-09-02T11:30:00.000Z",
    ...overrides,
  };
}

const window_ = (items: JobListItem[], hasNext: boolean) => ({
  data: { items, meta: { hasNext } },
  isLoading: false,
  isError: false,
  isPlaceholderData: false,
});

describe("what the background jobs screen admits to", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canFor.mockImplementation(() => true);
  });

  it("says the window is truncated when the server says there is more", () => {
    useJobs.mockReturnValue(window_([job()], true));
    render(<BackgroundJobsContent />);
    expect(
      screen.getByText(/More exist than this window holds/i)
    ).toBeVisible();
  });

  it("does NOT say so when the window is complete", () => {
    // The control: without it the notice could be permanent furniture, which
    // would tell every reader their list is incomplete whether or not it is.
    useJobs.mockReturnValue(window_([job()], false));
    render(<BackgroundJobsContent />);
    expect(screen.queryByText(/More exist than this window holds/i)).toBeNull();
  });

  it("states the retention window, so an absence is not read as never-ran", () => {
    useJobs.mockReturnValue(window_([job()], false));
    render(<BackgroundJobsContent />);
    expect(
      screen.getByText(/Finished jobs are removed after 7 days/i)
    ).toBeVisible();
  });

  it("refuses the whole screen without the permission, and asks for nothing", () => {
    canFor.mockImplementation(() => false);
    useJobs.mockReturnValue(window_([job()], false));
    render(<BackgroundJobsContent />);
    expect(
      screen.getByText(/do not have permission to view background jobs/i)
    ).toBeVisible();
    expect(useJobs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
  });

  it("shows a failed job's error text in the table", () => {
    useJobs.mockReturnValue(
      window_([job({ status: "failed", lastError: "smtp refused" })], false)
    );
    render(<BackgroundJobsContent />);
    // The premise for the notice above it: the row itself carries the reason.
    expect(screen.getByTitle("smtp refused")).toBeVisible();
  });
});
