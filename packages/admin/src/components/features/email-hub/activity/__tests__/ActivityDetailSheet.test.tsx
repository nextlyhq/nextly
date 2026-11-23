// @vitest-environment jsdom
/**
 * The detail sheet: its state first, then its details and every attempt;
 * "Fix template" only for a queued email whose failure came from its
 * template, and only where the reader may open that template; a queued
 * email's Retry and Cancel only for a reader who may do them, only while the
 * server allows them, Cancel only once confirmed; and the whole screen on a
 * phone.
 *
 * @module components/features/email-hub/activity/__tests__/ActivityDetailSheet.test
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useActivityDetail,
  useQueuedEmailAction,
  type ActivityDetail,
} from "@admin/hooks/queries/useEmailActivity";
import type {
  DeliveryAttempt,
  QueuedEmailDetail,
} from "@admin/services/emailActivityApi";

import { ActivityDetailSheet } from "../ActivityDetailSheet";

vi.mock("@admin/hooks/queries/useEmailActivity", () => ({
  useActivityDetail: vi.fn(),
  useQueuedEmailAction: vi.fn(),
}));
const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast: { success: toastSuccess },
}));

/** What Retry or Cancel asked, and how the server answers it. */
const mutate = vi.fn();
let answer: { ok: boolean; message: string } = { ok: true, message: "Done." };

beforeEach(() => {
  mutate.mockReset();
  toastSuccess.mockReset();
  answer = { ok: true, message: "Done." };
  mutate.mockImplementation(
    (
      _vars: unknown,
      on: {
        onSuccess: (a: { message: string }) => void;
        onError: (e: Error) => void;
      }
    ) =>
      answer.ok
        ? on.onSuccess({ message: answer.message })
        : on.onError(new Error(answer.message))
  );
  vi.mocked(useQueuedEmailAction).mockReturnValue({
    mutate,
    isPending: false,
  } as unknown as ReturnType<typeof useQueuedEmailAction>);
});

/** A reader who may manage email deliveries, and one who may only read them. */
const MANAGES = { retry: true, cancel: true };
const READS = { retry: false, cancel: false };
vi.mock("@admin/hooks/useAdminDateFormatter", () => ({
  formatDateWithAdminTimezone: (value: string) => `AT ${value}`,
}));

const NOW = new Date("2026-11-16T12:00:00.000Z");

const ATTEMPT: DeliveryAttempt = {
  id: "d1",
  createdAt: "2026-11-16T11:00:00.000Z",
  outcome: "failed",
  recipientKind: "to",
  provider: { id: null, type: "smtp", origin: "code" },
  failureKind: "refused",
  failureStatus: null,
  failureReason: "The Reply-To set by the template wasn't a valid address.",
  templateVersion: { owner: "site", overridden: false, digest: "7aa2c510ab" },
  erased: false,
};

function queuedDetail(over: Partial<QueuedEmailDetail> = {}): ActivityDetail {
  return {
    source: "queued",
    detail: {
      id: "q1",
      createdAt: "2026-11-16T11:00:00.000Z",
      updatedAt: "2026-11-16T11:00:00.000Z",
      settledAt: "2026-11-16T11:00:01.000Z",
      state: "failed",
      attempts: 1,
      nextAttemptAt: null,
      lastFailure: {
        retryable: false,
        reason: "The Reply-To set by the template wasn't a valid address.",
      },
      messageHeld: true,
      templateSlug: "contact-notify-team",
      queuedBy: "plugin:form-builder",
      templateCaused: true,
      templateVersion: ATTEMPT.templateVersion,
      // A template failure happens before any provider is asked, so the
      // server answers it with no attempt at all.
      timeline: [],
      timelineTruncated: false,
      ...over,
    },
  };
}

function showing(data: ActivityDetail) {
  vi.mocked(useActivityDetail).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useActivityDetail>);
}

function renderSheet(
  fixTemplateHref: (slug: string) => string | undefined = slug =>
    `/edit/${slug}`,
  onClose: () => void = vi.fn(),
  queuedActions: { retry: boolean; cancel: boolean } = READS
) {
  render(
    <ActivityDetailSheet
      open={{ source: "queued", id: "q1" }}
      onClose={onClose}
      names={{ template: () => undefined, provider: () => undefined }}
      now={NOW}
      fixTemplateHref={fixTemplateHref}
      queuedActions={queuedActions}
    />
  );
}

