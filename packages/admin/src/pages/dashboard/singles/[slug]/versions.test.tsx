/**
 * A Single's comparison page honours the language its address names, as an
 * entry's does: a link shared from the German history opens under the German
 * title.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render } from "@admin/__tests__/utils";

const { useVersionDocumentTitle } = vi.hoisted(() => ({
  useVersionDocumentTitle: vi.fn(() => "Homepage"),
}));

vi.mock("@admin/components/features/versions/useVersionDocumentTitle", () => ({
  useVersionDocumentTitle,
}));
vi.mock("@admin/hooks/queries/useSingles", () => ({
  useSingleDocument: () => ({ data: { id: "homepage" }, isError: false }),
}));
vi.mock("@admin/components/features/versions/VersionComparePage", () => ({
  VersionComparePage: () => null,
}));

import SingleVersionsPage from "./versions";

describe("a Single's comparison page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("titles the page in the language its address names", () => {
    render(
      <SingleVersionsPage
        params={{ slug: "homepage" }}
        searchParams={{ locale: "de", from: "1", to: "2" }}
      />
    );

    expect(useVersionDocumentTitle).toHaveBeenCalledWith(
      { kind: "single", slug: "homepage" },
      "de"
    );
  });

  it("names no language when the address names none", () => {
    render(
      <SingleVersionsPage params={{ slug: "homepage" }} searchParams={{}} />
    );

    expect(useVersionDocumentTitle).toHaveBeenCalledWith(
      { kind: "single", slug: "homepage" },
      undefined
    );
  });
});
