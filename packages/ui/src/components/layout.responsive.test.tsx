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
import { createRef } from "react";
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

  it("wraps itself in an unnamed @container and uses unnamed variants", () => {
    // Responsive mode must not depend on an ancestor declaring a NAMED
    // container: it renders its own wrapper and queries that, so it works
    // wherever it is mounted, not only inside the one page that happens to
    // declare `content`.
    render(
      <Grid cols={2} responsive>
        <span>a</span>
      </Grid>
    );
    const grid = screen.getByText("a").parentElement;
    const wrapper = grid?.parentElement;
    expect(wrapper?.className).toContain("@container");
    expect(grid?.className).toMatch(/(^|\s)@2xl:grid-cols-2(\s|$)/);
  });

  it("never emits a /content named container variant", () => {
    render(
      <Grid cols={6} responsive>
        <span>a</span>
      </Grid>
    );
    const grid = screen.getByText("a").parentElement;
    expect(grid?.className).not.toContain("/content");
  });

  it("puts a caller's className on the wrapper, not the inner grid", () => {
    // The wrapper is the element that actually sits in the parent's layout
    // (it carries the `@container`), so a positioning class like
    // `col-span-2` only takes effect there. Landing it on the inner grid
    // instead — the round-1 shape — silently drops it from the box the
    // parent is placing.
    render(
      <Grid cols={2} responsive className="col-span-2">
        <span>a</span>
      </Grid>
    );
    const grid = screen.getByText("a").parentElement;
    const wrapper = grid?.parentElement;
    expect(wrapper?.className).toContain("col-span-2");
    expect(wrapper?.className).toContain("@container");
    expect(grid?.className).not.toContain("col-span-2");
  });

  it("keeps cols/gap on the inner grid, not the wrapper", () => {
    render(
      <Grid cols={3} gap={8} responsive className="max-w-md">
        <span>a</span>
      </Grid>
    );
    const grid = screen.getByText("a").parentElement;
    const wrapper = grid?.parentElement;
    expect(grid?.className).toContain("gap-8");
    expect(wrapper?.className).not.toContain("gap-8");
    expect(wrapper?.className).toContain("max-w-md");
    expect(grid?.className).not.toContain("max-w-md");
  });

  it("forwards the ref to the wrapper in responsive mode", () => {
    // The wrapper is the layout-participating element, so a caller measuring
    // or positioning the Grid via ref needs to land on it rather than on the
    // inner element it cannot see from the parent's side.
    const ref = createRef<HTMLDivElement>();
    render(
      <Grid cols={2} responsive ref={ref}>
        <span>a</span>
      </Grid>
    );
    const grid = screen.getByText("a").parentElement;
    expect(ref.current).toBe(grid?.parentElement);
    expect(ref.current?.className).toContain("@container");
  });

  it("renders no wrapper at all when responsive is not set", () => {
    // Structure, not only classes: a non-responsive Grid's rendered element
    // must be the direct child of whatever the caller placed it in, not a
    // wrapper this component introduced.
    const { container } = render(
      <div data-testid="host">
        <Grid cols={2}>
          <span>b</span>
        </Grid>
      </div>
    );
    const host = container.querySelector('[data-testid="host"]');
    const grid = screen.getByText("b").parentElement;
    expect(grid?.parentElement).toBe(host);
  });

  it("puts a caller's className and ref on the single non-responsive element", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Grid cols={2} className="col-span-2" ref={ref}>
        <span>b</span>
      </Grid>
    );
    const grid = screen.getByText("b").parentElement;
    expect(grid?.className).toContain("col-span-2");
    expect(ref.current).toBe(grid);
  });
});
