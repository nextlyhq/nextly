// @vitest-environment jsdom

/**
 * A capped total: the list counted no further than a cap because more items
 * exist, so the total is a lower bound.
 *
 * The count says "1000+", its range ends at the rows the page holds, and the
 * pager offers the next page but never a jump to a last page it cannot know.
 * Each case has a control with an exact total, so none passes on a pager that
 * ignores the flag.
 *
 * @module components/shared/pagination/__tests__/pagination-capped-total.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Pagination } from "../index";

afterEach(cleanup);

/** Page 41 of a list of more than 1,000 entries, 25 to a page. */
const capped = {
  currentPage: 40,
  // The pages counted so far, one past the current: more are known to follow.
  totalPages: 42,
  pageSize: 25,
  totalItems: 1000,
  itemLabel: "entries",
  onPageChange: () => undefined,
};

describe("a pager whose total is capped", () => {
  it('reads the total as "1000+", and ends the range at the rows the page holds', () => {
    render(<Pagination {...capped} totalCapped pageItemCount={25} />);

    const summary = document.querySelector('[data-slot="pagination-summary"]');
    expect(summary?.textContent).toMatch(/Showing 1001-1025 of 1000\+ entries/);
  });

  it("ends the range at the page's own rows on a short last page", () => {
    render(
      <Pagination
        {...capped}
        currentPage={41}
        totalPages={42}
        totalCapped
        pageItemCount={15}
      />
    );

    const summary = document.querySelector('[data-slot="pagination-summary"]');
    expect(summary?.textContent).toMatch(/Showing 1026-1040 of 1000\+ entries/);
  });

  it("offers the next page but no jump to the last", () => {
    const onPageChange = vi.fn();
    render(<Pagination {...capped} totalCapped onPageChange={onPageChange} />);

    const next = screen.getByRole("button", { name: /next/i });
    expect(next.hasAttribute("disabled")).toBe(false);
    const last = screen.getAllByRole("button", { name: /last/i });
    expect(last.every(button => button.hasAttribute("disabled"))).toBe(true);
    // No numbered button for a last page nobody counted.
    expect(screen.queryByRole("button", { name: "42" })).toBeNull();
    expect(screen.queryByText(/of 42/)).toBeNull();

    // End does nothing either.
    fireEvent.keyDown(next, { key: "End" });
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("still offers the last page when the total is exact", () => {
    // The control: the same pager with an exact total.
    render(<Pagination {...capped} totalItems={1050} />);

    const last = screen.getAllByRole("button", { name: /last/i });
    expect(last.some(button => !button.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByText(/of 42/)).toBeTruthy();
    const summary = document.querySelector('[data-slot="pagination-summary"]');
    expect(summary?.textContent).toMatch(/of 1050 entries/);
    expect(summary?.textContent).not.toMatch(/\+/);
  });
});
