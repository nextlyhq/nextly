// @vitest-environment jsdom
/**
 * The Pages panel's "Header & footer" group, as an author meets it: a row
 * per set with its picture, name and note, the site default marked, "+ New
 * header & footer" last, folding, and hidden from an author who may not read
 * sets.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render as renderPlain,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayoutChoicesResponse } from "../../layout-choices-contract";
import type { LayoutPageCountsResponse } from "../../layout-counts-contract";

interface RouteRead {
  plugin: string;
  path: string;
}
const routeReads: RouteRead[] = [];
const refetch = vi.fn();
let choices: { data?: unknown; error?: unknown } = {};
let counts: { data?: unknown; error?: unknown } = {};
let siteSettings: { data?: unknown; error?: unknown } = {};

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: (read: RouteRead) => {
    routeReads.push(read);
    const answer = read.path.startsWith("/layouts/counts")
      ? counts
      : read.path.startsWith("/site/settings")
        ? siteSettings
        : choices;
    return {
      data: answer.data,
      error: answer.error ?? null,
      pending: answer.data === undefined && answer.error === undefined,
      fetching: false,
      refetch,
    };
  },
}));

vi.mock("../header-footer-pictures", () => ({
  useSetPictures: () => (picture: readonly { componentId: string }[]) => (
    <span data-testid="set-picture">
      {picture.map(region => region.componentId).join("+")}
    </span>
  ),
}));

const setWrites = vi.hoisted(() => ({
  renameLayout: vi.fn(async (id: string, title: string) => ({ id, title })),
  duplicateLayout: vi.fn(async (id: string) => ({
    id: `${id}-copy`,
    title: "Copy of Landing",
  })),
}));
vi.mock("../layout-writes-client", () => setWrites);

const flows = vi.hoisted(() => ({
  makeDefault: vi.fn(),
  remove: vi.fn(),
  removeArgs: [] as Array<{
    entryId: string | null;
    published: boolean;
    leave: (action: "delete" | "unpublish", moved: readonly string[]) => void;
    afterStoppedMove?: (mayHaveMoved: readonly string[]) => void;
  }>,
}));
vi.mock("../make-default-action", () => ({
  useMakeDefaultFlow: () => ({ start: flows.makeDefault, dialog: null }),
}));
vi.mock("../RemoveLayoutAction", () => ({
  useRemoveLayout: (args: {
    entryId: string | null;
    published: boolean;
    leave: (action: "delete" | "unpublish", moved: readonly string[]) => void;
    afterStoppedMove?: (mayHaveMoved: readonly string[]) => void;
  }) => {
    flows.removeArgs.push(args);
    return { open: () => flows.remove(args.entryId), dialog: null };
  },
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@nextlyhq/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/ui")>()),
  toast: toasts,
}));

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const { HeaderFooterGroup } = await import("./header-footer-group");

/** The admin's query client, kept per test, so a test can see what it asks. */
let queryClient = new QueryClient();

