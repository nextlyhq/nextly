/**
 * Where the Single editor draws each part of the Single, top to bottom: the
 * trail in the admin's top bar; one document bar across the editor; the
 * Single's banners under it, in the entry editor's order; then the title, with
 * no slug line under it.
 *
 * Each banner is stood in for by a marker, so the order is read from the DOM
 * the editor builds. The past-version banner is drawn by the version body in
 * the place the editor hands it, and where the body is otherwise.
 */
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
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
vi.mock(
  "@admin/components/features/entries/EntryForm/DocumentLockBanner",
  () => ({ DocumentLockBanner: () => <p>lock banner</p> })
);
vi.mock(
  "@admin/components/features/entries/EntryForm/AutosaveRecoveryBanner",
  () => ({ LiveDocumentRecoveryOffer: () => <p>recovery banner</p> })
);
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

import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "../SingleForm";

const schema = {
  slug: "homepage",
  label: "Homepage",
  status: true,
  fields: [
    { type: "text", name: "title", label: "Title" },
    { type: "text", name: "slug", label: "Slug" },
    { type: "text", name: "heroTitle", label: "Hero Title" },
  ],
} as unknown as SingleSchema;

// An id unlike the slug, so the document's id shown for copying is not
// mistaken for a slug line.
const document = {
  id: "s1",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
  slug: "homepage",
  heroTitle: "",
  status: "published",
} as unknown as SingleDocumentData;

function renderEditor() {
  return render(
    <HeaderTrailProvider>
      <HeaderTrail />
      <SingleForm
        schema={schema}
        document={document}
        onSubmit={vi.fn()}
        documentBanner={<p>scheduled banner</p>}
      />
    </HeaderTrailProvider>
  );
}

const follows = (a: Node, b: Node): boolean =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe("the Single editor's layout", () => {
  it("puts its place in the top bar: Content, Singles, then the Single", () => {
    renderEditor();
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(trail).toHaveTextContent(/Content.*Singles.*Homepage/);
  });

  it("draws one sticky document bar above the field column", () => {
    renderEditor();
    const bars = screen.getAllByTestId("document-bar");
    expect(bars).toHaveLength(1);
    expect(bars[0]!.className).toMatch(/(^|\s)sticky(\s|$)/);
    expect(bars[0]!.contains(screen.getByLabelText("Title"))).toBe(false);
    expect(follows(bars[0]!, screen.getByLabelText("Title"))).toBe(true);
  });

  it("draws the banners under the bar in the entry editor's order, then the title", () => {
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
  });

  it("shows no slug line under the title", () => {
    renderEditor();
    expect(screen.getByLabelText("Title")).toHaveValue("Homepage");
    expect(screen.queryByText("homepage")).not.toBeInTheDocument();
    expect(screen.queryByText(/slug:/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit slug" })
    ).not.toBeInTheDocument();
  });

  it("shows the status once, in the bar", () => {
    window.localStorage.setItem("nextly:admin:entry-rail-collapsed", "1");
    renderEditor();
    const pills = screen.getAllByText("Published");
    expect(pills).toHaveLength(1);
    expect(screen.getByTestId("document-bar").contains(pills[0]!)).toBe(true);
  });
});
