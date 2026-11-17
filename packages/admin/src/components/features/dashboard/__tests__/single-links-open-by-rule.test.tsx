/**
 * The sidebar opens a Single where the admin's one "open this document" rule
 * opens it, in its own Singles list and in a custom sidebar group alike: a
 * Homepage whose main field is a page layout in the Page Builder, a Single
 * whose first field is anything else as its form, and the form for a reader
 * who may only read it. The item stays marked current by its form's address,
 * which its views' addresses sit under.
 */
import { TooltipProvider } from "@nextlyhq/ui";
import { render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const title = { name: "title", type: "text" };
const layout = { name: "layout", type: "blocks" };

const lists = vi.hoisted(() => ({
  singles: [] as Array<Record<string, unknown>>,
  /** The Singles the reader may only read. */
  readOnly: new Set<string>(),
}));

vi.mock("@admin/hooks/useSidebarContentLists", () => ({
  useSidebarSingleList: () => ({
    items: lists.singles.filter(single => {
      const admin = single.admin as { sidebarGroup?: string } | undefined;
      return admin?.sidebarGroup === undefined;
    }),
    isLoading: false,
    isComplete: true,
    isPinned: () => false,
    togglePin: () => {},
  }),
}));
vi.mock("@admin/hooks/queries", () => ({
  NAV_COLLECTIONS_PARAMS: {},
  useCollections: () => ({ data: { items: [] } }),
}));
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useEveryNavCollection: () => ({ data: [] }),
}));
vi.mock("@admin/hooks/queries/useSingles", () => ({
  useSingles: () => ({ data: { items: lists.singles } }),
  useEverySingle: () => ({ data: lists.singles }),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ defaultLocale: "en" }),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({
    customGroups: [{ slug: "site", name: "Site" }],
    plugins: [
      {
        name: "@acme/builder",
        documentViews: [
          {
            fieldType: "blocks",
            path: "builder",
            component: "@acme/builder#View",
            opensFirst: "mainField",
          },
        ],
      },
    ],
  }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    capabilities: {
      collections: Object.fromEntries(
        lists.singles.map(single => [single.slug, { canRead: true }])
      ),
    },
    canAccessCollection: (slug: string, action: string) =>
      action !== "updateInDefaultLanguage" || !lists.readOnly.has(slug),
  }),
}));
vi.mock("@admin/components/ui/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@admin/components/layout/sidebar", () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <ul>{children}</ul>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
  SidebarMenuButton: ({
    children,
    isActive,
  }: {
    children: React.ReactNode;
    isActive?: boolean;
  }) => <span data-active={isActive === true}>{children}</span>,
  SidebarMenuAction: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  useSidebar: () => ({ state: "expanded", isMobile: false }),
}));

import { DynamicCustomGroupNav } from "../DynamicCustomGroupNav";
import { DynamicSingleNav } from "../DynamicSingleNav";

const HOMEPAGE = {
  id: "s1",
  slug: "homepage",
  label: "Homepage",
  fields: [title, layout],
};
const CONTACT = {
  id: "s2",
  slug: "contact",
  label: "Contact details",
  fields: [{ name: "email", type: "email" }, layout],
};
const BUILDER = "/admin/singles/homepage/builder?field=layout";

/** Draws a nav, current at `pathname` as the sidebar's own check reads it. */
function draw(nav: "singles" | "group", pathname = "/admin") {
  const isActive = (href?: string) =>
    href !== undefined &&
    (pathname === href || pathname.startsWith(`${href}/`));
  render(
    <TooltipProvider>
      <ul>
        {nav === "singles" ? (
          <DynamicSingleNav isActive={isActive} />
        ) : (
          <DynamicCustomGroupNav isActive={isActive} />
        )}
      </ul>
    </TooltipProvider>
  );
}

beforeEach(() => {
  lists.singles = [HOMEPAGE, CONTACT];
  lists.readOnly = new Set();
});

describe("the sidebar's Singles list", () => {
  it("opens a Homepage whose main field is a page layout in the builder", () => {
    draw("singles");
    expect(screen.getByRole("link", { name: /Homepage/ })).toHaveAttribute(
      "href",
      BUILDER
    );
  });

  it("opens a Single whose first field is anything else as its form", () => {
    draw("singles");
    expect(
      screen.getByRole("link", { name: /Contact details/ })
    ).toHaveAttribute("href", "/admin/singles/contact");
  });

  it("opens the form for a reader who may only read the Single", () => {
    lists.readOnly = new Set(["homepage"]);
    draw("singles");
    expect(screen.getByRole("link", { name: /Homepage/ })).toHaveAttribute(
      "href",
      "/admin/singles/homepage"
    );
  });

  it("marks the item current in the builder, by the form's address it sits under", () => {
    draw("singles", "/admin/singles/homepage/builder");
    expect(
      screen.getByRole("link", { name: /Homepage/ }).closest("[data-active]")
    ).toHaveAttribute("data-active", "true");
  });
});

describe("a Single in a custom sidebar group", () => {
  it("opens where the sidebar's own list opens it, and is marked current there", () => {
    lists.singles = [
      { ...HOMEPAGE, admin: { sidebarGroup: "site" } },
      { ...CONTACT, admin: { sidebarGroup: "site" } },
    ];
    draw("group", "/admin/singles/homepage/builder");
    const homepage = screen.getByRole("link", { name: /Homepage/ });
    expect(homepage).toHaveAttribute("href", BUILDER);
    expect(homepage.closest("[data-active]")).toHaveAttribute(
      "data-active",
      "true"
    );
    expect(
      screen.getByRole("link", { name: /Contact details/ })
    ).toHaveAttribute("href", "/admin/singles/contact");
  });
});
