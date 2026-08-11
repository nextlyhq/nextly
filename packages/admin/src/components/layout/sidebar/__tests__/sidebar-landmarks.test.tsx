/**
 * The sidebar module contributes no document landmark.
 *
 * The admin shell renders the page's one primary landmark in `DashboardLayout`.
 * Anything nested inside it that also renders a `main` gives the document two,
 * which costs assistive technology an unambiguous "skip to the main content"
 * and forces any query for the main region to disambiguate between them.
 *
 * `SidebarInset` is the only component here that ever emitted one, so it is
 * the only one whose element is pinned. It is currently rendered nowhere, and
 * that is exactly why this is worth a test rather than a code reading: an
 * unrendered component has nothing else holding its markup still, and the
 * moment someone reaches for it the defect ships with them. Upstream ships it
 * as a `main` because it assumes the panel IS the page, so a future sync is a
 * live way for the element to come back.
 *
 * The assertion is on the ROLE rather than on the tag, because the defect is
 * "a second main landmark exists", not "the string `main` appears". Setting
 * `role="main"` on a `div` would reintroduce it while a tag check stayed green.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SidebarInset } from "../index";

describe("sidebar landmarks", () => {
  it("renders SidebarInset without a main landmark", () => {
    render(<SidebarInset>panel</SidebarInset>);

    // A positive control on the query itself: the component rendered, so an
    // empty landmark result is a fact about the markup and not about a render
    // that never happened.
    expect(screen.getByText("panel")).toBeInTheDocument();
    expect(screen.queryAllByRole("main")).toHaveLength(0);
  });

  it("still renders its children and forwards props", () => {
    // The element changed; the component did not stop being one. Without this,
    // deleting the body entirely would satisfy the landmark assertion above.
    render(
      <SidebarInset className="custom" data-testid="inset">
        <span>content</span>
      </SidebarInset>
    );

    const inset = screen.getByTestId("inset");
    expect(inset).toHaveClass("custom");
    expect(inset).toHaveTextContent("content");
  });
});