describe("the detail sheet", () => {
  it("puts a template's failure first as the template's, never the provider's", () => {
    showing(queuedDetail());
    renderSheet();
    const state = screen.getByRole("status");
    expect(state.textContent).toContain(
      "Failed: the template couldn’t be used"
    );
    expect(state.textContent).not.toMatch(/provider/i);
    expect(state.textContent).toContain("wasn't a valid address");
    expect(state.textContent).toMatch(/Fix the template/);
    expect(screen.getByText("The site’s own template")).toBeTruthy();
    expect(screen.getByText("Version 7aa2c510")).toBeTruthy();
    expect(screen.getByText("The form-builder plugin")).toBeTruthy();
    expect(screen.getByText(/No delivery is on record/)).toBeTruthy();
  });

  it("offers no Fix template once a later attempt has sent it", () => {
    // The template marker stays on the row after a retry succeeds.
    showing(queuedDetail({ state: "sent", lastFailure: null }));
    renderSheet();
    expect(screen.getByRole("status").textContent).toContain("Sent");
    expect(screen.queryByRole("link", { name: "Fix template" })).toBeNull();
  });

  it("offers Fix template while a template failure is still retrying", () => {
    showing(queuedDetail({ state: "retrying" }));
    renderSheet();
    expect(screen.getByRole("link", { name: "Fix template" })).toBeTruthy();
  });

  it("never calls a retrying email with attempts behind it unsent, when its version was pruned", () => {
    showing(
      queuedDetail({
        state: "retrying",
        attempts: 2,
        templateCaused: false,
        templateVersion: null,
        timeline: [],
      })
    );
    renderSheet();
    expect(screen.queryByText("Not sent yet")).toBeNull();
    expect(screen.getByText("No version recorded")).toBeTruthy();
  });

  it("says a queued email that hasn't been tried has no attempt yet, and no version yet", () => {
    showing(
      queuedDetail({
        state: "waiting",
        attempts: 0,
        lastFailure: null,
        templateCaused: false,
        templateVersion: null,
      })
    );
    renderSheet();
    expect(screen.getByText("No attempt yet.")).toBeTruthy();
    expect(screen.getByText("Not sent yet")).toBeTruthy();
  });

  it("names each attempt's provider answer, after the state", () => {
    showing(queuedDetail({ templateCaused: false, timeline: [ATTEMPT] }));
    renderSheet();
    expect(screen.getByRole("status").textContent).toContain(
      "Failed: the provider refused it"
    );
    const attempts = screen.getByRole("region", { name: "Attempts" });
    expect(attempts.textContent).toContain("smtp (in code) · To · refused");
  });

  it("names each attempt's provider as the details do: a stored one by name, any other by where it came from", () => {
    showing(
      queuedDetail({
        templateCaused: false,
        timeline: [
          {
            ...ATTEMPT,
            id: "a1",
            provider: { id: "p1", type: "smtp", origin: "stored" },
          },
          {
            ...ATTEMPT,
            id: "a2",
            provider: { id: null, type: "smtp", origin: "deleted" },
          },
        ],
      })
    );
    render(
      <ActivityDetailSheet
        open={{ source: "queued", id: "q1" }}
        onClose={vi.fn()}
        names={{
          template: () => undefined,
          provider: id => (id === "p1" ? "Transactional" : undefined),
        }}
        now={NOW}
        fixTemplateHref={() => undefined}
        queuedActions={READS}
      />
    );
    const items = screen
      .getByRole("region", { name: "Attempts" })
      .querySelectorAll("li");
    expect(items[0].textContent).toContain("Transactional · To");
    expect(items[1].textContent).toContain("smtp (deleted) · To");
  });

  it("says the attempt count isn't recorded once its job was pruned", () => {
    showing(queuedDetail({ attempts: null }));
    renderSheet();
    expect(screen.getByText("Not recorded")).toBeTruthy();
  });

  it("draws only the newest attempts of a long timeline, and counts the rest", () => {
    const timeline = Array.from({ length: 150 }, (_, i) => ({
      ...ATTEMPT,
      id: `d${i}`,
    }));
    showing(queuedDetail({ templateCaused: false, timeline }));
    renderSheet();
    const attempts = screen.getByRole("region", { name: "Attempts" });
    expect(attempts.querySelectorAll("li")).toHaveLength(100);
    expect(attempts.textContent).toContain(
      "The newest 100 are shown; 50 earlier attempts aren’t."
    );
  });

  it("offers Fix template for a failure from the template, opening it in the workbench", () => {
    showing(queuedDetail());
    renderSheet();
    expect(
      screen.getByRole("link", { name: "Fix template" }).getAttribute("href")
    ).toBe("/edit/contact-notify-team");
  });

  it("offers no Fix template when the failure didn't come from the template", () => {
    showing(queuedDetail({ templateCaused: false }));
    renderSheet();
    expect(screen.queryByRole("link", { name: "Fix template" })).toBeNull();
  });

  it("offers no Fix template to a reader who may not open the template", () => {
    showing(queuedDetail());
    renderSheet(() => undefined);
    expect(screen.queryByRole("link", { name: "Fix template" })).toBeNull();
  });

  it("puts Cancelled first and keeps the last failure", () => {
    showing(queuedDetail({ state: "cancelled", templateCaused: false }));
    renderSheet();
    const state = screen.getByRole("status");
    expect(state.textContent).toContain("Cancelled");
    expect(state.textContent).toContain("Last failure:");
  });

  it("says when older attempts aren't shown", () => {
    showing(queuedDetail({ timelineTruncated: true, timeline: [ATTEMPT] }));
    renderSheet();
    expect(screen.getByText("Older attempts aren’t shown.")).toBeTruthy();
  });

  it("fills the screen on a phone and is a side sheet from the small breakpoint up", () => {
    showing(queuedDetail());
    renderSheet();
    const sheet = screen.getByRole("dialog");
    expect(sheet.className).toContain("w-full");
    expect(sheet.className).toContain("sm:w-[480px]");
  });

  it("closes from a button of its own, since on a phone it covers the overlay", () => {
    showing(queuedDetail());
    const onClose = vi.fn();
    renderSheet(undefined, onClose);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps what loaded, and says so, when a later refresh fails", () => {
    vi.mocked(useActivityDetail).mockReturnValue({
      data: queuedDetail(),
      isLoading: false,
      isError: true,
      error: new Error("Network down"),
    } as unknown as ReturnType<typeof useActivityDetail>);
    renderSheet();
    expect(
      screen.getByText("Couldn’t refresh, so this shows what loaded before.")
    ).toBeTruthy();
    expect(screen.getByText("The site’s own template")).toBeTruthy();
  });

  it("blames no provider for a queued failure with no attempt on record", () => {
    showing(
      queuedDetail({
        templateCaused: false,
        timeline: [],
        lastFailure: {
          retryable: false,
          reason: "The held message couldn't be read.",
        },
      })
    );
    renderSheet();
    const state = screen.getAllByRole("status")[0];
    expect(state.textContent).not.toMatch(/the provider (couldn|refused)/i);
    expect(state.textContent).not.toMatch(/never reached/i);
    expect(state.textContent).not.toMatch(/send it again/i);
  });

  it("warns that a queued email may have arrived when its newest attempt's answer was lost", () => {
    showing(
      queuedDetail({
        state: "retrying",
        templateCaused: false,
        lastFailure: {
          retryable: true,
          reason: "The provider's answer was lost.",
        },
        timeline: [
          {
            ...ATTEMPT,
            failureKind: "unknown",
            failureReason: "The provider's answer was lost.",
          },
        ],
      })
    );
    renderSheet();
    expect(screen.getAllByRole("status")[0].textContent).toContain(
      "Retrying: it may have arrived"
    );
  });

  it("treats a delivery with a queued email behind it as one of its attempts, never a direct send", () => {
    showing({
      source: "delivery",
      detail: {
        id: "d1",
        createdAt: "2026-11-16T11:00:00.000Z",
        outcome: "failed",
        templateSlug: "order-shipped",
        provider: { id: null, type: "resend", origin: "code" },
        recipientKind: "to",
        failureReason: "Resend answered 503",
        namedPerson: true,
        erased: false,
        queuedId: "q7",
        templateVersion: "none",
        failureKind: "retryable",
        failureStatus: 503,
        timeline: [],
        timelineTruncated: false,
      },
    });
    renderSheet();
    const state = screen.getAllByRole("status")[0];
    expect(state.textContent).not.toMatch(/direct send/i);
    expect(state.textContent).toMatch(/one attempt of a queued email/i);
  });
});

