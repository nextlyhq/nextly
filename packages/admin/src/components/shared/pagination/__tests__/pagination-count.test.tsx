// @vitest-environment jsdom

/**
 * What the count line claims, which is the part of this component a reader
 * takes at face value.
 *
 * The controls are exercised by the tables that mount them. What is only true
 * HERE is the arithmetic: the range is built from `currentPage * pageSize + 1`
 * and clamped at the other end by `totalItems`, so the two ends are computed
 * from different things and can cross.
 *
 * @module components/shared/pagination/__tests__/pagination-count.test
 */
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Pagination } from "../index";

afterEach(cleanup);

const props = {
  currentPage: 0,
  totalPages: 1,
  pageSize: 20,
  onPageChange: () => undefined,
};

describe("the count line", () => {
  it("does not describe a first row that is not there", () => {
    /*
     * The range's start does not depend on the total, so on an empty list it
     * is 1 while the clamped end is 0 — "Showing 1-0 of 0", a range whose
     * start is past its end. Reachable today on a webhook's deliveries page,
     * which renders this with no rows.
     */
    render(<Pagination {...props} totalItems={0} itemLabel="deliveries" />);

    expect(screen.queryByText(/1-0/)).toBeNull();
    expect(screen.getByText(/No deliveries/)).toBeTruthy();
  });

  it("still gives a real range when there ARE rows", () => {
    // The control. Suppressing the range whenever it looked odd would also
    // suppress it on every page that has one, which is the component's job.
    render(<Pagination {...props} totalItems={42} itemLabel="entries" />);

    expect(screen.getByText(/Showing/)).toBeTruthy();
    expect(screen.getByText(/1-20/)).toBeTruthy();
    expect(screen.getByText(/42/)).toBeTruthy();
  });

  it("clamps the range's end to the total on a partial last page", () => {
    // The other end of the same arithmetic: page 3 of 42 items ends at 42,
    // not at 80.
    render(
      <Pagination
        {...props}
        currentPage={2}
        totalPages={3}
        totalItems={42}
        itemLabel="entries"
      />
    );

    expect(screen.getByText(/41-42/)).toBeTruthy();
  });

  it("keeps the page-of-pages form when the total is UNKNOWN", () => {
    /*
     * `totalItems` is optional, and absent is not empty: a caller that cannot
     * count says nothing about how many rows exist. Reading `!totalItems` here
     * would collapse the two and report an unknown total as no rows.
     */
    const { container } = render(
      <Pagination {...props} totalPages={7} currentPage={1} />
    );

    /*
     * On the summary ELEMENT, not on the landmark. The landmark also contains
     * the page-size selector, whose label reads "Rows per page" — measured,
     * an assertion for "Page" against the landmark passes even when this line
     * has been replaced by a broken count, which is what the first version of
     * this test did.
     */
    const summary = container.querySelector('[data-slot="pagination-summary"]');
    expect(summary?.textContent).toBe("Page 2 of 7");
  });
});
