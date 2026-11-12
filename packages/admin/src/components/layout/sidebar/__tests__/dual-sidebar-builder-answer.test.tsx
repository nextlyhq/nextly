/**
 * The desktop rail offers the schema builder exactly as the server answers, with every other
 * answer in.
 *
 * The server answers `false` in production, whatever the app's configuration says, and the admin
 * cannot tell production for itself (its copy of `NODE_ENV` was folded at package build), so this
 * covers what a production admin is drawn: no Builders entry, and the Content entry that leads to
 * the entries still there. Entry editing is unaffected.
 */
import { render } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminCapabilities } from "@admin/types/permissions";

/** The server's answer for this render. */
let showBuilder: boolean;

/** Every answer in, as the settled-rail test's last state has them. */
const answers = {
  workspacePending: false,
  permissionsLoading: false,
  contentLoading: false,
};

const EVERYTHING: Partial<AdminCapabilities> = {
  isSuperAdmin: true,
  canViewCollections: true,
  canViewMedia: true,
  canViewSettings: true,
  canManageSettings: true,
  collections: {},
};

/** What the content answer says once in: the reader may read Posts. */
const CONTENT_ANSWER = { posts: { canRead: true } };

vi.mock("@nextlyhq/ui", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: () => null,
  // The rail's neutral shapes for entries not decided yet.
  Skeleton: () => <span data-testid="skeleton" />,
}));
vi.mock("@admin/components/shared/ThemeAwareLogo", () => ({
  ThemeAwareLogo: () => null,
}));
vi.mock("@admin/components/ui/link", () => ({
  Link: ({
    children,
    href,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("../SubSidebarPanel", () => ({ SubSidebarPanel: () => null }));
// The rail's foot (Inbox and account menu) has its own tests; these read the
// rail's entries.
vi.mock("../RailAccount", () => ({ RailAccount: () => null }));
vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({ pathname: "/admin", route: null, isHydrated: true }),
}));
vi.mock("@admin/hooks/useSidebarNavigation", () => ({
  useSidebarNavigation: () => ({ isActive: () => false }),
}));
vi.mock("@admin/context/providers/MediaProvider", () => ({
  useMediaContext: () => ({ isFolderTreeVisible: false }),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [], showBuilder }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    capabilities: {
      ...(answers.permissionsLoading ? {} : EVERYTHING),
      canViewCollections: !answers.contentLoading,
      collections: answers.contentLoading ? {} : CONTENT_ANSWER,
    },
    permissions: answers.permissionsLoading ? [] : ["read-media"],
    hasPermission: () => !answers.permissionsLoading,
    isLoading: answers.permissionsLoading,
    error: null,
    content: { isLoading: answers.contentLoading },
  }),
}));
// The Content panel's lists, which the rail reads only to keep the menu on
// the device: nothing in these tests asks for them.
vi.mock("@admin/hooks/useSidebarContentLists", () => ({
  useSidebarCollectionList: () => ({ items: [], data: undefined }),
  useSidebarSingleList: () => ({ items: [], hasArrived: false }),
}));
vi.mock("@admin/hooks/queries", () => ({
  NAV_COLLECTIONS_PARAMS: {},
  NAV_SINGLES_PARAMS: {},
  useCollections: () => ({
    data: answers.contentLoading
      ? undefined
      : { items: [{ name: "posts", admin: {} }] },
    isLoading: answers.contentLoading,
    isError: false,
  }),
  useSingles: () => ({
    data: answers.contentLoading ? undefined : { items: [] },
    isLoading: answers.contentLoading,
    isError: false,
  }),
}));

import { DualSidebar } from "../DualSidebar";

const railLabels = () =>
  Array.from(
    document.querySelectorAll("aside nav [aria-label]"),
    node => node.getAttribute("aria-label") ?? ""
  );

afterEach(() => {
  vi.clearAllMocks();
});

describe("DualSidebar's rail and the server's builder answer", () => {
  // The positive control: the rail does draw Builders, so its absence below is the rail's
  // decision and not a selector that finds nothing.
  it("draws Builders where the server says the builder is on", () => {
    showBuilder = true;
    render(<DualSidebar />);
    expect(railLabels()).toEqual(
      expect.arrayContaining(["Content", "Builders"])
    );
  });

  it("draws no Builders entry where the server says it is off, as in production, and keeps Content", () => {
    showBuilder = false;
    render(<DualSidebar />);
    const labels = railLabels();
    expect(labels).toContain("Content");
    expect(labels).not.toContain("Builders");
  });
});
