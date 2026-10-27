/**
 * The collections and Singles landing pages wait on the server's answer about
 * what the user may do, and say so when it could not be had, rather than
 * reading the empty list filtered through no answer as an empty install.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCollections } from "@admin/hooks/queries/useCollections";
import { useSingles } from "@admin/hooks/queries/useSingles";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";

import CollectionsLandingRedirect from "../CollectionsLandingRedirect";
import SinglesLandingRedirect from "../SinglesLandingRedirect";

vi.mock("@admin/hooks/queries/useCollections", () => ({
  useCollections: vi.fn(),
}));
vi.mock("@admin/hooks/queries/useSingles", () => ({ useSingles: vi.fn() }));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: vi.fn(),
}));
vi.mock("@admin/hooks/useSidebarPins", () => ({
  useSidebarPins: () => ({ pinned: [] }),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({}),
}));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("@admin/components/features/dashboard/EmptyEntitiesState", () => ({
  EmptyEntitiesState: ({ type }: { type: string }) => <p>no {type} yet</p>,
}));

/** The hook's answer about content, with no entity the user may read. */
function answering(content: {
  isLoading?: boolean;
  hasAnswer?: boolean;
  error?: Error;
}) {
  vi.mocked(useCurrentUserPermissions).mockReturnValue({
    capabilities: { collections: {}, canViewCollections: false },
    content: {
      isLoading: content.isLoading ?? false,
      hasAnswer: content.hasAnswer ?? true,
      error: content.error ?? null,
    },
    retry: vi.fn(),
  } as unknown as ReturnType<typeof useCurrentUserPermissions>);
}

const PAGES = [
  {
    name: "the collections landing page",
    Page: CollectionsLandingRedirect,
    empty: "no collection yet",
  },
  {
    name: "the Singles landing page",
    Page: SinglesLandingRedirect,
    empty: "no single yet",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  const listing = {
    data: { items: [{ name: "posts", slug: "posts" }] },
    isLoading: false,
  };
  vi.mocked(useCollections).mockReturnValue(
    listing as unknown as ReturnType<typeof useCollections>
  );
  vi.mocked(useSingles).mockReturnValue(
    listing as unknown as ReturnType<typeof useSingles>
  );
});

describe.each(PAGES)("$name", ({ Page, empty }) => {
  it("claims nothing while the answer about what the user may do is in flight", () => {
    answering({ isLoading: true, hasAnswer: false });
    render(<Page />);
    expect(screen.queryByText(empty)).toBeNull();
  });

  it("says the access check failed rather than that there is nothing", () => {
    answering({ hasAnswer: false, error: new Error("Request failed") });
    render(<Page />);
    expect(screen.getByText("Couldn't check your access")).toBeTruthy();
    expect(screen.queryByText(empty)).toBeNull();
  });

  it("says there is nothing once the answer says the user may read none", () => {
    // POPULATION CONTROL: with an answer in hand, the empty state stands.
    answering({});
    render(<Page />);
    expect(screen.getByText(empty)).toBeTruthy();
  });
});