/** Drawn inside the admin's query client, as the panel is. */
function render(ui: ReactNode) {
  const result = renderPlain(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
  return {
    ...result,
    rerender: (next: ReactNode) =>
      result.rerender(
        <QueryClientProvider client={queryClient}>{next}</QueryClientProvider>
      ),
  };
}

const set = (
  id: string,
  title: string,
  extra: Record<string, unknown> = {}
) => ({
  id,
  title,
  published: true,
  draftChangesNotLive: false,
  areasFilled: ["header"],
  regions: [{ area: "header", componentId: `h-${id}` }],
  ...extra,
});

function answer(items: ReturnType<typeof set>[], defaultLayout = "main") {
  choices = {
    data: {
      items,
      meta: {
        defaultLayout,
        defaultUnreadable: false,
        layoutsCollection: "layouts",
        canUpdateLayouts: rights.update,
        canCreateLayouts: rights.create,
        canDeleteAnyLayout: rights.delete,
        more: false,
        matched: items.map(item => item.id),
        regionComponents: {},
        regionDefinitions: {},
      },
    } as unknown as LayoutChoicesResponse,
  };
}

const folds = { folded: new Set<string>(), onFold: vi.fn() };
/** What the author may do to sets. */
const rights = {
  update: true,
  create: true,
  delete: true,
  chooseDefault: true,
};

beforeEach(() => {
  queryClient = new QueryClient();
  rights.update = true;
  rights.create = true;
  rights.delete = true;
  rights.chooseDefault = true;
  flows.makeDefault.mockClear();
  flows.remove.mockClear();
  flows.removeArgs.length = 0;
  siteSettings = {
    get data() {
      return {
        mayManageSite: true,
        mayChooseDefaultLayout: rights.chooseDefault,
      };
    },
  };
  setWrites.renameLayout.mockClear();
  setWrites.duplicateLayout.mockClear();
  toasts.success.mockClear();
  toasts.error.mockClear();
  routeReads.length = 0;
  refetch.mockClear();
  folds.folded = new Set();
  folds.onFold.mockClear();
  answer([
    set("main", "Main"),
    set("landing", "Landing"),
    set("promo", "Promo", { draftChangesNotLive: true }),
    set("campaign", "Campaign", { published: false }),
    set("big", "Big"),
  ]);
  counts = {
    data: {
      main: { pages: 11, floor: false },
      landing: { pages: 1, floor: false },
      promo: { pages: 4, floor: false },
      campaign: { pages: 0, floor: false },
      big: { pages: 200, floor: true },
    } satisfies LayoutPageCountsResponse,
  };
});
afterEach(cleanup);

/** The group's set rows, in order, by what each says. */
function rows(): HTMLElement[] {
  return within(
    screen.getByRole("list", { name: "Header & footer sets" })
  ).getAllByRole("listitem");
}

describe("the Header & footer group", () => {
  it("asks for every set's picture and changes in one read, and the counts", () => {
    render(<HeaderFooterGroup folds={folds} />);
    const paths = routeReads.map(read => read.path);
    expect(paths).toContain("/layouts/choices?pictures=1&drafts=1");
    expect(paths).toContain("/layouts/counts");
  });

  it("notes each set: the default and its pages, the others' pages, a draft and changes not published", () => {
    render(<HeaderFooterGroup folds={folds} />);
    const notes = rows().map(row => row.textContent);
    expect(notes).toEqual([
      expect.stringContaining("MainSite default · 11 pages"),
      expect.stringContaining("Landing1 page"),
      expect.stringContaining("Promo4 pages · Changes not published"),
      expect.stringContaining("CampaignNot used · Draft"),
      expect.stringContaining("BigAt least 200 pages"),
      expect.stringContaining("New header & footer"),
    ]);
  });

  it("draws each set's picture, from its regions", () => {
    render(<HeaderFooterGroup folds={folds} />);
    expect(
      screen.getAllByTestId("set-picture").map(picture => picture.textContent)
    ).toEqual(["h-main", "h-landing", "h-promo", "h-campaign", "h-big"]);
  });

  it("opens a set's form, and a new set's, without leaving the builder", () => {
    render(<HeaderFooterGroup folds={folds} />);
    const landing = screen.getByRole("link", { name: /^Landing/ });
    expect(landing.getAttribute("href")).toBe(
      "/admin/collections/layouts/landing"
    );
    expect(landing.getAttribute("target")).toBe("_blank");
    const add = screen.getByRole("link", { name: /New header & footer/ });
    expect(add.getAttribute("href")).toBe("/admin/collections/layouts/create");
    expect(add.getAttribute("target")).toBe("_blank");
  });

  it("asks both reads again when the author comes back from a set's form", () => {
    render(<HeaderFooterGroup folds={folds} />);
    refetch.mockClear();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    // The sets and their counts.
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("says when more sets exist than it lists, and where to see them all", () => {
    const listed = [set("main", "Main")];
    answer(listed);
    (choices.data as { meta: { more: boolean } }).meta.more = true;
    render(<HeaderFooterGroup folds={folds} />);
    const all = screen.getByRole("link", {
      name: /See every header & footer set/,
    });
    expect(all.getAttribute("href")).toBe("/admin/collections/layouts");
    expect(all.textContent).toContain("Showing the first 1.");
  });

  it("is hidden from an author who may not read sets", () => {
    choices = { error: Object.assign(new Error("No"), { status: 403 }) };
    const { container } = render(<HeaderFooterGroup folds={folds} />);
    expect(container.textContent).toBe("");
  });

  it("says when the sets could not be read, with a way to try again", () => {
    choices = { error: Object.assign(new Error("Boom"), { status: 500 }) };
    render(<HeaderFooterGroup folds={folds} />);
    expect(
      screen.getByText(/Couldn.t load the header & footer sets\./)
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("folds, and is drawn folded as the author left it", async () => {
    const { rerender } = render(<HeaderFooterGroup folds={folds} />);
    await act(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "Header & footer, 5" })
      );
    });
    expect(folds.onFold).toHaveBeenCalledWith("header-footer", true);
    folds.folded = new Set(["header-footer"]);
    rerender(<HeaderFooterGroup folds={{ ...folds }} />);
    expect(
      screen
        .getByRole("button", { name: "Header & footer, 5" })
        .getAttribute("aria-expanded")
    ).toBe("false");
    expect(
      screen.queryByRole("list", { name: "Header & footer sets" })
    ).toBeNull();
  });
});

/** A set row's menu, opened. */
async function openMenu(title: string) {
  await userEvent.click(
    screen.getByRole("button", { name: `More for ${title}` })
  );
}

describe("a set's menu", () => {
  it("offers Open, Rename and Duplicate to an author who may change and make sets", async () => {
    render(<HeaderFooterGroup folds={folds} />);
    await openMenu("Landing");
    expect(
      screen.getAllByRole("menuitem").map(entry => entry.textContent)
    ).toEqual(["Open", "Make site default", "Rename", "Duplicate", "Delete…"]);
  });

  it("offers neither Rename without the right to change sets nor Duplicate without the right to make them", async () => {
    rights.update = false;
    rights.create = false;
    rights.delete = false;
    rights.chooseDefault = false;
    answer([set("main", "Main"), set("landing", "Landing")]);
    render(<HeaderFooterGroup folds={folds} />);
    await openMenu("Landing");
    expect(
      screen.getAllByRole("menuitem").map(entry => entry.textContent)
    ).toEqual(["Open"]);
  });

  it("renames a set in place, then reads the sets again", async () => {
    render(<HeaderFooterGroup folds={folds} />);
    await openMenu("Landing");
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = await screen.findByRole("textbox", {
      name: "Header & footer set name",
    });
    await userEvent.clear(field);
    await userEvent.type(field, "Launch{Enter}");
    expect(setWrites.renameLayout).toHaveBeenCalledWith("landing", "Launch");
    await vi.waitFor(() => expect(refetch).toHaveBeenCalled());
    // The list still reads the live name; the row shows the saved one.
    expect(screen.getByRole("link", { name: /^Launch/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Landing/ })).toBeNull();
  });

  it("offers Rename to an author whose rule lets them update some sets", async () => {
    rights.update = false;
    answer([set("main", "Main"), set("landing", "Landing")]);
    (
      choices.data as { meta: { canUpdateAnyLayout?: boolean } }
    ).meta.canUpdateAnyLayout = true;
    render(<HeaderFooterGroup folds={folds} />);
    await openMenu("Landing");
    expect(
      screen.getAllByRole("menuitem").map(entry => entry.textContent)
    ).toContain("Rename");
  });

  it("copies a set, says so, then reads the sets again", async () => {
    render(<HeaderFooterGroup folds={folds} />);
    refetch.mockClear();
    await openMenu("Landing");
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(setWrites.duplicateLayout).toHaveBeenCalledWith("landing");
    await vi.waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Copy of Landing was made.")
    );
    expect(refetch).toHaveBeenCalled();
  });

  it("says why a write was refused", async () => {
    setWrites.duplicateLayout.mockRejectedValueOnce(new Error("Not allowed."));
    render(<HeaderFooterGroup folds={folds} />);
    await openMenu("Landing");
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await vi.waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith("Not allowed.")
    );
  });

  it("makes a published set the site default through the list's own flow", async () => {
    render(<HeaderFooterGroup folds={folds} />);
    await openMenu("Landing");
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Make site default" })
    );
    expect(flows.makeDefault).toHaveBeenCalledWith({
      id: "landing",
      title: "Landing",
      published: true,
    });
  });

  it("offers a draft set Publish it, then make default, and the default neither", async () => {
    render(<HeaderFooterGroup folds={folds} />);
    await openMenu("Campaign");
    expect(
      screen.getByRole("menuitem", { name: "Publish it, then make default" })
    ).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await openMenu("Main");
    expect(
      screen.queryByRole("menuitem", { name: /make default|Make site default/ })
    ).toBeNull();
  });

  it("opens the set's removal, and refuses the site default's with the reason", async () => {
    render(<HeaderFooterGroup folds={folds} />);
    await openMenu("Landing");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect(flows.remove).toHaveBeenCalledWith("landing");
    await openMenu("Main");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect(flows.remove).not.toHaveBeenCalledWith("main");
    expect(toasts.error).toHaveBeenCalledWith(
      "Main is the site default. Make another set the default before deleting it."
    );
  });

  it("asks the page's own set read again after a write, so the canvas draws the new default", async () => {
    // The canvas's read, as the admin caches a plugin route's read.
    const canvasKey = [
      "plugin-route",
      "/admin/api/plugins/@nextlyhq/plugin-page-builder/layouts/choices?selected=main",
    ];
    queryClient.setQueryData(canvasKey, { items: [] });
    const other = ["plugin-route", "/admin/api/plugins/other/layouts/choices"];
    queryClient.setQueryData(other, { items: [] });
    render(<HeaderFooterGroup folds={folds} />);
    await openMenu("Landing");
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(canvasKey)?.isInvalidated).toBe(true)
    );
    expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false);
  });

  it("reads the page being edited again when a removal moved it onto the default", () => {
    const reload = vi.fn();
    const location = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...location, reload },
    });
    try {
      render(<HeaderFooterGroup folds={folds} currentPageId="current" />);
      const landing = flows.removeArgs.findLast(
        args => args.entryId === "landing"
      );
      // Another page moved: the panel reads its sets again, no reload.
      act(() => landing?.leave("delete", ["other"]));
      expect(reload).not.toHaveBeenCalled();
      // The page being edited moved: it is read again.
      refetch.mockClear();
      act(() => landing?.leave("delete", ["other", "current"]));
      expect(reload).toHaveBeenCalledTimes(1);
      // Read again before the reload, so a cancelled one leaves nothing stale.
      expect(refetch).toHaveBeenCalled();
      // A move stopped part way, which may have moved the page being edited.
      act(() => landing?.afterStoppedMove?.(["current"]));
      expect(reload).toHaveBeenCalledTimes(2);
      act(() => landing?.afterStoppedMove?.(["other"]));
      expect(reload).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: location,
      });
    }
  });
});
