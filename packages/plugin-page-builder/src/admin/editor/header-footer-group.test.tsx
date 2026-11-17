// @vitest-environment jsdom
/**
 * The Pages panel's "Header & footer" group, as an author meets it: a row
 * per set with its picture, name and note, the site default marked, "+ New
 * header & footer" last, folding, and hidden from an author who may not read
 * sets.
 */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayoutChoicesResponse } from "../../layout-choices-contract";
import type { LayoutPageCountsResponse } from "../../layout-counts-contract";

interface RouteRead {
  plugin: string;
  path: string;
}
const routeReads: RouteRead[] = [];
let choices: { data?: unknown; error?: unknown } = {};
let counts: { data?: unknown; error?: unknown } = {};

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: (read: RouteRead) => {
    routeReads.push(read);
    const answer = read.path.startsWith("/layouts/counts") ? counts : choices;
    return {
      data: answer.data,
      error: answer.error ?? null,
      pending: answer.data === undefined && answer.error === undefined,
      fetching: false,
      refetch: () => {},
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

const { HeaderFooterGroup } = await import("./header-footer-group");

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
        canUpdateLayouts: true,
        more: false,
        matched: items.map(item => item.id),
        regionComponents: {},
        regionDefinitions: {},
      },
    } as unknown as LayoutChoicesResponse,
  };
}

const folds = { folded: new Set<string>(), onFold: vi.fn() };

beforeEach(() => {
  routeReads.length = 0;
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
