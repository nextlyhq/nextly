/**
 * A standalone plugin's own panel draws the groups and numbers the plugin
 * declares: items naming no group first, then each group under its heading in
 * the order declared, each number read in one batch while the panel is drawn,
 * and a plugin that declares none of it drawn exactly as before.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding, PluginMetadata } from "@admin/types/branding";

let branding: AdminBranding = { plugins: [] } as AdminBranding;

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding,
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ hasPermission: () => true }),
}));
// The request leaves the browser here: each call is one request.
vi.mock("@admin/lib/api/refreshInterceptor", () => ({ authFetch: vi.fn() }));

import { PluginMenuItems } from "@admin/components/features/dashboard/PluginMenuItems";
import { SidebarProvider } from "@admin/components/layout/sidebar";
import { authFetch } from "@admin/lib/api/refreshInterceptor";

import { StandalonePanelItems } from "../StandalonePanelItems";

const SECTION = "standalone-acme-library";

/** `@acme/library`, standalone, with the menu and groups a test gives it. */
function library(
  menu: PluginMetadata["menu"],
  groups?: Array<{ id: string; label: string }>
): PluginMetadata {
  return {
    name: "@acme/library",
    version: "1.0.0",
    enabled: true,
    placement: "standalone",
    collections: [],
    menu,
    ...(groups ? { panel: { groups } } : {}),
  } as PluginMetadata;
}

/** The batch answers `results`, one slot per query, as JSON. */
function answer(results: unknown[]) {
  vi.mocked(authFetch).mockResolvedValue(
    new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

/** The queries the panel's request carried. */
function sentQueries(call = 0): unknown[] {
  const init = vi.mocked(authFetch).mock.calls[call][1] as RequestInit;
  return (JSON.parse(String(init.body)) as { queries: unknown[] }).queries;
}

const count = (total: number) => ({ ok: true, result: { op: "count", total } });

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <SidebarProvider defaultOpen>{children}</SidebarProvider>
    </QueryClientProvider>
  );
}

function renderPanel() {
  return render(
    wrap(<StandalonePanelItems section={SECTION} isActive={() => false} />)
  );
}

/** The panel's links, by their accessible names, in the order drawn. */
const linkNames = () =>
  screen.getAllByRole("link").map(link => link.textContent ?? "");

beforeEach(() => {
  vi.mocked(authFetch).mockReset();
});
afterEach(cleanup);

describe("a standalone plugin's panel", () => {
  it("lists the ungrouped items first, then each group under its heading, in declared order", async () => {
    answer([]);
    branding = {
      plugins: [
        library(
          [
            { label: "Bindings", to: "/admin/b", group: "checks" },
            { label: "Overview", to: "/admin/o" },
            { label: "Patterns", to: "/admin/p", group: "library" },
            { label: "Stray", to: "/admin/s", group: "missing" },
          ],
          [
            { id: "library", label: "Library" },
            { id: "checks", label: "Checks" },
          ]
        ),
      ],
    } as AdminBranding;
    renderPanel();

    expect(linkNames()).toEqual(["Overview", "Stray", "Patterns", "Bindings"]);
    const library_ = screen.getByRole("group", { name: "Library" });
    const checks = screen.getByRole("group", { name: "Checks" });
    expect(library_.textContent).toContain("Patterns");
    expect(checks.textContent).toContain("Bindings");
    // The headings follow the declared order in the document.
    expect(
      library_.compareDocumentPosition(checks) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // No item shows a number, so nothing is asked for.
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("asks every count in one request and names each link with its number", async () => {
    answer([
      {
        ok: true,
        result: {
          op: "list",
          items: [{ id: "acme/fix", label: "Fix", count: 2 }],
          total: 1,
        },
      },
      count(12),
      count(0),
      count(5),
    ]);
    branding = {
      plugins: [
        library([
          {
            label: "Patterns",
            to: "/admin/p",
            count: { collection: "patterns" },
          },
          {
            label: "Layouts",
            to: "/admin/l",
            count: { collection: "layouts" },
          },
          {
            label: "Drafts",
            to: "/admin/d",
            count: { collection: "patterns", where: { a: { equals: 1 } } },
          },
          { label: "Fix", to: "/admin/f", badge: { attention: "acme/fix" } },
          {
            label: "Quiet",
            to: "/admin/q",
            badge: { attention: "acme/quiet" },
          },
        ]),
      ],
    } as AdminBranding;
    renderPanel();

    // Drawn before any number arrives: the panel never waits on them.
    expect(screen.getByRole("link", { name: "Patterns" })).toBeDefined();

    await screen.findByRole("link", { name: "Patterns, 12" });
    // A quiet count shows 0.
    expect(screen.getByRole("link", { name: "Layouts, 0" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Drafts, 5" })).toBeDefined();
    // A badge is named as the Needs your attention card names a count.
    expect(screen.getByRole("link", { name: "Fix: 2" })).toBeDefined();
    // A badge at 0 is not drawn, and the link keeps its plain name.
    expect(screen.getByRole("link", { name: "Quiet" })).toBeDefined();
    expect(screen.getAllByTestId("plugin-item-badge")).toHaveLength(1);
    expect(screen.getAllByTestId("plugin-item-count")).toHaveLength(3);

    // One request for the whole panel, carrying each question once.
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(sentQueries()).toEqual([
      { source: "system:attention", op: "list", limit: 50 },
      { source: "collection:patterns", op: "count" },
      { source: "collection:layouts", op: "count" },
      {
        source: "collection:patterns",
        op: "count",
        where: { a: { equals: 1 } },
      },
    ]);
  });

  it("draws no number for a count that failed, and no error", async () => {
    answer([
      { ok: false, error: "unavailable", code: "unavailable" },
      count(4),
    ]);
    branding = {
      plugins: [
        library([
          { label: "Hidden", to: "/admin/h", count: { collection: "secret" } },
          { label: "Shown", to: "/admin/s", count: { collection: "open" } },
        ]),
      ],
    } as AdminBranding;
    renderPanel();

    await screen.findByRole("link", { name: "Shown, 4" });
    expect(screen.getByRole("link", { name: "Hidden" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("draws no number at all when the request fails", async () => {
    vi.mocked(authFetch).mockRejectedValue(new TypeError("offline"));
    branding = {
      plugins: [
        library([
          { label: "Patterns", to: "/admin/p", count: { collection: "p" } },
        ]),
      ],
    } as AdminBranding;
    renderPanel();

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("link", { name: "Patterns" })).toBeDefined();
    expect(screen.queryByTestId("plugin-item-count")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("draws a plugin that declares none of it exactly as before, asking nothing", () => {
    branding = {
      plugins: [
        library([
          { label: "Overview", to: "/admin/o" },
          {
            label: "Reports",
            to: "/admin/r",
            children: [{ label: "Weekly", to: "/admin/w" }],
          },
        ]),
      ],
    } as AdminBranding;
    const declared = renderPanel().container.innerHTML;
    cleanup();
    const before = render(
      wrap(<PluginMenuItems isActive={() => false} section={SECTION} asMenu />)
    ).container.innerHTML;

    // Equal but for the ids React generates per render.
    const plain = (html: string) => html.replace(/_r_[a-z0-9]+_/g, "_id_");
    expect(plain(declared)).toBe(plain(before));
    expect(declared).toContain("Overview");
    expect(authFetch).not.toHaveBeenCalled();
  });
});
