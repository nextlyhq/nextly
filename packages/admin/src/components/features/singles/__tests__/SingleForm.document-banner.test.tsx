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
  fields: [{ type: "text", name: "title", label: "Title" }],
} as unknown as SingleSchema;
const document = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
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
});