describe("a queued email's Retry and Cancel", () => {
  const managing = (over: Partial<QueuedEmailDetail> = {}) => {
    showing(queuedDetail({ templateCaused: false, ...over }));
    renderSheet(undefined, undefined, MANAGES);
  };
  const button = (name: string) => screen.queryByRole("button", { name });

  it("tries a failed email again at once, and says what the server said", () => {
    managing();
    fireEvent.click(button("Try again now")!);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ action: "retry", id: "q1" });
    expect(toastSuccess).toHaveBeenCalledWith("Done.");
  });

  it("cancels only once the reader confirms", () => {
    managing({ state: "waiting", lastFailure: null, attempts: 0 });
    fireEvent.click(button("Cancel email")!);
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "can’t be tried again"
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(button("Cancel email")!);
    const dialog = screen.getByRole("alertdialog");
    const confirm = screen
      .getAllByRole("button", { name: "Cancel email" })
      .find(b => dialog.contains(b));
    fireEvent.click(confirm!);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ action: "cancel", id: "q1" });
  });

  it("offers neither to a reader who may not manage email deliveries, and says nothing of them", () => {
    showing(queuedDetail({ templateCaused: false, state: "sending" }));
    renderSheet(undefined, undefined, READS);
    expect(button("Try again now")).toBeNull();
    expect(button("Cancel email")).toBeNull();
    expect(screen.queryByText(/with the provider now/)).toBeNull();
  });

  it("offers only Cancel while an attempt is with the provider, saying it holds only if that attempt fails", () => {
    managing({ state: "sending" });
    expect(button("Try again now")).toBeNull();
    expect(
      screen.getByText(/can’t be tried again until that attempt ends/)
    ).toBeTruthy();
    fireEvent.click(button("Cancel email")!);
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "cancelled only if this attempt fails"
    );
  });

  it("offers only Cancel once the message was cleared, and says why", () => {
    managing({ messageHeld: false });
    expect(button("Try again now")).toBeNull();
    expect(button("Cancel email")).toBeTruthy();
    expect(
      screen.getByText("Its message was cleared, so it can’t be tried again.")
    ).toBeTruthy();
  });

  it.each(["sent", "cancelled"] as const)(
    "offers neither once the email is %s",
    state => {
      managing({ state, lastFailure: null });
      expect(button("Try again now")).toBeNull();
      expect(button("Cancel email")).toBeNull();
    }
  );

  it("offers both to a retrying email", () => {
    managing({ state: "retrying" });
    expect(button("Try again now")).toBeTruthy();
    expect(button("Cancel email")).toBeTruthy();
  });

  it("shows a refusal with the server's reason, and no success", () => {
    answer = {
      ok: false,
      message: "This email has already been sent or cancelled.",
    };
    managing();
    fireEvent.click(button("Try again now")!);
    expect(screen.getByRole("alert").textContent).toContain(
      "This email has already been sent or cancelled."
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("offers neither on a delivery's sheet, which has no queued email of its own to act on", () => {
    showing({
      source: "delivery",
      detail: {
        id: "d1",
        createdAt: "2026-11-16T11:00:00.000Z",
        outcome: "failed",
        templateSlug: null,
        provider: { id: null, type: "resend", origin: "code" },
        recipientKind: "to",
        failureReason: "Resend answered 503",
        namedPerson: false,
        erased: false,
        queuedId: null,
        templateVersion: "none",
        failureKind: "retryable",
        failureStatus: 503,
        timeline: [],
        timelineTruncated: false,
      },
    });
    renderSheet(undefined, undefined, MANAGES);
    expect(button("Try again now")).toBeNull();
    expect(button("Cancel email")).toBeNull();
  });
});
