// @vitest-environment jsdom

/**
 * The New form submissions card as the dashboard draws it: in the admin's own
 * frame, from the widget as the registry publishes it, with the card's own
 * component registered at the path the widget declares.
 *
 * What a load answers for a reader is the integration suite's question; this
 * one is what the card shows for an answer, in light and dark, that its
 * empty state stays on the dashboard with a way to every submission, that its
 * times move on while it is open, and that opening a row marks it read.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { NewSubmissionsCard } from "./NewSubmissionsCard";
import {
  NEW_SUBMISSIONS_WIDGET_ID,
  type NewSubmissionsData,
} from "./new-submissions";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// The card's frame measures itself with a ResizeObserver, which jsdom does not
// implement. One that never reports leaves the card at the size and tier it
// was asked for, which is what these cases draw. Only defined when absent.
if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  });
}
// No media queries in jsdom either; a query that never matches is the
// default every part of the card falls back to.
if (!("matchMedia" in globalThis)) {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

/**
 * The server half of the test, loaded with `window` out of sight.
 *
 * `renderWidgetCard` describes the card from `nextly/testing`, and the plugin
 * is declared over `nextly`; both load core's server modules, one of which
 * refuses to load wherever `window` is defined. The admin's modules, the
 * card's own among them, are imported above with the DOM in place, so only
 * the server modules are evaluated without it, and the DOM is back before
 * anything is drawn.
 */
let server: {
  renderWidgetCard: typeof import("@nextlyhq/plugin-sdk/testing/admin").renderWidgetCard;
  formBuilder: typeof import("../plugin").formBuilder;
};

beforeAll(async () => {
  const dom = Object.getOwnPropertyDescriptor(globalThis, "window");
  Reflect.deleteProperty(globalThis, "window");
  try {
    const [testing, plugin] = await Promise.all([
      import("@nextlyhq/plugin-sdk/testing/admin"),
      import("../plugin"),
    ]);
    server = {
      renderWidgetCard: testing.renderWidgetCard,
      formBuilder: plugin.formBuilder,
    };
  } finally {
    if (dom !== undefined) Object.defineProperty(globalThis, "window", dom);
  }
});

/** The widget exactly as the plugin contributes it. */
function contributed() {
  const widget = server
    .formBuilder()
    .plugin.contributes?.dashboard?.widgets?.find(
      candidate => candidate.id === NEW_SUBMISSIONS_WIDGET_ID
    );
  if (widget === undefined) throw new Error("the plugin contributes no card");
  return widget;
}

const ALL = "/admin/collections/form-submissions";

const TWO_NEW: NewSubmissionsData = {
  items: [
    {
      id: "s1",
      title: "Ana Ruiz",
      form: "Contact",
      excerpt: "Could you send your price list?",
      at: "2026-01-05T09:30:00.000Z",
      href: `${ALL}/s1`,
    },
    {
      id: "s2",
      title: "Submission",
      form: "Survey",
      at: "2026-01-05T08:00:00.000Z",
      href: `${ALL}/s2`,
    },
  ],
  total: 2,
  allHref: ALL,
  collection: "form-submissions",
};

/**
 * The card, for a state and its data. The widget's data type is not carried
 * by the plugin's contribution, which holds any widget, so the data is handed
 * over as the card's own type here.
 */
function drawCard(
  state: "ready" | "empty",
  data: NewSubmissionsData,
  theme: "light" | "dark" = "light"
) {
  return render(
    server.renderWidgetCard(contributed(), {
      state,
      data: data as never,
      theme,
      component: NewSubmissionsCard,
    })
  );
}

