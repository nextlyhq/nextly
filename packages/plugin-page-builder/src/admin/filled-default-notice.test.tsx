// @vitest-environment jsdom
/**
 * The notice an author gets when the header (or footer) they published now
 * fills the site default, as the admin draws it: both lines, word for word,
 * and "Change in Header & footer" opening the list of sets. And when the
 * screen asks for it: once the component is live with nothing unpublished,
 * never for any other document.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FillNoticesResult } from "../default-layout/fill-notice-contract";

type Status = { status: string; hasWorkingDraft: boolean } | null;
let status: Status = null;
const writes: Array<{ path: string }> = [];
let answer: { item?: FillNoticesResult } | undefined;
const navigateTo = vi.fn();

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  navigateTo: (href: string) => navigateTo(href),
  useDocumentStatus: () => status,
  writePluginRoute: async (write: { path: string }) => {
    writes.push(write);
    return answer;
  },
}));

// The toaster follows the system theme, which jsdom cannot answer.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

const { Toaster } = await import("@nextlyhq/ui");
const { showFillNotices, useFilledDefaultNotice } = await import(
  "./filled-default-notice"
);

const SETS = "/admin/collections/layouts";

const filled = (
  area: "header" | "footer",
  title: string
): FillNoticesResult => ({
  fills: [{ area, component: { id: `${area}-1`, title } }],
  setsAddress: SETS,
});

function Screen({ isComponent }: { isComponent: boolean }) {
  useFilledDefaultNotice(isComponent ? "component" : "page");
  return null;
}

beforeEach(() => {
  status = null;
  writes.length = 0;
  answer = undefined;
  navigateTo.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("the notice that a first header now fills the default", () => {
  it("says the header now shows on every page, that pages with their own keep theirs, and links to the sets", async () => {
    render(<Toaster />);
    act(() => showFillNotices(filled("header", "Acme header")));
    expect(
      await screen.findByText("Acme header now shows on every page.")
    ).toBeTruthy();
    expect(
      screen.getByText("Pages that chose a different header keep theirs.")
    ).toBeTruthy();
    // A click alone: the toast's swipe handling asks for pointer capture,
    // which jsdom does not have.
    fireEvent.click(
      screen.getByRole("button", { name: "Change in Header & footer" })
    );
    expect(navigateTo).toHaveBeenCalledWith(SETS);
  });

  it("says footer for a footer", async () => {
    render(<Toaster />);
    act(() => showFillNotices(filled("footer", "Acme footer")));
    expect(
      await screen.findByText("Acme footer now shows on every page.")
    ).toBeTruthy();
    expect(
      screen.getByText("Pages that chose a different footer keep theirs.")
    ).toBeTruthy();
  });

  it("asks once the component is live with nothing unpublished, and says what it is answered", async () => {
    status = { status: "draft", hasWorkingDraft: false };
    const view = render(
      <>
        <Toaster />
        <Screen isComponent />
      </>
    );
    expect(writes).toEqual([]);

    // The publish lands.
    answer = { item: filled("header", "Acme header") };
    status = { status: "published", hasWorkingDraft: false };
    view.rerender(
      <>
        <Toaster />
        <Screen isComponent />
      </>
    );
    expect(
      await screen.findByText("Acme header now shows on every page.")
    ).toBeTruthy();
    expect(writes).toEqual([
      expect.objectContaining({ path: "/default-layout/fill-notices" }),
    ]);

    // An edit not yet published, then its publish: asked again, told
    // nothing new.
    answer = { item: { fills: [], setsAddress: SETS } };
    status = { status: "published", hasWorkingDraft: true };
    view.rerender(
      <>
        <Toaster />
        <Screen isComponent />
      </>
    );
    status = { status: "published", hasWorkingDraft: false };
    view.rerender(
      <>
        <Toaster />
        <Screen isComponent />
      </>
    );
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(
      screen.getAllByText("Acme header now shows on every page.")
    ).toHaveLength(1);
  });

  it("never asks for a page", () => {
    status = { status: "published", hasWorkingDraft: false };
    render(<Screen isComponent={false} />);
    expect(writes).toEqual([]);
  });
});
