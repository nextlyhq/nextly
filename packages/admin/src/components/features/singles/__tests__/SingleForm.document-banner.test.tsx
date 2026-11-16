/**
 * A strip about the whole Single, such as the scheduled-release banner, is
 * drawn first among the document's banners, directly under its document bar.
 *
 * The editor's frame pulls itself up over the page's top inset so its bar
 * reaches the panel's edge. A banner the page placed before the form sat in
 * that inset, and the sticky bar slid over it. Following the bar inside the
 * frame the bar sticks in is the property that keeps the two from
 * overlapping: anything before that frame is under the pull.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

vi.mock(
  "@admin/components/features/entries/EntryForm/DocumentViewBody",
  () => ({
    DocumentViewBody: ({ banner }: { banner?: unknown }) => (
      <div data-testid="document-view">{banner as never}</div>
    ),
  })
);
vi.mock("@admin/components/features/entries/EntryForm/DocumentBar", () => ({
  DocumentBar: () => <div data-testid="document-bar" />,
}));

import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "../SingleForm";

const schema = {
  slug: "homepage",
  label: "Homepage",
  // A slug, so the strip that shows it is drawn: the banner belongs above it,
  // with nothing between it and the header.
  fields: [
    { type: "text", name: "title", label: "Title" },
    { type: "text", name: "slug", label: "Slug" },
  ],
} as unknown as SingleSchema;
const document = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
  slug: "homepage",
} as unknown as SingleDocumentData;

describe("the Single editor's document banner", () => {
  it("is drawn first under the document bar", () => {
    render(
      <SingleForm
        schema={schema}
        document={document}
        onSubmit={vi.fn()}
        documentBanner={<p>Scheduled for Friday</p>}
      />
    );

    // First among the banners, and the banners directly after the bar, in
    // the frame the bar sticks in: nothing sits between them, and nothing of
    // the editor is drawn above the bar for the banner to slide under.
    const bar = screen.getByTestId("document-bar");
    const banner = screen.getByText("Scheduled for Friday");
    const banners = screen.getByTestId("document-banners");
    expect(bar.nextElementSibling).toBe(banners);
    expect(banners.firstElementChild).toBe(banner);
  });

  it("is drawn inside a document view's frame, which has no header of its own", () => {
    render(
      <SingleForm
        schema={schema}
        document={document}
        onSubmit={vi.fn()}
        documentView={{ component: "pages-builder", onExit: vi.fn() }}
        documentBanner={<p>Scheduled for Friday</p>}
      />
    );

    // Inside the view's own frame, which shares the screen between its banners
    // and the view, rather than above a view already the screen's height.
    expect(screen.getByTestId("document-view")).toContainElement(
      screen.getByText("Scheduled for Friday")
    );
  });
});
