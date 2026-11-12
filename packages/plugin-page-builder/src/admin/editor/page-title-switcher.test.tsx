// @vitest-environment jsdom
/**
 * The title switcher: "Recent" offers the pages edited before this one,
 * newest first, and never this one; choosing one opens it through the
 * admin's navigation (where its unsaved-changes guard asks first); "All
 * pages…" opens the Pages panel.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        onAllPages={() => {}}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "About us: switch page" })
    );
    const items = screen.getAllByRole("menuitem").map(item => item.textContent);
    expect(items).toEqual(["Pricing", "Home", "All pages…"]);

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
        onAllPages={onAllPages}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "About us: switch page" })
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "All pages…" }));
    expect(onAllPages).toHaveBeenCalledTimes(1);
  });
});
