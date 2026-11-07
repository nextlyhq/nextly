// @vitest-environment jsdom

/**
 * A template's own designs: the count and the list in its document panel,
 * each row opening its entry; the empty state; nothing on an entry's own
 * design; and the builder's chip, only on a collection's template that has
 * own designs.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EntryDesignsResponse } from "../templates/entry-designs-contract";

let designs: EntryDesignsResponse | undefined;
let identity: { kind: string; slug: string; documentId?: string } | null = null;
const asked: string[] = [];
const navigated: string[] = [];

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: ({ path, enabled }: { path: string; enabled?: boolean }) => {
    if (enabled !== false) asked.push(path);
    const data =
      enabled === false
        ? undefined
        : path === "/layouts/page-collection"
          ? {
              pagesCollection: "pages",
              layoutsCollection: "layouts",
              templatesCollection: "templates",
            }
          : designs;
    return {
      data,
      error: null,
      pending: false,
      fetching: false,
      refetch: () => {},
    };
  },
  useDocumentIdentity: () => identity,
  navigateTo: (to: string) => {
    navigated.push(to);
  },
}));

const { OwnDesignsChip, TemplateOwnDesigns } = await import(
  "./TemplateOwnDesigns"
);

function answer(
  items: EntryDesignsResponse["items"],
  templateId = "t1",
  templateStatus: "draft" | "published" = "published"
): EntryDesignsResponse {
  return {
    items,
    meta: {
      total: items.length,
      page: 1,
      limit: 500,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
      template: { id: templateId, title: "Blog post", status: templateStatus },
      templateReadable: true,
      templateAllowed: true,
      mayCreateTemplate: false,
      mayGiveDesign: templateStatus === "published",
      entry: null,
      templatesCollection: "templates",
      names: { singular: "Post", plural: "Posts" },
      collection: "posts",
    },
  };
}

const TWO: EntryDesignsResponse["items"] = [
  {
    id: "d1",
    entryId: "p1",
    title: "Ten years of field notes",
    status: "published",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "d2",
    entryId: "p2",
    title: "Our spring catalogue",
    status: "draft",
    updatedAt: null,
  },
];

function panelSection(entryId = "t1") {
  return render(
    <TemplateOwnDesigns
      collectionSlug="templates"
      entryId={entryId}
      documentLock={{ readOnly: false, actionsDisabled: false }}
      mayWrite={() => true}
      documentChanged={() => {}}
    />
  );
}

afterEach(() => {
  cleanup();
  designs = undefined;
  identity = null;
  asked.length = 0;
  navigated.length = 0;
});

describe("a template's own designs, in its document panel", () => {
  it("counts them and lists each, opening its entry", () => {
    designs = answer(TWO);
    panelSection();

    expect(screen.getByText("2 posts have their own design")).toBeTruthy();
    expect(asked).toContain("/templates/entry-designs?template=t1");
    const first = screen.getByRole("link", {
      name: /Ten years of field notes/,
    });
    expect(first.getAttribute("href")).toBe("/admin/collections/posts/p1");
    expect(first.textContent).toContain("Published · edited today");
    expect(
      screen.getByRole("link", { name: /Our spring catalogue/ }).textContent
    ).toContain("Not published · visitors see this template");

    fireEvent.click(first);
    expect(navigated).toEqual(["/admin/collections/posts/p1"]);
  });

  it("offers each row's whole title and status line where the panel cuts them", () => {
    designs = answer(TWO);
    panelSection();
    const link = screen.getByRole("link", {
      name: /Our spring catalogue/,
    });
    const title = within(link).getByText("Our spring catalogue");
    expect(title.className).toContain("truncate");
    expect(title.getAttribute("title")).toBe("Our spring catalogue");
    const status = within(link).getByText(
      "Not published · visitors see this template"
    );
    expect(status.className).toContain("truncate");
    expect(status.getAttribute("title")).toBe(
      "Not published · visitors see this template"
    );
  });

  it("says no entry has one", () => {
    designs = answer([]);
    panelSection();
    expect(screen.getByText("No post has its own design.")).toBeTruthy();
    expect(
      screen.getByText("Every post is shown with this template.")
    ).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says a draft own design's entry is not a page while the template is not published", () => {
    designs = answer(TWO, "t1", "draft");
    panelSection();
    expect(
      screen.getByRole("link", { name: /Our spring catalogue/ }).textContent
    ).toContain("Not published · not shown as a page");
    // A published own design is shown whatever the template's state.
    expect(
      screen.getByRole("link", { name: /Ten years of field notes/ }).textContent
    ).toContain("Published · edited today");
  });

  it("says no entry is a page while the template is not published and none has its own design", () => {
    designs = answer([], "t1", "draft");
    panelSection();
    expect(
      screen.getByText(
        "This template isn't published, so posts aren't shown as pages until it is."
      )
    ).toBeTruthy();
    expect(
      screen.queryByText("Every post is shown with this template.")
    ).toBeNull();
  });

  it("draws nothing on an entry's own design, which is not its collection's template", () => {
    designs = answer(TWO, "t1");
    const { container } = panelSection("d1");
    expect(container.innerHTML).toBe("");
  });
});

describe("the builder's own designs chip", () => {
  it("says the count on a collection's template, and opens the list", () => {
    identity = { kind: "collection", slug: "templates", documentId: "t1" };
    designs = answer(TWO);
    render(<OwnDesignsChip />);
    fireEvent.click(
      screen.getByRole("button", { name: "2 posts have their own design" })
    );
    expect(
      screen.getByRole("link", { name: /Ten years of field notes/ })
    ).toBeTruthy();
  });

  it("is not drawn on another collection's document", () => {
    identity = { kind: "collection", slug: "pages", documentId: "t1" };
    designs = answer(TWO);
    const { container } = render(<OwnDesignsChip />);
    expect(container.innerHTML).toBe("");
    expect(asked.some(path => path.startsWith("/templates/"))).toBe(false);
  });

  it("is not drawn while no entry has its own design", () => {
    identity = { kind: "collection", slug: "templates", documentId: "t1" };
    designs = answer([]);
    const { container } = render(<OwnDesignsChip />);
    expect(container.innerHTML).toBe("");
  });
});
