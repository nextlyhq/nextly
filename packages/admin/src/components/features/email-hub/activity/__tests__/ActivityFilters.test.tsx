// @vitest-environment jsdom
/**
 * Activity's filters: how far back is chosen with one press, the chosen one
 * marked, and a filter the reader has no list for is not offered.
 *
 * @module components/features/email-hub/activity/__tests__/ActivityFilters.test
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ActivityFilters,
  DEFAULT_ACTIVITY_FILTER,
  isFiltered,
  providerValue,
  templateValue,
} from "../ActivityFilters";

describe("Activity's filters", () => {
  it("chooses how far back with one press, and marks the choice", () => {
    const onChange = vi.fn();
    render(
      <ActivityFilters
        filter={DEFAULT_ACTIVITY_FILTER}
        onChange={onChange}
        templates={[]}
        providers={[]}
      />
    );
    const week = screen.getByRole("button", { name: "7 days" });
    expect(week.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "24 hours" })
        .getAttribute("aria-pressed")
    ).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_ACTIVITY_FILTER,
      window: "30d",
    });
  });

  it("offers the template and provider filters only with a list to offer", () => {
    const { rerender } = render(
      <ActivityFilters
        filter={DEFAULT_ACTIVITY_FILTER}
        onChange={vi.fn()}
        templates={undefined}
        providers={undefined}
      />
    );
    expect(screen.getByLabelText("Outcome")).toBeTruthy();
    expect(screen.queryByLabelText("Template")).toBeNull();
    expect(screen.queryByLabelText("Provider")).toBeNull();

    rerender(
      <ActivityFilters
        filter={DEFAULT_ACTIVITY_FILTER}
        onChange={vi.fn()}
        templates={[{ slug: "password-reset", label: "Password reset" }]}
        providers={[{ choice: { id: "p1" }, label: "Resend" }]}
      />
    );
    expect(screen.getByLabelText("Template")).toBeTruthy();
    expect(screen.getByLabelText("Provider")).toBeTruthy();
  });

  it("counts the window alone as unfiltered, and any other choice as filtered", () => {
    expect(isFiltered(DEFAULT_ACTIVITY_FILTER)).toBe(false);
    expect(isFiltered({ ...DEFAULT_ACTIVITY_FILTER, window: "30d" })).toBe(
      false
    );
    expect(isFiltered({ ...DEFAULT_ACTIVITY_FILTER, outcome: "failed" })).toBe(
      true
    );
    expect(
      isFiltered({ ...DEFAULT_ACTIVITY_FILTER, template: "password-reset" })
    ).toBe(true);
    expect(
      isFiltered({ ...DEFAULT_ACTIVITY_FILTER, provider: { type: "smtp" } })
    ).toBe(true);
  });

  it('selects a template named "any" by a value no other choice has', () => {
    expect(templateValue("any")).not.toBe("any");
    expect(providerValue({ type: "any" })).not.toBe("any");
    expect(providerValue({ id: "any" })).not.toBe("any");
  });
});
