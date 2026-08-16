// @vitest-environment jsdom
/**
 * The responsive mode collapses on CONTAINER width, not viewport width. The
 * admin content region is 328px narrower than the window because of two
 * sidebars, so a viewport breakpoint promises columns the form does not have.
 *
 * The default is asserted alongside it because every existing caller relies on
 * the fixed behaviour: a change that only added the new mode would still be
 * wrong if it altered the old one.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Grid } from "./layout";

// Two cases below render text "a" into the shared jsdom document, so a
// leftover mount from the first would make the second's `getByText` see two
// matches instead of one. Unmounting after every test keeps each case
// reading only its own DOM.
afterEach(cleanup);

describe("Grid responsive mode", () => {
  it("collapses on a container query, never a viewport breakpoint", () => {
    render(
      <Grid cols={2} responsive>
        <span>a</span>
      </Grid>
    );
    const grid = screen.getByText("a").parentElement;
    expect(grid?.className).toContain("@");
    expect(grid?.className).not.toMatch(/(^|\s)(sm|md|lg|xl|2xl):/);
  });

  it("starts at one column when responsive", () => {
    render(
      <Grid cols={2} responsive>
        <span>a</span>
      </Grid>
    );
    const grid = screen.getByText("a").parentElement;
    expect(grid?.className).toContain("grid-cols-1");
  });

  it("leaves an existing fixed caller unchanged", () => {
    render(
      <Grid cols={2}>
        <span>b</span>
      </Grid>
    );
    const grid = screen.getByText("b").parentElement;
    expect(grid?.className).toContain("grid-cols-2");
    expect(grid?.className).not.toContain("@");
  });

  it("is fixed by default", () => {
    render(
      <Grid cols={3}>
        <span>c</span>
      </Grid>
    );
    const grid = screen.getByText("c").parentElement;
    expect(grid?.className).toContain("grid-cols-3");
    expect(grid?.className).not.toContain("@");
  });
});
