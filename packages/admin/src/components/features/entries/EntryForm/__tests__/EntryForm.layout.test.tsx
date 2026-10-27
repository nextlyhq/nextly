/**
 * Where the entry editor draws each part of a document, top to bottom: the
 * trail in the admin's top bar; one document bar across the editor, field
 * column and panel alike; the document's banners under it in one order; then
 * the title, with the slug under it.
 *
 * Each banner is stood in for by a marker, so the order is read from the DOM
 * the editor actually builds rather than from what each banner decides to
 * show. The past-version banner is drawn by the version body, which the editor
 * hands the place to draw it in; the stand-in draws there when given one, and
 * where the body is otherwise.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, createTestQueryClient, screen } from "@admin/__tests__/utils";
import {
  HeaderTrail,
  HeaderTrailProvider,
} from "@admin/components/layout/header/HeaderTrail";

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({
  useDocumentLock: () => ({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  }),
}));
vi.mock("@admin/hooks/useAutosaveRecovery", () => ({
  useAutosaveRecovery: () => ({
    offer: null,
    isResolved: true,
    dismiss: () => {},
    restore: () => {},
  }),
}));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: () => ({ status: "idle", lastSavedAt: null }),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => true,
}));
// The banners, as markers drawn whatever the document's state.
vi.mock("../DocumentLockBanner", () => ({
  DocumentLockBanner: () => <p>lock banner</p>,
}));
vi.mock("../AutosaveRecoveryBanner", () => ({
  LiveDocumentRecoveryOffer: () => <p>recovery banner</p>,
}));
vi.mock(
  "@admin/components/features/versions/viewed-version-host",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("@admin/components/features/versions/viewed-version-host")
    >()),
    ViewedVersionBody: ({
      children,
      bannerSlot,
    }: {
      children?: ReactNode;
      bannerSlot?: HTMLElement | null;
    }) => {
      const banner = <p>version banner</p>;
      return (
        <>
          {bannerSlot ? createPortal(banner, bannerSlot) : banner}
          {children}
        </>
      );
    },
  })
);

import { EntryForm } from "../EntryForm";

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>
        <HeaderTrailProvider>
          <HeaderTrail />
          {children}
        </HeaderTrailProvider>
      </ShortcutProvider>
    </QueryClientProvider>
  );
}

const posts = {
  name: "posts",
  label: "Posts",
  labels: { singular: "Post", plural: "Posts" },
  status: true,
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "slug", type: "text", label: "Slug" },
    { name: "body", type: "text", label: "Body" },
  ],
} as never;

const entry = {
  id: "p1",
  title: "Hello world",
  slug: "hello-world",
  body: "",
  status: "published",
} as never;

function renderEditor() {
  return render(
    <EntryForm
      collection={posts}
      entry={entry}
      mode="edit"
      documentBanner={<p>scheduled banner</p>}
    />,
    { wrapper: Providers }
  );
}

const follows = (a: Node, b: Node): boolean =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the entry editor's layout", () => {
  it("puts its place in the top bar, where the one link to its list is", () => {
    renderEditor();
    const toList = screen
      .getAllByRole("link")
      .filter(link => link.getAttribute("href") === "/admin/collections/posts");
    expect(toList).toHaveLength(1);
    expect(toList[0]?.closest("nav")).toHaveAttribute(
      "aria-label",
      "Breadcrumb"
    );
    expect(screen.getByText("Hello world")).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("draws one sticky document bar across the field column and the panel", () => {
    renderEditor();
    const bars = screen.getAllByTestId("document-bar");
    expect(bars).toHaveLength(1);
    const bar = bars[0]!;
    expect(bar.className).toMatch(/(^|\s)sticky(\s|$)/);
    expect(bar.className).toMatch(/(^|\s)top-0(\s|$)/);

    // Not inside the field column, but above both it and the panel.
    const column = screen
      .getByLabelText("Title")
      .closest<HTMLElement>("[style*='max-width']");
    expect(column).not.toBeNull();
    expect(column!.contains(bar)).toBe(false);
    const editor = bar.parentElement!;
    expect(editor.contains(column)).toBe(true);
    expect(editor.contains(screen.getByText("Created"))).toBe(true);
    expect(follows(bar, column!)).toBe(true);
  });

  it("draws the banners under the bar in one order, then the title", () => {
    renderEditor();
    const order = [
      screen.getByTestId("document-bar"),
      screen.getByText("scheduled banner"),
      screen.getByText("lock banner"),
      screen.getByText("recovery banner"),
      screen.getByText("version banner"),
      screen.getByLabelText("Title"),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(follows(order[i - 1]!, order[i]!)).toBe(true);
    }
    // Outside the field column, as wide as the bar above them.
    const column = screen
      .getByLabelText("Title")
      .closest("[style*='max-width']")!;
    expect(column.contains(screen.getByText("scheduled banner"))).toBe(false);
    expect(column.contains(screen.getByText("version banner"))).toBe(false);
  });

  it("shows the title first and the slug on the line under it", () => {
    renderEditor();
    const title = screen.getByLabelText("Title");
    const slugs = screen.getAllByText("hello-world");
    expect(slugs).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Edit slug" })).toHaveLength(
      1
    );
    expect(follows(title, slugs[0]!)).toBe(true);
    // Nothing of the document between the banners and the title.
    expect(follows(screen.getByText("version banner"), title)).toBe(true);
  });

  it("shows the status once, in the bar", () => {
    // The panel folded away, so what is counted is the editor's own chrome.
    window.localStorage.setItem("nextly:admin:entry-rail-collapsed", "1");
    renderEditor();
    const pills = screen.getAllByText("Published");
    expect(pills).toHaveLength(1);
    expect(screen.getByTestId("document-bar").contains(pills[0]!)).toBe(true);
  });
});
