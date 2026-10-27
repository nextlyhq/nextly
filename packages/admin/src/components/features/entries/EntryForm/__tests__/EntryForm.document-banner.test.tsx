/**
 * A strip about the whole document, such as the scheduled-release banner, is
 * drawn inside the editor's column, directly under its header.
 *
 * The editor's row pulls itself up over the page's top inset so its columns
 * reach the panel's edge. A banner the page placed before the form sat in that
 * inset, and the sticky header slid over it. Sharing the header's parent is the
 * property that keeps the two from overlapping: anything outside that column is
 * under the pull.
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
vi.mock(
  "@admin/components/features/entries/EntryForm/EntrySystemHeader",
  () => ({ EntrySystemHeader: () => <div data-testid="system-header" /> })
);

import { EntryForm } from "../EntryForm";

const entry = { id: "e1", title: "Hello" } as never;
const collection = {
  name: "posts",
  label: "Posts",
  fields: [{ name: "title", type: "text", label: "Title" }],
} as never;

describe("the entry editor's document banner", () => {
  it("is drawn in the editor's column, right after the header", () => {
    render(
      <EntryForm
        collection={collection}
        entry={entry}
        mode="edit"
        documentBanner={<p>Scheduled for Friday</p>}
      />
    );

    const header = screen.getByTestId("system-header");
    const banner = screen.getByText("Scheduled for Friday");
    expect(banner.parentElement).toBe(header.parentElement);
    expect(header.nextElementSibling).toBe(banner);
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
