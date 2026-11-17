/**
 * A release's document opens where the admin's one rule for opening a
 * document opens it, the same as from a list row: an entry of a collection
 * that opens in a view links to that view, and a Single to its page.
 */
import { describe, expect, it } from "vitest";

import { documentAddress } from "@admin/lib/navigation/document-address";
import type { DocumentAddressOf } from "@admin/lib/navigation/useDocumentAddress";
import type { ReleaseMember } from "@admin/types/releases";

import { documentHref } from "../ReleaseDocuments";

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

function member(overrides: Partial<ReleaseMember>): ReleaseMember {
  return {
    id: "m1",
    releaseId: "r1",
    scopeKind: "collection",
    scopeSlug: "notes",
    entryId: "n1",
    locale: null,
    action: "publish",
    createdBy: null,
    createdAt: "2026-11-17T00:00:00.000Z",
    ...overrides,
  } as ReleaseMember;
}

describe("where a release's document leads", () => {
  it("opens an entry where its collection opens entries", () => {
    expect(documentHref(member({}), addressOf)).toBe(
      "/admin/collections/notes/n1/builder?field=sections"
    );
  });

  it("opens a Single at its page", () => {
    expect(
      documentHref(
        member({ scopeKind: "single", scopeSlug: "homepage", entryId: "" }),
        addressOf
      )
    ).toBe("/admin/singles/homepage");
  });
});
