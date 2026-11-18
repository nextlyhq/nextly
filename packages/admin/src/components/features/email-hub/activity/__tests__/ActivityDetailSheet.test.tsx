// @vitest-environment jsdom
/**
 * The detail sheet: its state first, then its details and every attempt;
 * "Fix template" only for a queued email whose failure came from its
 * template, and only where the reader may open that template; and the whole
 * screen on a phone.
 *
 * @module components/features/email-hub/activity/__tests__/ActivityDetailSheet.test
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  useActivityDetail,
  type ActivityDetail,
} from "@admin/hooks/queries/useEmailActivity";
import type {
  DeliveryAttempt,
  QueuedEmailDetail,
} from "@admin/services/emailActivityApi";

import { ActivityDetailSheet } from "../ActivityDetailSheet";

vi.mock("@admin/hooks/queries/useEmailActivity", () => ({
  useActivityDetail: vi.fn(),
}));
vi.mock("@admin/hooks/useAdminDateFormatter", () => ({
  formatDateWithAdminTimezone: (value: string) => `AT ${value}`,
}));

const NOW = new Date("2026-11-16T12:00:00.000Z");

const ATTEMPT: DeliveryAttempt = {
  id: "d1",
  createdAt: "2026-11-16T11:00:00.000Z",
  outcome: "failed",
  recipientKind: "to",
  provider: { id: null, type: "smtp" },
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
    `/edit/${slug}`
) {
  render(
    <ActivityDetailSheet
      open={{ source: "queued", id: "q1" }}
      onClose={vi.fn()}
      names={{ template: () => undefined, provider: () => undefined }}
      now={NOW}
      fixTemplateHref={fixTemplateHref}
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
    expect(screen.getByText("No attempt yet.")).toBeTruthy();
  });

  it("names each attempt's provider answer, after the state", () => {
    showing(queuedDetail({ templateCaused: false, timeline: [ATTEMPT] }));
    renderSheet();
    expect(screen.getByRole("status").textContent).toContain(
      "Failed: the provider refused it"
    );
    const attempts = screen.getByRole("region", { name: "Attempts" });
    expect(attempts.textContent).toContain("smtp · To · refused");
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
        timeline: [{ ...ATTEMPT, failureKind: "unknown" }],
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
        provider: { id: null, type: "resend" },
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
