import {
  Database,
  LayoutDashboard,
  ShieldAlert,
} from "@admin/components/icons";
import { ROUTES } from "@admin/constants/routes";
import type { PluginMetadata } from "@admin/types/branding";
import { describe, expect, it } from "vitest";

import { resolveItemHref } from "../lib/resolve-item-href";
import type { MainMenuItem } from "../sidebar-types";

const makeItem = (overrides: Partial<MainMenuItem>): MainMenuItem => ({
  id: "dashboard",
  label: "Dashboard",
  icon: LayoutDashboard,
  href: ROUTES.DASHBOARD,
  ...overrides,
});

describe("resolveItemHref", () => {
  it("routes the collections icon to the section landing page (Task 7 PR-6c)", () => {
    expect(
      resolveItemHref(
        makeItem({ id: "collections", label: "Collections", href: "#" }),
        []
      )
    ).toBe(ROUTES.COLLECTIONS);
  });

  it("routes the singles icon to the section landing page (Task 7 PR-6c)", () => {
    expect(
      resolveItemHref(
        makeItem({ id: "singles", label: "Singles", href: "#" }),
        []
      )
    ).toBe(ROUTES.SINGLES);
  });

  it("keeps the plugins icon as a sub-sidebar opener (no landing page)", () => {
    expect(
      resolveItemHref(
        makeItem({ id: "plugins", label: "Plugins", href: "#" }),
        []
      )
    ).toBe("#");
  });

  it("returns the item's own href for non-categorical items (e.g. builders)", () => {
    expect(
      resolveItemHref(
        makeItem({
          id: "builders",
          label: "Builders",
          href: ROUTES.BUILDER_COLLECTIONS,
          icon: ShieldAlert,
        }),
        []
      )
    ).toBe(ROUTES.BUILDER_COLLECTIONS);
  });

  it("routes a standalone plugin icon to its first registered collection", () => {
    const plugins: PluginMetadata[] = [
      {
        name: "Form Builder",
        collections: ["forms", "submissions"],
        appearance: { icon: "Database" },
      },
    ];
    expect(
      resolveItemHref(
        makeItem({
          id: "standalone-form-builder",
          label: "Forms",
          href: "#",
          icon: Database,
        }),
        plugins
      )
    ).toBe("/admin/collections/forms");
  });

  it("falls back to '#' for a standalone plugin with no collections", () => {
    const plugins: PluginMetadata[] = [
      { name: "Empty Plugin", collections: [] },
    ];
    expect(
      resolveItemHref(
        makeItem({
          id: "standalone-empty-plugin",
          label: "Empty",
          href: "#",
          icon: Database,
        }),
        plugins
      )
    ).toBe("#");
  });

  it("falls back to '#' when no matching standalone plugin is found", () => {
    expect(
      resolveItemHref(
        makeItem({
          id: "standalone-missing",
          label: "Missing",
          href: "#",
          icon: Database,
        }),
        []
      )
    ).toBe("#");
  });
});
