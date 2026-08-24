/**
 * Both routes render one component, because two hand-kept copies already
 * drifted once.
 *
 * The collection route received a scroll-containment fix that the single route
 * never did, so a single's panes collapsed to their content and left the lower
 * third of the page empty. Nothing detected it: the two files were never
 * compared, and each read correctly on its own.
 *
 * The assertions below are therefore written as a PAIR over both kinds rather
 * than as one test of the shared component. A single test would pass on a
 * component that is correct and still say nothing about whether both routes
 * reach it, which is the property that actually failed.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@admin/hooks/queries", () => ({
  useCollection: () => ({
    data: { label: "Posts", fields: [], status: true },
    isLoading: false,
    error: null,
  }),
  useSingleSchema: () => ({
    data: { label: "Homepage", fields: [] },
    isLoading: false,
    error: null,
  }),
}));

// The playground itself mounts CodeMirror, which wants browser globals and has
// its own suite. What matters here is the shell it is dropped into.
vi.mock("../APIPlayground", () => ({
  APIPlayground: (props: Record<string, unknown>) => (
    <div data-testid="playground" data-is-single={String(props.isSingle)} />
  ),
}));

import { ApiPlaygroundPage } from "../ApiPlaygroundPage";
// The ROUTE modules, by the path the registry imports them from. Rendering
// their default exports is the only way the delegation itself is observable:
// calling the shared component directly proves the component works and says
// nothing about whether either route reaches it, or reaches it correctly.
import CollectionRoute from "@admin/pages/dashboard/entries/[slug]/api";
import SingleRoute from "@admin/pages/dashboard/singles/[slug]/api";

const KINDS = [
  { kind: "collection" as const, slug: "posts", label: "Posts" },
  { kind: "single" as const, slug: "homepage", label: "Homepage" },
];

/** The routes as the registry holds them, with the label each must resolve. */
const ROUTES = [
  {
    name: "collection",
    Route: CollectionRoute,
    slug: "posts",
    label: "Posts",
    single: false,
  },
  {
    name: "single",
    Route: SingleRoute,
    slug: "homepage",
    label: "Homepage",
    single: true,
  },
];

describe("ApiPlaygroundPage", () => {
  it.each(KINDS)("contains its own scroll on a $kind", ({ kind, slug }) => {
    render(<ApiPlaygroundPage kind={kind} slug={slug} />);
    const container = screen.getByTestId("page-container");
    // The three that made the difference: fill the panel, allow the children to
    // shrink, and keep the overflow inside rather than growing the page.
    expect(container.className).toContain("h-full");
    expect(container.className).toContain("min-h-0");
    expect(container.className).toContain("overflow-hidden");
  });

  it.each(KINDS)("names the $kind it is testing", ({ kind, slug, label }) => {
    render(<ApiPlaygroundPage kind={kind} slug={slug} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("tells the playground when it is a single", () => {
    render(<ApiPlaygroundPage kind="single" slug="homepage" />);
    expect(screen.getByTestId("playground")).toHaveAttribute(
      "data-is-single",
      "true"
    );
  });

  it("does not claim a collection is a single", () => {
    render(<ApiPlaygroundPage kind="collection" slug="posts" />);
    expect(screen.getByTestId("playground")).not.toHaveAttribute(
      "data-is-single",
      "true"
    );
  });

  it.each(KINDS)(
    "asks for a slug the $kind route did not supply",
    ({ kind }) => {
      render(<ApiPlaygroundPage kind={kind} />);
      expect(screen.getByRole("alert")).toHaveTextContent(/slug is required/i);
    }
  );
});

/**
 * The wiring, not the component.
 *
 * This is the suite that would have caught the original defect. A wrapper that
 * passes the wrong kind, stops forwarding its slug, or is reverted to local
 * markup leaves every assertion above green, because none of them renders a
 * route.
 */
describe("the route wrappers", () => {
  it.each(ROUTES)(
    "$name route delegates to the shared page",
    ({ Route, slug }) => {
      render(<Route params={{ slug }} />);
      // The shared page is the only thing that renders this container with the
      // containment classes; local markup would have to reproduce them to pass.
      const container = screen.getByTestId("page-container");
      expect(container.className).toContain("h-full");
      expect(container.className).toContain("min-h-0");
      expect(container.className).toContain("overflow-hidden");
    }
  );

  it.each(ROUTES)(
    "$name route asks for its own kind",
    ({ Route, slug, label }) => {
      render(<Route params={{ slug }} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  );

  it.each(ROUTES)(
    "$name route tells the playground what it is",
    ({ Route, slug, single }) => {
      render(<Route params={{ slug }} />);
      const playground = screen.getByTestId("playground");
      expect(playground.getAttribute("data-is-single")).toBe(String(single));
    }
  );

  it.each(ROUTES)(
    "$name route forwards a missing slug rather than inventing one",
    ({ Route }) => {
      render(<Route params={{}} />);
      expect(screen.getByRole("alert")).toHaveTextContent(/slug is required/i);
    }
  );
});
