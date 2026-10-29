/**
 * The rail draws its settled entries, and only those, while the answers that decide it arrive.
 *
 * The rule itself is covered in `settled-rail.test.ts`; this covers the seam that file cannot
 * reach: whether the sidebar DRAWS by that rule. A sidebar that computed the settled entries and
 * went on drawing every entry it shows while loading would leave every rule test green.
 */
import { render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminCapabilities } from "@admin/types/permissions";

interface Answers {
  workspacePending: boolean;
  permissionsLoading: boolean;
  contentLoading: boolean;
}

let answers: Answers;

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
  useBranding: () =>
    answers.workspacePending ? {} : { plugins: [], showBuilder: false },
  useBrandingStatus: () => ({
    isPending: answers.workspacePending,
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

describe("DualSidebar's rail while its answers arrive", () => {
  it("draws every entry the reader has once every answer is in", () => {
    answers = {
      workspacePending: false,
      permissionsLoading: false,
      contentLoading: false,
    };
    render(<DualSidebar />);
    // The positive control: the entries the waiting cases below must hold back are drawn here.
    expect(railLabels()).toEqual(
      expect.arrayContaining([
        "Dashboard",
        "Content",
        "Media Library",
        "Translations",
        "Settings",
      ])
    );
  });

  it("draws only Dashboard while the content answer is pending", () => {
    answers = {
      workspacePending: false,
      permissionsLoading: false,
      contentLoading: true,
    };
    render(<DualSidebar />);
    expect(railLabels()).toEqual(["Dashboard"]);
  });

  it("draws up to the first entry the permissions decide while they load", () => {
    answers = {
      workspacePending: false,
      permissionsLoading: true,
      contentLoading: false,
    };
    render(<DualSidebar />);
    // Media and Settings show while the grants load, by the rail's visibility rule; they are
    // still not drawn, since an answer that refuses them would take them back.
    expect(railLabels()).toEqual(["Dashboard", "Content"]);
    expect(screen.queryByLabelText("Media Library")).not.toBeInTheDocument();
  });

  it("marks the rail settled only once every answer it waits on is in", () => {
    const marker = () =>
      document.querySelector("aside")?.getAttribute("data-shell-answers");
    for (const waiting of [
      {
        workspacePending: true,
        permissionsLoading: false,
        contentLoading: false,
      },
      {
        workspacePending: false,
        permissionsLoading: true,
        contentLoading: false,
      },
      {
        workspacePending: false,
        permissionsLoading: false,
        contentLoading: true,
      },
    ]) {
      answers = waiting;
      const { unmount } = render(<DualSidebar />);
      expect(marker()).toBe("pending");
      unmount();
    }
    answers = {
      workspacePending: false,
      permissionsLoading: false,
      contentLoading: false,
    };
    render(<DualSidebar />);
    expect(marker()).toBe("settled");
  });
});
