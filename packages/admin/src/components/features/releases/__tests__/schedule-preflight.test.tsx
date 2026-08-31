/**
 * Asking what would stop a release, before committing it to an instant.
 *
 * The server refuses a release whose members cannot run, so this is not the
 * only guard — it is the one that can say WHICH documents. "Fix the documents
 * blocking it" is not an instruction anybody can follow without that list, and
 * the refusal cannot carry it.
 *
 * @module components/features/releases/__tests__/schedule-preflight.test
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { fireEvent, render, screen } from "@admin/__tests__/utils";

const { blockersMock, scheduleMock } = vi.hoisted(() => ({
  blockersMock: vi.fn(),
  scheduleMock: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useReleases", () => ({
  useReleaseBlockers: (...args: unknown[]) => blockersMock(...args),
  useScheduleRelease: () => ({
    mutate: scheduleMock,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

import { ScheduleReleaseDialog } from "../ScheduleReleaseDialog";

const RELEASE = {
  id: "r1",
  title: "Autumn launch",
  description: null,
  scheduledAt: null,
  timezone: null,
  state: "draft",
  publishedAt: null,
} as never;

const BLOCKER = {
  memberId: "m1",
  reason: "AUTHOR_GONE",
  action: "publish",
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "e1",
};

function answer(over: Record<string, unknown> = {}) {
  return { data: { items: [] }, isPending: false, isError: false, ...over };
}

const submit = () =>
  screen.getByRole("button", {
    name: /schedule release/i,
  }) as HTMLButtonElement;

/**
 * Give the dialog a valid instant, so the submit button's state is decided by
 * the PREFLIGHT rather than by an empty form.
 *
 * Without this every assertion below passes on an unmodified component: the
 * button starts disabled because no date has been typed, which is a state that
 * predates the mechanism under test entirely. Found by breaking the preflight
 * and watching all four cases stay green.
 */
function withAnInstant() {
  fireEvent.change(screen.getByLabelText(/date and time/i), {
    target: { value: "2027-01-15T09:00" },
  });
}

beforeEach(() => {
  blockersMock.mockReset();
  scheduleMock.mockReset();
  blockersMock.mockReturnValue(answer());
});

describe("the schedule preflight", () => {
  it("lets a clean release through, which is the control", async () => {
    // Without this, every case below is satisfied by a dialog that refuses
    // everything — including the empty-form state they would otherwise be
    // measuring rather than the preflight.
    render(
      <ScheduleReleaseDialog release={RELEASE} open onOpenChange={() => {}} />
    );
    withAnInstant();
    expect(submit().disabled).toBe(false);
  });

  it("NAMES the documents that would stop the release", async () => {
    // A count is not actionable. The whole reason this asks before scheduling
    // is that the server's refusal cannot say which documents.
    blockersMock.mockReturnValue(answer({ data: { items: [BLOCKER] } }));
    render(
      <ScheduleReleaseDialog release={RELEASE} open onOpenChange={() => {}} />
    );
    withAnInstant();
    expect(screen.getByText(/one document would stop/i)).toBeTruthy();
    expect(screen.getByText("posts / e1")).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  it("refuses to schedule while the check has FAILED", async () => {
    // Unknown is not clean. A preflight that lets the write through on a failed
    // lookup is not a preflight.
    blockersMock.mockReturnValue(answer({ isError: true, data: undefined }));
    render(
      <ScheduleReleaseDialog release={RELEASE} open onOpenChange={() => {}} />
    );
    withAnInstant();
    expect(screen.getByText(/could not be checked/i)).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  it("refuses while the check is still running", async () => {
    // The third state. Pending is neither clean nor blocked, and folding it
    // into clean is how a release with a dead author gets scheduled anyway.
    blockersMock.mockReturnValue(answer({ isPending: true, data: undefined }));
    render(
      <ScheduleReleaseDialog release={RELEASE} open onOpenChange={() => {}} />
    );
    withAnInstant();
    expect(submit().disabled).toBe(true);
  });

  it("does not ask at all while the dialog is closed", async () => {
    // The answer costs an identity lookup over every member. Asking on every
    // detail render to say "nothing is wrong" is what this route exists to
    // avoid.
    render(
      <ScheduleReleaseDialog
        release={RELEASE}
        open={false}
        onOpenChange={() => {}}
      />
    );
    expect(blockersMock).toHaveBeenCalledWith("r1", false);
  });
});
