/**
 * A Recent entries row links where the admin's one rule for opening a
 * document opens it, not to the form whatever the collection says.
 */
import { describe, expect, it } from "vitest";

import { documentAddress } from "@admin/lib/navigation/document-address";
import type { DocumentAddressOf } from "@admin/lib/navigation/useDocumentAddress";

import { recentEntriesModel } from "./recent-entries-model";

/** The shared rule over a collection that says its entries open in a view. */
const addressOf: DocumentAddressOf = (document, options = {}) =>
  documentAddress(
    document,
    {
      fields: [
        { name: "title", type: "text" },
        { name: "excerpt", type: "textarea" },
        { name: "sections", type: "blocks" },
      ],
      admin: { opensIn: "builder" },
    },
    { canUpdate: true, defaultLocale: "en", ...options },
    [{ fieldType: "blocks", path: "builder", component: "@acme/x#Builder" }]
  );

describe("a Recent entries row's link", () => {
  const model = recentEntriesModel(
    "notes",
    "title",
    [{ name: "title", label: "Title", type: "string" }],
    Date.now(),
    false,
    addressOf
  );

  it("opens where the collection says its entries open", () => {
    expect(model.hrefOf?.({ id: "n1", title: "A note" })).toBe(
      "/admin/collections/notes/n1/builder?field=sections"
    );
  });

  it("names no link for a row with no id", () => {
    expect(model.hrefOf?.({ title: "A note" })).toBeUndefined();
  });
});
