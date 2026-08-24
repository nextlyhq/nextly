// @vitest-environment jsdom
/**
 * A page's own identity, rendered once.
 *
 * The markup this replaces was written out by hand on 22 pages, and the
 * settings pages took their title from a ~130-line if-chain that matched
 * `window.location.pathname` in a file none of them import. Both are the same
 * defect from opposite ends: the page knows what it is, and nothing let it say
 * so. Every value here therefore arrives as a PROP.
 *
 * That mirrors a decision the route registry already made. A private route must
 * declare the rail section it belongs to, because the sidebar reads the
 * declaration rather than matching the URL — so a route added without one is a
 * compile error instead of a page that silently highlights the wrong entry.
 * A title derived from a pathname is the version of that defect nobody caught.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders the title as the page's h1", () => {
    render(<PageHeader title="General Settings" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "General Settings" })
    ).toBeTruthy();
  });

  it("renders description, breadcrumbs and actions when given", () => {
    render(
      <PageHeader
        title="New Webhook"
        description="Send signed events to an external endpoint"
        breadcrumbs={<nav aria-label="Breadcrumb">crumbs</nav>}
        actions={<button type="button">Save</button>}
      />
    );

    expect(
      screen.getByText("Send signed events to an external endpoint")
    ).toBeTruthy();
    expect(screen.getByLabelText("Breadcrumb")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("omits each optional slot rather than rendering it empty", () => {
    const { container } = render(<PageHeader title="Only a title" />);

    // An empty <p> still occupies a line and still separates the title from
    // what follows, so "renders nothing visible" is not the same as "is not
    // there" — and only the second keeps the spacing of a title-only page
    // identical to a page that never had a description.
    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("takes a ReactNode description, not only a string", () => {
    // A description carrying a link or an inline code span is ordinary in this
    // admin; typing it as `string` would push those pages back to hand-rolling
    // the whole header, which is what this component exists to end.
    render(
      <PageHeader
        title="Webhooks"
        description={
          <>
            Send signed events. <a href="/docs">Read the docs</a>
          </>
        }
      />
    );

    expect(screen.getByRole("link", { name: "Read the docs" })).toBeTruthy();
  });

  it("keeps the description in muted ink", () => {
    const { container } = render(
      <PageHeader title="Webhooks" description="Secondary text" />
    );

    // Recorded rather than assumed: a faint primary alpha was tried here and
    // failed contrast, so the muted token is the one that passes.
    expect(container.querySelector("p")?.className).toContain(
      "text-muted-foreground"
    );
  });

  it("accepts a caller's className without losing its own layout", () => {
    const { container } = render(
      <PageHeader title="Webhooks" className="mb-0" />
    );
    const header = container.querySelector("[data-slot='page-header']");

    expect(header?.classList.contains("mb-0")).toBe(true);
  });
});
