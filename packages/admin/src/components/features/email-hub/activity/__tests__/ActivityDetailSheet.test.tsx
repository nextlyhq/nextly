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
  providerMessageId: null,
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
      timeline: [ATTEMPT],
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
  it("puts the state first, why it failed and what to do, then the details and attempts", () => {
    showing(queuedDetail());
    renderSheet();
    const state = screen.getByRole("status");
    expect(state.textContent).toContain("Failed: the provider refused it");
    expect(state.textContent).toContain("wasn't a valid address");
    expect(state.textContent).toContain("What to do.");
    expect(screen.getByText("Owner’s default")).toBeTruthy();
    expect(screen.getByText("Version 7aa2c510")).toBeTruthy();
    expect(screen.getByText("The form-builder plugin")).toBeTruthy();
    const attempts = screen.getByRole("region", { name: "Attempts" });
    expect(attempts.textContent).toContain("smtp · To · refused");
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
    showing(queuedDetail({ timelineTruncated: true }));
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
});
