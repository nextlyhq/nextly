// @vitest-environment jsdom
/**
 * The shell's contract is that an ordinary child lands in the MEASURE column
 * and a `Bleed` child lands in the FULL one.
 *
 * jsdom computes no grid geometry, so these assert the class and
 * custom-property WIRING that produces it — the half a refactor can silently
 * drop — and never the resulting rectangle. Which is worth stating plainly
 * rather than leaving to be discovered: deleting the `.nx-page-shell > .nx-bleed`
 * rule from the stylesheet leaves every test in this file green, because no
 * stylesheet is applied here at all. `styles/__tests__/page-shell-grid.test.ts`
 * closes that by asserting the stylesheet's own contract, and neither file is
 * sufficient alone.
 *
 * Neither claims the resulting BOXES land where they should — only a browser
 * answers that, and no page renders the shell yet, so there is nothing for a
 * Playwright spec to assert against. That check lands with the first page that
 * consumes it. Until then the geometry rests on two measurements taken by hand
 * in a browser and recorded in the stylesheet test's comments.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Bleed, PageShell } from "./page-shell";

function shellOf(container: HTMLElement) {
  return container.querySelector<HTMLElement>("[data-slot='page-shell']");
}

function measureOf(container: HTMLElement) {
  return shellOf(container)?.style.getPropertyValue("--nx-shell-measure");
}

describe("PageShell", () => {
  it("carries the grid class that declares the named columns", () => {
    const { container } = render(
      <PageShell>
        <p>child</p>
      </PageShell>
    );

    expect(shellOf(container)?.classList.contains("nx-page-shell")).toBe(true);
  });

  it("selects the measure from `width`, so the two are one decision", () => {
    const { container: form } = render(<PageShell width="form">x</PageShell>);
    const { container: wide } = render(<PageShell width="wide">x</PageShell>);
    const { container: full } = render(<PageShell width="full">x</PageShell>);

    // Each arm resolves to a DIFFERENT value. Asserting only that the property
    // is set would pass on an implementation that hardcoded one measure and
    // ignored the prop, which is the plausible broken version worth separating
    // from the correct one.
    expect(measureOf(form)).toBe("var(--nx-measure-form)");
    expect(measureOf(wide)).toBe("var(--nx-measure-wide)");
    expect(measureOf(full)).toBe("100%");
  });

  it("defaults to the form measure when `width` is omitted", () => {
    const { container } = render(<PageShell>x</PageShell>);

    expect(measureOf(container)).toBe("var(--nx-measure-form)");
  });

  it("applies no horizontal padding of its own", () => {
    const { container } = render(<PageShell>x</PageShell>);

    // The whole point of spending the inset as columns is that there is ONE
    // declaration of it. A `px-*` utility here would be a second, and the two
    // would add — which is the defect this component was built to end,
    // measured as a 24px disagreement between a page header and the card
    // beneath it.
    const classes = shellOf(container)?.className ?? "";
    expect(classes).not.toMatch(/(^|\s)@?\S*px-/);
  });

  it("still accepts a caller's className", () => {
    const { container } = render(<PageShell className="pb-0">x</PageShell>);

    expect(shellOf(container)?.classList.contains("pb-0")).toBe(true);
  });

  it("forwards a ref and arbitrary div attributes", () => {
    let node: HTMLDivElement | null = null;
    const { container } = render(
      <PageShell
        ref={el => {
          node = el;
        }}
        id="page"
        role="region"
        aria-label="Settings"
      >
        x
      </PageShell>
    );

    const shell = shellOf(container);
    expect(node).toBe(shell);
    expect(shell?.getAttribute("id")).toBe("page");
    expect(shell?.getAttribute("role")).toBe("region");
  });

  it("keeps the measure it computed when a caller also passes style", () => {
    // Two sources for one value would disagree silently. `width` is the
    // supported way to choose the measure, so it wins over an inline override
    // rather than the merge order deciding it by accident.
    const { container } = render(
      <PageShell
        width="wide"
        style={{
          ["--nx-shell-measure" as string]: "10rem",
          paddingTop: "4px",
        }}
      >
        x
      </PageShell>
    );

    expect(measureOf(container)).toBe("var(--nx-measure-wide)");
    expect(shellOf(container)?.style.paddingTop).toBe("4px");
  });
});

describe("Bleed", () => {
  it("marks itself for the full column", () => {
    const { container } = render(
      <PageShell>
        <Bleed>wide thing</Bleed>
      </PageShell>
    );

    const bleed = container.querySelector("[data-slot='bleed']");
    expect(bleed?.classList.contains("nx-bleed")).toBe(true);
  });

  it("forwards a ref and arbitrary div attributes", () => {
    // A consumer cannot reach for the usual remedy of wrapping `Bleed` to
    // attach these, because a wrapper is exactly what stops it working — so the
    // forwarding matters more here than on an ordinary layout box.
    let node: HTMLDivElement | null = null;
    const { container } = render(
      <PageShell>
        <Bleed
          ref={el => {
            node = el;
          }}
          id="deliveries"
          aria-label="Delivery log"
          data-testid="bleed"
        >
          wide thing
        </Bleed>
      </PageShell>
    );

    const bleed = container.querySelector("[data-slot='bleed']");
    expect(node).toBe(bleed);
    expect(bleed?.getAttribute("id")).toBe("deliveries");
    expect(bleed?.getAttribute("aria-label")).toBe("Delivery log");
  });

  it("is a DIRECT child of the shell, which is what puts the named columns in scope", () => {
    const { container } = render(
      <PageShell>
        <Bleed>wide thing</Bleed>
      </PageShell>
    );

    // `full-start`/`full-end` are named on the shell's OWN grid, so a `Bleed`
    // nested any deeper resolves against a grid that never declared them and
    // the `grid-column` is inert — it renders, it looks finished, and it is not
    // full-bleed. Pinning the parent relationship is what stops a future
    // wrapper from quietly breaking every full-bleed block on a page.
    expect(container.querySelector("[data-slot='bleed']")?.parentElement).toBe(
      shellOf(container)
    );
  });

  it("is NOT a direct child once nested, which is the case the constraint warns about", () => {
    // The positive case above passes just as happily on an implementation that
    // never checks depth, so on its own it does not separate a correct nesting
    // rule from no rule at all. This is the counterexample: a `Bleed` one level
    // down still carries `.nx-bleed`, and that is precisely why the class alone
    // is not evidence of full-bleed — the stylesheet's child combinator is, and
    // `styles/__tests__/page-shell-grid.test.ts` is where that is pinned.
    const { container } = render(
      <PageShell>
        <div data-testid="wrapper">
          <Bleed>wide thing</Bleed>
        </div>
      </PageShell>
    );

    const bleed = container.querySelector("[data-slot='bleed']");
    expect(bleed?.classList.contains("nx-bleed")).toBe(true);
    expect(bleed?.parentElement).not.toBe(shellOf(container));
  });
});
