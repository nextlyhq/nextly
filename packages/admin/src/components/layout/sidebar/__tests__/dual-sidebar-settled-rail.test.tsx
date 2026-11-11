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

import type { LocalizationConfig } from "@admin/lib/localization";
import type { AdminCapabilities } from "@admin/types/permissions";

interface Answers {
  workspacePending: boolean;
  permissionsLoading: boolean;
  contentLoading: boolean;
}

let answers: Answers;

/** A localization config naming these locale codes, as admin-meta delivers it. */
const localesOf = (...codes: string[]): LocalizationConfig => ({
  defaultLocale: codes[0] ?? "en",
  fallback: true,
  locales: codes.map(code => ({
    code,
    label: code,
    rtl: false,
    fallbackLocale: [],
  })),
});

/** The site's locales once the workspace answer is in; two unless a case says otherwise. */
let siteLocales: LocalizationConfig = localesOf("en", "fr");

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
  useBranding: () =>
    answers.workspacePending
      ? {}
      : { plugins: [], showBuilder: false, locales: siteLocales },
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
  siteLocales = localesOf("en", "fr");
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

describe("the entries DualSidebar's rail offers", () => {
  const ALL_IN: Answers = {
    workspacePending: false,
    permissionsLoading: false,
    contentLoading: false,
  };

  it("offers Releases in the main menu, beside Media", () => {
    answers = ALL_IN;
    render(<DualSidebar />);
    const labels = railLabels();
    expect(labels).toContain("Releases");
    expect(labels.indexOf("Releases")).toBe(
      labels.indexOf("Media Library") + 1
    );
  });

  it("has no Email entry, which lives in the Settings panel", () => {
    answers = ALL_IN;
    render(<DualSidebar />);
    // The control: the rail is drawn, Settings among it.
    expect(railLabels()).toContain("Settings");
    expect(railLabels()).not.toContain("Email");
  });

  it.each([
    ["no localization", undefined],
    ["a single locale", localesOf("en")],
  ])("hides Translations on a site with %s", (_, locales) => {
    answers = ALL_IN;
    siteLocales = locales;
    render(<DualSidebar />);
    expect(railLabels()).not.toContain("Translations");
    // The control: the entries around it are still drawn.
    expect(railLabels()).toEqual(
      expect.arrayContaining(["Media Library", "Settings"])
    );
  });

  it("shows Translations on a site with two locales", () => {
    answers = ALL_IN;
    siteLocales = localesOf("en", "fr");
    render(<DualSidebar />);
    expect(railLabels()).toContain("Translations");
  });
});

describe("DualSidebar's rail under the keyboard", () => {
  // The rail's controls draw no browser outline, so a keyboard reader sees where focus is only
  // by the ring each control draws on :focus-visible. A control without it is invisible to Tab.
  const FOCUS_RING = [
    // Hides the outline only where the ring shows. Under forced colors, as in
    // Windows High Contrast, the ring's box shadow is not drawn, and this
    // utility draws a 2px outline there instead, in the system's colour.
    "focus-visible:outline-hidden",
    "focus-visible:ring-2",
    "focus-visible:ring-sidebar-ring",
    "focus-visible:ring-offset-2",
    "focus-visible:ring-offset-sidebar",
  ];

  it("draws a focus ring on the logo and on every rail entry", () => {
    answers = {
      workspacePending: false,
      permissionsLoading: false,
      contentLoading: false,
    };
    render(<DualSidebar />);
    const entries = Array.from(
      document.querySelectorAll<HTMLElement>("aside nav [aria-label]")
    );
    const logo = document.querySelector<HTMLElement>("aside > a");
    // Both kinds of entry are present, so a ring added to the link branch alone fails here.
    expect(entries.some(node => node.tagName === "A")).toBe(true);
    expect(entries.some(node => node.tagName === "BUTTON")).toBe(true);
    expect(logo).not.toBeNull();
    for (const control of [logo!, ...entries]) {
      for (const name of FOCUS_RING) {
        expect(
          control.classList.contains(name),
          `${name} on ${control.getAttribute("aria-label") ?? "the logo"}`
        ).toBe(true);
      }
      // `outline-none` removes the outline in every mode, forced colors
      // among them, where it would leave focus with nothing drawn at all.
      expect(control.classList.contains("outline-none")).toBe(false);
    }
  });
});
