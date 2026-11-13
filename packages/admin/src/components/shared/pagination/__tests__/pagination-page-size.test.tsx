// @vitest-environment jsdom

/**
 * The rows-per-page selector is named by its visible text, and each pager on
 * a page names its own selector.
 *
 * @module components/shared/pagination/__tests__/pagination-page-size.test
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Pagination } from "../index";

afterEach(cleanup);

const props = {
  currentPage: 0,
  totalPages: 3,
  pageSize: 25,
  onPageChange: () => undefined,
  onPageSizeChange: () => undefined,
};

describe("the rows-per-page selector", () => {
  it("is named by its visible text", () => {
    render(<Pagination {...props} />);
    const select = screen.getByRole("combobox", { name: "Rows per page" });
    expect(select).toHaveAccessibleName("Rows per page");
    // POSITIVE CONTROL: it is the selector, showing the current size.
    expect(select).toHaveValue("25");
  });

  it("is named by its own pager's text where two pagers share a page", () => {
    render(
      <>
        <Pagination {...props} ariaLabel="First list pages" />
        <Pagination {...props} ariaLabel="Second list pages" />
      </>
    );
    for (const name of ["First list pages", "Second list pages"]) {
      const pager = screen.getByRole("navigation", { name });
      const select = within(pager).getByRole("combobox");
      const labelId = select.getAttribute("aria-labelledby") ?? "";
      // The name comes from the text inside THIS pager, not the other's.
      expect(pager.querySelector(`[id="${labelId}"]`)).toHaveTextContent(
        "Rows per page"
      );
    }
  });
});
