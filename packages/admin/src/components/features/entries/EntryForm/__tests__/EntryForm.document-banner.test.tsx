/**
 * A strip about the whole document, such as the scheduled-release banner, is
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

import { EntryForm } from "../EntryForm";

const entry = { id: "e1", title: "Hello" } as never;
const collection = {
  name: "posts",
  label: "Posts",
  fields: [{ name: "title", type: "text", label: "Title" }],
} as never;

describe("the entry editor's document banner", () => {
  it("is drawn first under the document bar", () => {
    render(
      <EntryForm
        collection={collection}
        entry={entry}
        mode="edit"
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
      <EntryForm
        collection={collection}
        entry={entry}
        mode="edit"
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
