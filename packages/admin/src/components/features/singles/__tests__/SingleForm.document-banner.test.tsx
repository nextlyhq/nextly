/**
 * A strip about the whole Single, such as the scheduled-release banner, is
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
  () => ({ DocumentViewBody: () => <div data-testid="document-view" /> })
);
vi.mock(
  "@admin/components/features/entries/EntryForm/EntrySystemHeader",
  () => ({ EntrySystemHeader: () => <div data-testid="system-header" /> })
);

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
  it("is drawn in the editor's column, right after the header", () => {
    render(
      <SingleForm
        schema={schema}
        document={document}
        onSubmit={vi.fn()}
        documentBanner={<p>Scheduled for Friday</p>}
      />
    );

    const header = screen.getByTestId("system-header");
    const banner = screen.getByText("Scheduled for Friday");
    expect(banner.parentElement).toBe(header.parentElement);
    expect(header.nextElementSibling).toBe(banner);
  });

  it("is drawn above a document view, which has no header of its own", () => {
    render(
      <SingleForm
        schema={schema}
        document={document}
        onSubmit={vi.fn()}
        documentView={{ component: "pages-builder", onExit: vi.fn() }}
        documentBanner={<p>Scheduled for Friday</p>}
      />
    );

    const view = screen.getByTestId("document-view");
    const banner = screen.getByText("Scheduled for Friday");
    expect(
      banner.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
