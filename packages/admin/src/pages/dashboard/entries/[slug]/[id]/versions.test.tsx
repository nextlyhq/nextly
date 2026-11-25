/**
 * An entry's comparison page is told about its collection by the schema the
 * editor reads too: whether the collection is translated, which decides the
 * Languages choice, and the name its list goes by, which leads the trail.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render } from "@admin/__tests__/utils";

const { schema, comparePageProps } = vi.hoisted(() => ({
  schema: vi.fn(),
  comparePageProps: vi.fn(),
}));

vi.mock("@admin/components/features/versions/useVersionDocumentTitle", () => ({
  useVersionDocumentTitle: () => "Launch notes",
}));
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useCollectionSchema: () => schema(),
}));
vi.mock("@admin/components/features/versions/VersionComparePage", () => ({
  VersionComparePage: (props: Record<string, unknown>) => {
    comparePageProps(props);
    return null;
  },
}));

import EntryVersionsPage from "./versions";

function renderPage() {
  render(
    <EntryVersionsPage params={{ slug: "posts", id: "e1" }} searchParams={{}} />
  );
  return comparePageProps.mock.lastCall?.[0] as Record<string, unknown>;
}

describe("an entry's comparison page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is told the collection is translated, and leads the trail with its list", () => {
    schema.mockReturnValue({
      data: { localized: true, labels: { singular: "Post", plural: "Posts" } },
    });

    expect(renderPage()).toMatchObject({
      entityLocalized: true,
      listCrumb: { label: "Posts", href: "/admin/collections/posts" },
    });
  });

  it("is told a collection that says nothing of languages is not translated", () => {
    schema.mockReturnValue({ data: { labels: { plural: "Posts" } } });

    expect(renderPage()).toMatchObject({ entityLocalized: false });
  });

  it("leads the trail with the collection's slug until its schema arrives", () => {
    schema.mockReturnValue({ data: undefined });

    expect(renderPage()).toMatchObject({
      entityLocalized: false,
      listCrumb: { label: "posts", href: "/admin/collections/posts" },
    });
  });
});
