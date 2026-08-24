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

const KINDS = [
  { kind: "collection" as const, slug: "posts", label: "Posts" },
  { kind: "single" as const, slug: "homepage", label: "Homepage" },
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
