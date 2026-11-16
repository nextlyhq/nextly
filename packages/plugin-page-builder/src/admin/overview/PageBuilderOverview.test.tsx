// @vitest-environment jsdom

/**
 * The Page Builder overview: the bindings to fix first, and only while there
 * are any; the libraries the route answers, each with its count and, where
 * the reader may create, its New; and the collections and Singles that use
 * the builder, each opening its list or edit page, or how to add the field.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BINDINGS_TO_FIX_PAGE_HREF } from "../../bindings-report/contract";
import type { PageBuilderOverview as Overview } from "../../overview/contract";

let overview: Overview | undefined;
let bindings = 0;
const asked: string[] = [];

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: ({ path }: { path: string }) => {
    asked.push(path);
    const data = path.startsWith("/bindings-to-fix")
      ? {
          items: [],
          meta: {
            bindings,
            checkedAt: "2026-11-12T10:00:00Z",
            checking: false,
            total: 0,
            totalPages: 0,
          },
        }
      : overview;
    return {
      data,
      pending: data === undefined,
      error: null,
      refetch: () => {},
    };
  },
  navigateTo: () => undefined,
  PageFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageHeader: ({
    title,
    description,
  }: {
    title: string;
    description: string;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
  Card: ({ children, ...props }: { children?: ReactNode }) => (
    <div {...props}>{children}</div>
  ),
  // `asChild` hands its props to the one child, as the real Button does.
  Button: ({
    asChild,
    children,
    ...props
  }: {
    asChild?: boolean;
    children?: ReactNode;
  }) =>
    asChild && isValidElement(Children.only(children)) ? (
      cloneElement(children as ReactElement<Record<string, unknown>>, props)
    ) : (
      <button type="button" {...props}>
        {children}
      </button>
    ),
}));

const { PageBuilderOverview } = await import("./PageBuilderOverview");

afterEach(() => {
  cleanup();
  asked.length = 0;
});

const LIBRARIES: Overview["libraries"] = [
  { kind: "patterns", collection: "patterns", count: 12, mayCreate: true },
  { kind: "components", collection: "components", count: 8, mayCreate: false },
  { kind: "layouts", collection: "layouts", count: 3, mayCreate: true },
  {
    kind: "templates",
    collection: "site-templates",
    count: 5,
    mayCreate: true,
  },
];

const USES: Overview["usedIn"] = [
  {
    kind: "collection",
    slug: "pages",
    label: "Pages",
    field: "Layout",
    entries: 27,
  },
  { kind: "single", slug: "homepage", label: "Homepage", field: "Layout" },
];

function show(answer: Overview, toFix: number) {
  overview = answer;
  bindings = toFix;
  render(<PageBuilderOverview />);
}

describe("the overview's bindings to fix", () => {
  it("leads the page while there are any, with a link to review them", () => {
    show({ libraries: LIBRARIES, usedIn: USES }, 2);
    const notice = screen.getByTestId("overview-bindings");
    expect(notice.textContent).toContain("2 bindings to fix.");
    expect(notice.textContent).toContain(
      "A field changed after these blocks were bound to it."
    );
    expect(
      within(notice).getByRole("link", { name: "Review" }).getAttribute("href")
    ).toBe(BINDINGS_TO_FIX_PAGE_HREF);
    // First: before the libraries.
    const library = screen.getByRole("region", { name: "Library" });
    expect(
      notice.compareDocumentPosition(library) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Read by the report's own request, as the dashboard card reads it.
    expect(asked).toContain("/bindings-to-fix");
  });

  it("says one binding in the singular", () => {
    show({ libraries: LIBRARIES, usedIn: USES }, 1);
    expect(screen.getByTestId("overview-bindings").textContent).toContain(
      "1 binding to fix."
    );
  });

  it("is not drawn while there is nothing to fix", () => {
    show({ libraries: LIBRARIES, usedIn: USES }, 0);
    expect(screen.queryByTestId("overview-bindings")).toBeNull();
    // The control: the rest of the page is drawn.
    expect(screen.getByRole("region", { name: "Library" })).toBeDefined();
  });
});

describe("the overview's libraries", () => {
  it("draws each library with its count, description and New", () => {
    show({ libraries: LIBRARIES, usedIn: USES }, 0);
    const patterns = screen.getByTestId("overview-library-patterns");
    expect(
      within(patterns)
        .getByRole("link", { name: "Patterns" })
        .getAttribute("href")
    ).toBe("/admin/collections/patterns");
    expect(
      within(patterns).getByTestId("overview-library-count").textContent
    ).toBe("12");
    expect(patterns.textContent).toContain(
      "Starting points an editor inserts, then changes freely"
    );
    expect(
      within(patterns)
        .getByRole("link", { name: "New pattern" })
        .getAttribute("href")
    ).toBe("/admin/collections/patterns/create");

    // By the slug the site registered, which the route answers.
    const templates = screen.getByTestId("overview-library-templates");
    expect(
      within(templates)
        .getByRole("link", { name: "New template" })
        .getAttribute("href")
    ).toBe("/admin/collections/site-templates/create");

    const counts = ["patterns", "components", "layouts", "templates"].map(
      kind =>
        within(screen.getByTestId(`overview-library-${kind}`)).getByTestId(
          "overview-library-count"
        ).textContent
    );
    expect(counts).toEqual(["12", "8", "3", "5"]);
  });

  it("offers no New where the reader may not create", () => {
    show({ libraries: LIBRARIES, usedIn: USES }, 0);
    const components = screen.getByTestId("overview-library-components");
    expect(within(components).queryByRole("link", { name: /^New/ })).toBeNull();
    // The control: the card is drawn, with its count.
    expect(
      within(components).getByTestId("overview-library-count").textContent
    ).toBe("8");
  });

  it("draws only the libraries the route answers", () => {
    show({ libraries: LIBRARIES.slice(0, 1), usedIn: USES }, 0);
    expect(screen.getByTestId("overview-library-patterns")).toBeDefined();
    expect(screen.queryByTestId("overview-library-layouts")).toBeNull();
  });
});

describe("where the overview says the builder is used", () => {
  it("opens a collection's list and a Single's edit page", () => {
    show({ libraries: LIBRARIES, usedIn: USES }, 0);
    const uses = screen.getByRole("region", { name: "Where it is used" });
    expect(
      within(uses).getByRole("link", { name: "Pages" }).getAttribute("href")
    ).toBe("/admin/collections/pages");
    expect(
      within(uses).getByRole("link", { name: "Homepage" }).getAttribute("href")
    ).toBe("/admin/singles/homepage");
    expect(uses.textContent).toContain("27 entries");
    expect(uses.textContent).toContain("Single");
    expect(uses.textContent).toContain("Layout field");
    expect(within(uses).queryByTestId("overview-uses-empty")).toBeNull();
  });

  it("says how to add the field where nothing uses it", () => {
    show({ libraries: LIBRARIES, usedIn: [] }, 0);
    const uses = screen.getByRole("region", { name: "Where it is used" });
    const empty = within(uses).getByTestId("overview-uses-empty");
    expect(empty.textContent).toContain(
      "No collection or Single has a Page Builder field yet."
    );
    expect(empty.textContent).toContain("Add a Blocks field");
    expect(within(uses).queryAllByRole("link")).toHaveLength(0);
  });
});
