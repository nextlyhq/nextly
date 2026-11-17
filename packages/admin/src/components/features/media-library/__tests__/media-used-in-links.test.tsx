/**
 * A document listed as using a media item opens where the admin's one rule
 * for opening a document opens it, the same as from a list row: an entry of a
 * collection that opens in a view links to that view. An email template keeps
 * its own editor.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { documentAddress } from "@admin/lib/navigation/document-address";
import type { DocumentAddressOf } from "@admin/lib/navigation/useDocumentAddress";

import type { MediaUse } from "../media-library-api";

const addressOf: DocumentAddressOf = (document, options = {}) =>
  documentAddress(
    document,
    {
      fields: [
        { name: "title", type: "text" },
        { name: "sections", type: "blocks" },
      ],
      admin: { opensIn: "builder" },
    },
    { canUpdate: true, defaultLocale: "en", ...options },
    [{ fieldType: "blocks", path: "builder", component: "@acme/x#Builder" }]
  );

vi.mock("@admin/lib/navigation/useDocumentAddress", () => ({
  useDocumentAddress: () => addressOf,
}));

import { MediaUsageList } from "../MediaUsedIn";

function use(overrides: Partial<MediaUse>): MediaUse {
  return {
    kind: "collection",
    slug: "notes",
    documentId: "n1",
    title: "A note",
    owner: "Notes",
    fields: [
      {
        path: "sections",
        locales: [],
        byAddress: false,
        showsPreviousFile: false,
      },
    ],
    ...overrides,
  };
}

describe("where a media item's uses lead", () => {
  it("opens an entry where its collection opens entries, and a template at its editor", () => {
    render(
      <MediaUsageList
        usage={{
          items: [
            use({}),
            use({
              kind: "email-template",
              slug: "",
              documentId: "t1",
              title: "Welcome email",
              owner: "Email templates",
            }),
          ],
          hidden: 0,
          total: 2,
          hasNext: false,
          heldByAddress: 0,
          usageRecorded: true,
        }}
      />
    );
    expect(screen.getByRole("link", { name: /A note/ })).toHaveAttribute(
      "href",
      "/admin/collections/notes/n1/builder?field=sections"
    );
    expect(
      screen.getByRole("link", { name: /Welcome email/ }).getAttribute("href")
    ).toMatch(/t1/);
  });
});
