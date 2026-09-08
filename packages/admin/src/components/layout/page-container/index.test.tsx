/**
 * The container has two layouts, and which one a page gets is decided by
 * whether it asked for a measure.
 *
 * The asymmetry is the point. A container WITH a measure is a CSS grid whose
 * outer columns are the page's inset; a container without one is the padded
 * block it has always been. Four pages hand their own height down a
 * `height: 100%` chain, which resolves against a grid area that
 * `align-content: start` has already sized to its content — so under a grid
 * that chain collapses and each of those pages loses its viewport-height
 * layout. jsdom computes no layout, so none of those four pages can hold a
 * test that observes it. This file guards the decision instead of the
 * consequence, which is the part that IS checkable here.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CONTENT_MEASURE_LENGTH,
  CONTENT_PAGE_MEASURE,
} from "@admin/components/layout/content-measure";

import { PageContainer } from "./index";

describe("PageContainer", () => {
  it("stays a padded block when no measure is asked for", () => {
    render(<PageContainer>content</PageContainer>);

    const container = screen.getByTestId("page-container");
    // Named rather than inferred from the absence of a grid: a renamed class
    // would otherwise turn this into a test that passes because it can no
    // longer find anything.
    expect(container.className).not.toContain("nx-page-shell");
    expect(container.className).toContain("px-4");
  });

  it("becomes the shell grid when a measure is asked for", () => {
    render(<PageContainer width="form">content</PageContainer>);

    const container = screen.getByTestId("page-container");
    expect(container.className).toContain("nx-page-shell");
    // The grid spends the inset as columns, so horizontal padding on the same
    // element would ADD to the gutter rather than replace it.
    expect(container.className).not.toContain("px-4");
  });

  it("carries the measure the page chose", () => {
    const { rerender } = render(
      <PageContainer width="form">content</PageContainer>
    );
    expect(
      screen
        .getByTestId("page-container")
        .style.getPropertyValue("--nx-shell-measure")
    ).toBe("var(--nx-measure-form)");

    rerender(<PageContainer width="wide">content</PageContainer>);
    expect(
      screen
        .getByTestId("page-container")
        .style.getPropertyValue("--nx-shell-measure")
    ).toBe("var(--nx-measure-wide)");

    // `full` is the arm a page uses when its CONTENT carries the measure.
    // Asserted as a DISTINCT value rather than merely present: a container
    // that ignored the prop and kept whichever measure it rendered first
    // would satisfy "the property is set".
    rerender(<PageContainer width="full">content</PageContainer>);
    expect(
      screen
        .getByTestId("page-container")
        .style.getPropertyValue("--nx-shell-measure")
    ).toBe("100%");
  });

  it("the content length agrees with what the shell actually renders", () => {
    // The oracle is the RENDER, not the map. `CONTENT_MEASURE_LENGTH` and the
    // shell both read `SHELL_MEASURE`, so comparing them to each other would
    // compare two reads of one value and pass however wrong that value was.
    // Rendering the container at the content measure and reading the property
    // back off the DOM is a different observation, and it is the one that
    // catches the field column being bounded to something the page never uses.
    render(<PageContainer width={CONTENT_PAGE_MEASURE}>content</PageContainer>);
    const rendered = screen
      .getByTestId("page-container")
      .style.getPropertyValue("--nx-shell-measure");

    expect(rendered).not.toBe("");
    expect(CONTENT_MEASURE_LENGTH).toBe(rendered);
  });

  it("keeps the grid for `full`, which is what separates it from no width", () => {
    // The two look alike on screen and are different layouts. `full` is the
    // shell grid with an uncapped content column, so the inset is still a
    // column and a child can leave it with `Bleed`; omitting the prop is the
    // padded block that four pages depend on for their height chains. A page
    // reaching for the wrong one takes the other's behaviour silently.
    const { rerender } = render(
      <PageContainer width="full">content</PageContainer>
    );
    expect(screen.getByTestId("page-container").className).toContain(
      "nx-page-shell"
    );
    expect(screen.getByTestId("page-container").className).not.toContain(
      "px-4"
    );

    rerender(<PageContainer>content</PageContainer>);
    expect(screen.getByTestId("page-container").className).not.toContain(
      "nx-page-shell"
    );
    expect(screen.getByTestId("page-container").className).toContain("px-4");
  });

  it("keeps the panel surface under both layouts", () => {
    // The background and the height floor belong to the page, not to the way
    // its content is laid out. Splitting the render into two branches is
    // exactly how one of them loses a class the other keeps.
    const { rerender } = render(<PageContainer>content</PageContainer>);
    const blockClasses = screen.getByTestId("page-container").className;

    rerender(<PageContainer width="form">content</PageContainer>);
    const gridClasses = screen.getByTestId("page-container").className;

    for (const shared of [
      "admin-page-container",
      "min-h-[calc(100vh-4rem)]",
      "py-6",
    ]) {
      expect(blockClasses, `block layout lost ${shared}`).toContain(shared);
      expect(gridClasses, `grid layout lost ${shared}`).toContain(shared);
    }
  });

  it("lets a page override its classes under both layouts", () => {
    const { rerender } = render(
      <PageContainer className="pb-0">content</PageContainer>
    );
    expect(screen.getByTestId("page-container").className).toContain("pb-0");

    rerender(
      <PageContainer width="form" className="pb-0">
        content
      </PageContainer>
    );
    expect(screen.getByTestId("page-container").className).toContain("pb-0");
  });

  it("forwards its ref under both layouts", () => {
    // The four pages that depend on the block layout reach the node through a
    // ref, and a branch that forwards it on one path only would break them on
    // whichever path was not exercised.
    let blockNode: HTMLDivElement | null = null;
    render(
      <PageContainer ref={n => void (blockNode = n)}>content</PageContainer>
    );
    expect(blockNode).toBeInstanceOf(HTMLElement);

    let gridNode: HTMLDivElement | null = null;
    render(
      <PageContainer width="form" ref={n => void (gridNode = n)}>
        content
      </PageContainer>
    );
    expect(gridNode).toBeInstanceOf(HTMLElement);
  });
});
