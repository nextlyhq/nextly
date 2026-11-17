// @vitest-environment jsdom
/**
 * The Pages panel's "Collection templates" group: a row per template with
 * its picture, its collection's name and the entries it draws, opening it in
 * the builder; "+ New collection template" only for collections with none,
 * to an author who may make one; the empty state; folding; and hidden from
 * an author who may not read templates.
 */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface RouteRead {
  plugin: string;
  path: string;
}
const routeReads: RouteRead[] = [];
const refetch = vi.fn();
let panel: { data?: unknown; error?: unknown } = {};
let choices: { data?: unknown; error?: unknown } = {};
const navigated: string[] = [];

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: (read: RouteRead) => {
    routeReads.push(read);
    const answer = read.path.startsWith("/templates/collection-choices")
      ? choices
      : panel;
    return {
      data: answer.data,
      error: answer.error ?? null,
      pending: answer.data === undefined && answer.error === undefined,
      fetching: false,
      refetch,
    };
  },
  navigateTo: (href: string) => navigated.push(href),
}));

vi.mock("../header-footer-pictures", () => ({
  useDocumentPictures: () => (documents: readonly unknown[]) => (
    <span data-testid="template-picture">{documents.length}</span>
  ),
}));

const actions = vi.hoisted(() => ({
  run: vi.fn(async (action: { collection: string }) => ({
    dryRun: false,
    kind: "create-template",
    template: {
      id: `new-${action.collection}`,
      title: "x",
      collection: action.collection,
      status: "draft",
    },
    refusals: [],
  })),
}));
vi.mock("../entry-designs-client", async importOriginal => ({
  ...(await importOriginal<typeof import("../entry-designs-client")>()),
  runTemplateAction: (action: { collection: string }) => actions.run(action),
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@nextlyhq/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/ui")>()),
  toast: toasts,
}));

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const { CollectionTemplatesGroup } = await import(
  "./collection-templates-group"
);

const template = (
  id: string,
  collection: string,
  label: string,
  extra = {}
) => ({
  id,
  title: label,
  collection,
  collectionLabel: label,
  published: true,
  document: { formatVersion: 1, kind: "template", nodes: [] },
  use: { entries: 10 },
  ...extra,
});

const folds = { folded: new Set<string>(), onFold: vi.fn() };
/** Whether the author may create a template, as the panel read says. */
let mayCreate = true;

beforeEach(() => {
  mayCreate = true;
  routeReads.length = 0;
  navigated.length = 0;
  folds.folded = new Set();
  folds.onFold.mockClear();
  actions.run.mockClear();
  toasts.error.mockClear();
  panel = {
    data: {
      items: [
        template("t1", "posts", "Blog post"),
        template("t2", "events", "Event", {
          use: { entries: 1 },
          published: false,
        }),
      ],
      meta: {
        templatesCollection: "templates",
        canCreateTemplates: mayCreate,
        definitions: {},
      },
    },
  };
  choices = {
    data: {
      items: [
        { slug: "events", label: "Events" },
        { slug: "posts", label: "Blog posts" },
        { slug: "products", label: "Products" },
      ],
      meta: {},
    },
  };
});
afterEach(cleanup);

function rows(): HTMLElement[] {
  return within(
    screen.getByRole("list", { name: "Collection templates" })
  ).getAllByRole("listitem");
}

describe("the Collection templates group", () => {
  it("shows each template's picture, its collection and the entries it draws", () => {
    render(<CollectionTemplatesGroup folds={folds} />);
    expect(rows().map(row => row.textContent)).toEqual([
      expect.stringContaining("Blog postUsed by 10 entries"),
      expect.stringContaining("EventUsed by 1 entry · Draft"),
      expect.stringContaining("New collection template"),
    ]);
    expect(screen.getAllByTestId("template-picture")).toHaveLength(2);
  });

  it("opens a template in the builder", async () => {
    render(<CollectionTemplatesGroup folds={folds} />);
    await userEvent.click(screen.getByRole("button", { name: /^Blog post/ }));
    expect(navigated).toEqual(["/admin/collections/templates/t1/builder"]);
  });

  it("offers a new template only for collections with none, and opens it once made", async () => {
    render(<CollectionTemplatesGroup folds={folds} />);
    await userEvent.click(
      screen.getByRole("button", { name: /New collection template/ })
    );
    expect(
      screen.getAllByRole("menuitem").map(entry => entry.textContent)
    ).toEqual(["Products"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Products" }));
    expect(actions.run).toHaveBeenCalledWith({
      kind: "create-template",
      collection: "products",
    });
    await vi.waitFor(() =>
      expect(navigated).toEqual([
        "/admin/collections/templates/new-products/builder",
      ])
    );
  });

  it("offers no new template to an author who may not make one, or when every collection has one", () => {
    choices = { error: Object.assign(new Error("No"), { status: 403 }) };
    render(<CollectionTemplatesGroup folds={folds} />);
    expect(
      screen.queryByRole("button", { name: /New collection template/ })
    ).toBeNull();
    cleanup();
    choices = {
      data: { items: [{ slug: "posts", label: "Blog posts" }], meta: {} },
    };
    render(<CollectionTemplatesGroup folds={folds} />);
    expect(
      screen.queryByRole("button", { name: /New collection template/ })
    ).toBeNull();
  });

  it("offers no new template to an author who may change templates but not create one", () => {
    mayCreate = false;
    panel = {
      data: {
        items: [template("t1", "posts", "Blog post")],
        meta: {
          templatesCollection: "templates",
          canCreateTemplates: false,
          definitions: {},
        },
      },
    };
    render(<CollectionTemplatesGroup folds={folds} />);
    expect(
      screen.queryByRole("button", { name: /New collection template/ })
    ).toBeNull();
  });

  it("says what a template is for when there are none", () => {
    panel = {
      data: {
        items: [],
        meta: {
          templatesCollection: "templates",
          canCreateTemplates: mayCreate,
          definitions: {},
        },
      },
    };
    render(<CollectionTemplatesGroup folds={folds} />);
    expect(
      screen.getByText("Design every entry of a collection at once.")
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /New collection template/ })
    ).toBeTruthy();
  });

  it("is hidden from an author who may not read templates", () => {
    panel = { error: Object.assign(new Error("No"), { status: 403 }) };
    const { container } = render(<CollectionTemplatesGroup folds={folds} />);
    expect(container.textContent).toBe("");
  });

  it("folds", async () => {
    render(<CollectionTemplatesGroup folds={folds} />);
    await act(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "Collection templates, 2" })
      );
    });
    expect(folds.onFold).toHaveBeenCalledWith("collection-templates", true);
  });
});
