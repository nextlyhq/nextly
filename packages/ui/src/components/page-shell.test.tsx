// @vitest-environment jsdom
/**
 * The shell's contract is that an ordinary child lands in the MEASURE column
 * and a `Bleed` child lands in the FULL one.
 *
 * jsdom computes no grid geometry, so these assert the class and
 * custom-property WIRING that produces it and never the resulting rectangle.
 * Deleting the `.nx-page-shell > .nx-bleed` rule from the stylesheet leaves
 * every test here green, because no stylesheet is applied in this environment;
 * `styles/__tests__/page-shell-grid.test.ts` asserts that half separately, and
 * neither file is sufficient alone.
 *
 * Neither claims the resulting BOXES land where they should. Only a browser
 * answers that.
 */
import type { ReactNode } from "react";

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
    const { container: form } = render(
      <PageShell width="form">
        <p>x</p>
      </PageShell>
    );
    const { container: wide } = render(
      <PageShell width="wide">
        <p>x</p>
      </PageShell>
    );
    const { container: full } = render(
      <PageShell width="full">
        <p>x</p>
      </PageShell>
    );

    // Each arm resolves to a DIFFERENT value. Asserting only that the property
    // is set would pass on an implementation that hardcoded one measure and
    // ignored the prop, which is the plausible broken version worth separating
    // from the correct one.
    expect(measureOf(form)).toBe("var(--nx-measure-form)");
    expect(measureOf(wide)).toBe("var(--nx-measure-wide)");
    expect(measureOf(full)).toBe("100%");
  });

  it("defaults to the form measure when `width` is omitted", () => {
    const { container } = render(
      <PageShell>
        <p>x</p>
      </PageShell>
    );

    expect(measureOf(container)).toBe("var(--nx-measure-form)");
  });

  it("applies no horizontal padding of its own", () => {
    const { container } = render(
      <PageShell>
        <p>x</p>
      </PageShell>
    );

    // The whole point of spending the inset as columns is that there is ONE
    // declaration of it. A `px-*` utility here would be a second, and the two
    // would add — which is the defect this component was built to end,
    // measured as a 24px disagreement between a page header and the card
    // beneath it.
    const classes = shellOf(container)?.className ?? "";
    expect(classes).not.toMatch(/(^|\s)@?\S*px-/);
  });

  it("still accepts a caller's className", () => {
    const { container } = render(
      <PageShell className="pb-0">
        <p>x</p>
      </PageShell>
    );

    expect(shellOf(container)?.classList.contains("pb-0")).toBe(true);
  });

  /**
   * Each shape is exercised against a FRESHLY imported module.
   *
   * `devWarnOnce` de-duplicates by message for the life of the module it lives
   * in, so a second shape asserted in the same module observes nothing however
   * the predicate behaves — the silence would be the cache, not the code.
   * Resetting the registry per case is what makes each assertion falsifiable.
   */
  async function renderFresh(node: ReactNode) {
    vi.resetModules();
    const fresh = await import("./page-shell");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      render(<fresh.PageShell>{node}</fresh.PageShell>);
      return warn.mock.calls.map(call => String(call[0]));
    } finally {
      warn.mockRestore();
    }
  }

  it("warns when a direct child is bare text", async () => {
    // CSS Grid wraps bare text in an ANONYMOUS grid item, which no selector can
    // reach, so `.nx-page-shell > *` does not place it and it lands in a gutter
    // track outside the measure. Nothing in the rendered output says so.
    const calls = await renderFresh("bare text");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("anonymous grid item");
  });

  it("warns when a fragment exposes bare text as a direct child", async () => {
    // React removes the fragment from the DOM, so ITS children become the
    // shell's own grid items. `Children.toArray` returns the fragment as one
    // element and does not descend into it, so the check has to.
    const calls = await renderFresh(<>fragment text</>);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("anonymous grid item");
  });

  it("warns for text nested through more than one fragment", async () => {
    const calls = await renderFresh(
      <>
        <>deeply nested text</>
      </>
    );

    expect(calls).toHaveLength(1);
  });

  it("stays silent when every rendered child is an element", async () => {
    // The negative control, and it is only evidence because the cases above run
    // against their own module instances rather than sharing this one's cache.
    const calls = await renderFresh(
      <>
        <p>an element</p>
      </>
    );

    expect(calls).toEqual([]);
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
        <p>x</p>
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
        <p>x</p>
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
    // The positive case above is satisfied by an implementation with no depth
    // rule at all, so it does not separate the two on its own. A `Bleed` one
    // level down still carries `.nx-bleed`, which is why the class is not
    // evidence of full-bleed: the stylesheet's child combinator is, and
    // `styles/__tests__/page-shell-grid.test.ts` pins that.
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