describe("New form submissions", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`lists each new submission as a row opening it, with who, which form, its first line and when (${theme})`, () => {
      drawCard("ready", TWO_NEW, theme);
      const card = screen.getByRole("region", { name: "New form submissions" });
      expect(card).toHaveAttribute("data-state", "ready");

      const ana = within(card).getByRole("link", { name: /Ana Ruiz/ });
      expect(ana).toHaveAttribute("href", `${ALL}/s1`);
      expect(ana).toHaveTextContent(
        "Contact · Could you send your price list?"
      );
      expect(ana.querySelector("time")).toHaveAttribute(
        "dateTime",
        "2026-01-05T09:30:00.000Z"
      );

      const second = within(card).getByRole("link", { name: /^Submission/ });
      expect(second).toHaveAttribute("href", `${ALL}/s2`);
      expect(second).toHaveTextContent("Survey");
      // Newest first, as the load answered them.
      const rows = within(card)
        .getAllByTestId("entity-row-title")
        .map(title => title.textContent);
      expect(rows).toEqual(["Ana Ruiz", "Submission"]);
    });
  }

  it("leads from its footer to every submission", () => {
    drawCard("ready", TWO_NEW);
    const card = screen.getByRole("region", { name: "New form submissions" });
    expect(
      within(card).getByRole("link", { name: /View all/ })
    ).toHaveAttribute("href", ALL);
  });

  it('stays on the dashboard while nothing is new, saying "No new submissions" with a link to all of them, as the site installed them', () => {
    // A site that renamed the collection: the link is the card's data's, the
    // installed slug, never the slug the plugin declared.
    drawCard("ready", {
      items: [],
      total: 0,
      allHref: "/admin/collections/leads",
      collection: "leads",
    });
    const card = screen.getByRole("region", { name: "New form submissions" });
    expect(card).toHaveAttribute("data-state", "empty");
    expect(card).toHaveTextContent("No new submissions");
    const all = within(card).getByRole("link", { name: "All submissions" });
    expect(all).toHaveAttribute("href", "/admin/collections/leads");
  });

  it("does not hide while empty: its declaration never asks to", () => {
    expect(contributed()).not.toHaveProperty("hidesWhenEmpty");
  });

  it("moves its times on while it stays open, and stops its clock when it is gone", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-01-05T09:30:20.000Z"));
    const { unmount } = drawCard("ready", TWO_NEW);
    const card = screen.getByRole("region", { name: "New form submissions" });
    const ana = () => within(card).getByRole("link", { name: /Ana Ruiz/ });
    expect(ana().querySelector("time")).toHaveTextContent("just now");
    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(ana().querySelector("time")).toHaveTextContent("3m ago");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dates a submission a week old or more as core's cards do, with its year", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-01-10T12:00:00.000Z"));
    drawCard("ready", {
      ...TWO_NEW,
      items: [
        {
          id: "s1",
          title: "Ana Ruiz",
          at: "2025-12-01T12:00:00.000Z",
          href: `${ALL}/s1`,
        },
      ],
      total: 1,
    });
    const card = screen.getByRole("region", { name: "New form submissions" });
    expect(
      within(card)
        .getByRole("link", { name: /Ana Ruiz/ })
        .querySelector("time")
    ).toHaveTextContent("Dec 1, 2025");
  });

  describe("opening a submission", () => {
    /** Clicks, with the page's own navigation held, and the requests sent. */
    function sent() {
      const fetched = vi.fn((_url: string, _init: RequestInit) =>
        Promise.resolve(undefined)
      );
      vi.stubGlobal("fetch", fetched);
      const hold = (event: Event) => event.preventDefault();
      document.addEventListener("click", hold, true);
      document.addEventListener("auxclick", hold, true);
      return {
        fetched,
        release: () => {
          document.removeEventListener("click", hold, true);
          document.removeEventListener("auxclick", hold, true);
        },
      };
    }

    it("marks it read, in the collection the site installed, while it is still new", () => {
      const { fetched, release } = sent();
      try {
        drawCard("ready", { ...TWO_NEW, collection: "leads" });
        const card = screen.getByRole("region", {
          name: "New form submissions",
        });
        fireEvent.click(within(card).getByRole("link", { name: /Ana Ruiz/ }));
        expect(fetched).toHaveBeenCalledTimes(1);
        const [url, init] = fetched.mock.calls[0] ?? [];
        expect(url).toBe("/admin/api/collections/leads/entries");
        expect(init?.method).toBe("PATCH");
        expect(JSON.parse(String(init?.body))).toEqual({
          where: { id: { equals: "s1" }, status: { equals: "new" } },
          data: { status: "read" },
        });

        // A middle click opens it in a new tab, and marks it read too.
        fireEvent(
          within(card).getByRole("link", { name: /^Submission/ }),
          new MouseEvent("auxclick", { bubbles: true, button: 1 })
        );
        expect(fetched).toHaveBeenCalledTimes(2);
        expect(
          JSON.parse(String(fetched.mock.calls[1]?.[1].body))
        ).toMatchObject({ where: { id: { equals: "s2" } } });
      } finally {
        release();
      }
    });

    it("marks nothing for the footer's link or a click beside the rows", () => {
      const { fetched, release } = sent();
      try {
        drawCard("ready", TWO_NEW);
        const card = screen.getByRole("region", {
          name: "New form submissions",
        });
        const ana = within(card).getByRole("link", { name: /Ana Ruiz/ });
        fireEvent.click(within(card).getByRole("link", { name: /View all/ }));
        // Inside the list, beside a row's link rather than on it.
        const beside = ana.parentElement;
        expect(beside).not.toBeNull();
        expect(beside?.closest("a[href]")).toBeNull();
        if (beside !== null) fireEvent.click(beside);
        expect(fetched).not.toHaveBeenCalled();
        // The control: the same card does send one for a row.
        fireEvent.click(ana);
        expect(fetched).toHaveBeenCalledTimes(1);
      } finally {
        release();
      }
    });
  });
});
