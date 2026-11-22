// @vitest-environment jsdom
/**
 * The title switcher: "+ New page…" first, for an author who may make a
 * page, opening the New page dialog; then the page on screen; then "Recent",
 * the pages edited before this one, newest first, and never this one;
 * choosing one opens it through the admin's navigation (where its
 * unsaved-changes guard asks first); "All pages…" opens the Pages panel.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NewPageFacts } from "../../pages-write-contract";
import type { NewPageAsk } from "../new-page/new-page-facts";
import type { PageOnScreen } from "../new-page/new-page-dialog";

const navigateTo = vi.fn();
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  navigateTo: (href: string) => navigateTo(href),
  // The admin's preference store, as this browser's storage: these cases
  // read the history it keeps, and its own rules are the admin's to test.
  devicePreferenceStore: (key: string) => ({
    read: () => window.localStorage.getItem(key),
    write: (value: string) => window.localStorage.setItem(key, value),
    remove: () => window.localStorage.removeItem(key),
  }),
}));

/** The collections the dialog's read says the author may make a page in. */
let creatable: string[] = ["pages"];
const asked: NewPageAsk[] = [];
vi.mock("../new-page/new-page-facts", () => ({
  useNewPageFacts: (ask: NewPageAsk) => {
    asked.push(ask);
    return {
      facts: {
        collection: { slug: ask.collection, label: "Page" },
        collections: creatable.map(slug => ({ slug, label: slug })),
      } as unknown as NewPageFacts,
      current: true,
      failed: false,
      holdsNoPages: false,
      retry: () => {},
    };
  },
}));

/** The dialog, as far as the menu is concerned: opened for a collection. */
const opened: { collection: string; onScreen: PageOnScreen }[] = [];
vi.mock("../new-page/new-page-dialog", () => ({
  useNewPageDialog: (onScreen: PageOnScreen) => {
    const [collection, setCollection] = useState<string | null>(null);
    const dialog: ReactNode =
      collection === null ? null : (
        <div role="dialog" aria-label="New page">
          new page in {collection}
        </div>
      );
    return {
      open: (slug: string) => {
        opened.push({ collection: slug, onScreen });
        setCollection(slug);
      },
      dialog,
    };
  },
}));

const { PageTitleSwitcher } = await import("./page-title-switcher");

// What Radix's menu reaches for and jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

function page(id: string, title: string) {
  return { collection: "pages", id, field: "content", title };
}

beforeEach(() => {
  window.localStorage.clear();
  navigateTo.mockClear();
  creatable = ["pages"];
  asked.length = 0;
  opened.length = 0;
});
afterEach(cleanup);

/** Opens the editor on each page in turn, as an author moving between pages. */
function visit(...pages: ReturnType<typeof page>[]) {
  for (const each of pages) {
    const { unmount } = render(
      <PageTitleSwitcher
        title={each.title}
        current={each}
        userId="u1"
        unsavedWork={false}
        onAllPages={() => {}}
      />
    );
    unmount();
  }
}

describe("the title switcher", () => {
  it("names the page as the form holds it, saved or not", () => {
    render(
      <PageTitleSwitcher
        title="Draft title"
        current={null}
        userId="u1"
        unsavedWork={false}
        onAllPages={() => {}}
      />
    );
    expect(
      screen.getByRole("button", { name: "Draft title: switch page" })
    ).toBeTruthy();
  });

  it("offers the pages edited before this one, newest first, and opens one", async () => {
    visit(page("a", "Home"), page("b", "Pricing"));
    render(
      <PageTitleSwitcher
        title="About us"
        current={page("c", "About us")}
        userId="u1"
        unsavedWork={false}
        onAllPages={() => {}}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "About us: switch page" })
    );
    const items = screen.getAllByRole("menuitem").map(item => item.textContent);
    expect(items).toEqual([
      "+ New page…",
      "About us",
      "Pricing",
      "Home",
      "All pages…",
    ]);

    await userEvent.click(screen.getByRole("menuitem", { name: "Pricing" }));
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/collections/pages/b/builder?field=content"
    );
  });

  it("keeps one history per author", async () => {
    visit(page("a", "Home"));
    render(
      <PageTitleSwitcher
        title="About us"
        current={page("c", "About us")}
        userId="someone-else"
        unsavedWork={false}
        onAllPages={() => {}}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "About us: switch page" })
    );
    expect(screen.queryByRole("menuitem", { name: "Home" })).toBeNull();
  });

  it("opens the Pages panel from All pages…", async () => {
    const onAllPages = vi.fn();
    render(
      <PageTitleSwitcher
        title="About us"
        current={page("c", "About us")}
        userId="u1"
        unsavedWork={false}
        onAllPages={onAllPages}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "About us: switch page" })
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "All pages…" }));
    expect(onAllPages).toHaveBeenCalledTimes(1);
  });

  it("marks the page on screen, and stays on it when chosen", async () => {
    render(
      <PageTitleSwitcher
        title="About us"
        current={page("c", "About us")}
        userId="u1"
        unsavedWork={false}
        onAllPages={() => {}}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "About us: switch page" })
    );
    const here = screen.getByRole("menuitem", { name: "About us" });
    expect(here.getAttribute("aria-current")).toBe("page");
    await userEvent.click(here);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

describe("+ New page…", () => {
  function openMenu(over: { unsavedWork?: boolean } = {}): Promise<void> {
    render(
      <PageTitleSwitcher
        title="About us"
        current={page("c", "About us")}
        userId="u1"
        unsavedWork={over.unsavedWork ?? false}
        onAllPages={() => {}}
      />
    );
    return userEvent.click(
      screen.getByRole("button", { name: "About us: switch page" })
    );
  }

  it("asks the dialog's own read about the page's collection", async () => {
    await openMenu();
    expect(asked.at(-1)).toEqual({ collection: "pages", title: "" });
  });

  it("opens the New page dialog for the page's collection, once the menu has closed", async () => {
    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "+ New page…" })
    );
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "New page" })).toBeTruthy()
    );
    expect(screen.queryByRole("menu")).toBeNull();
    expect(opened).toEqual([
      {
        collection: "pages",
        onScreen: { unsavedWork: false, title: "About us" },
      },
    ]);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("tells the dialog the page on screen has unsaved work, so it asks first", async () => {
    await openMenu({ unsavedWork: true });
    await userEvent.click(
      screen.getByRole("menuitem", { name: "+ New page…" })
    );
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]?.onScreen).toEqual({
      unsavedWork: true,
      title: "About us",
    });
  });

  it("opens in another builder collection where the author may not add to this one", async () => {
    creatable = ["landing"];
    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "+ New page…" })
    );
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]?.collection).toBe("landing");
  });

  it("is left out for an author who may not make a page in any builder collection", async () => {
    creatable = [];
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "+ New page…" })).toBeNull();
    const items = screen.getAllByRole("menuitem").map(item => item.textContent);
    expect(items).toEqual(["About us", "All pages…"]);
  });

  it("is left out on a page not saved yet, which has no collection to ask about", async () => {
    render(
      <PageTitleSwitcher
        title="Draft"
        current={null}
        userId="u1"
        unsavedWork={false}
        onAllPages={() => {}}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Draft: switch page" })
    );
    expect(screen.queryByRole("menuitem", { name: "+ New page…" })).toBeNull();
    expect(asked).toEqual([]);
  });
});
