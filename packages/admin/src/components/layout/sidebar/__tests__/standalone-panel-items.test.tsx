/**
 * A standalone plugin's own panel draws the groups and numbers the plugin
 * declares: items naming no group first, then each group under its heading in
 * the order declared, each number read in one request naming only the plugin
 * while the panel is drawn, and a plugin that declares none of it drawn
 * exactly as before.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: vi.fn() },
}));

import { PluginMenuItems } from "@admin/components/features/dashboard/PluginMenuItems";
import { SidebarProvider } from "@admin/components/layout/sidebar";
import { protectedApi } from "@admin/lib/api/protectedApi";

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

/** The server answers these numbers, each by its item's place in the menu. */
function answer(
  numbers: Array<[index: number, value: number, atLeast?: true]>
) {
  vi.mocked(protectedApi.get).mockResolvedValue({
    numbers: numbers.map(([index, value, atLeast]) => ({
      index,
      value,
      atLeast: atLeast === true,
    })),
  });
}

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

/**
 * Each link's own `aria-label`, by address: the name a browser gives it as
 * written, with nothing joined from its contents.
 */
const namesOf = (hrefs: readonly string[]) =>
  hrefs.map(
    href =>
      document.querySelector(`a[href="${href}"]`)?.getAttribute("aria-label") ??
      null
  );

/** The panel's links, by their accessible names, in the order drawn. */
const linkNames = () =>
  screen.getAllByRole("link").map(link => link.textContent ?? "");

beforeEach(() => {
  vi.mocked(protectedApi.get).mockReset();
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
    expect(protectedApi.get).not.toHaveBeenCalled();
  });

  it("asks every number in one request naming the plugin, and names each link with its number", async () => {
    // Quiet's badge counts 0.
    answer([
      [0, 12],
      [1, 0],
      [2, 5],
      [3, 2],
      [4, 0],
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
    // Named by the link's own label, exactly as a browser reads it: a name
    // assembled from a visually hidden part reads "Patterns , 12" there.
    expect(
      namesOf(["/admin/p", "/admin/l", "/admin/d", "/admin/f", "/admin/q"])
    ).toEqual(["Patterns, 12", "Layouts, 0", "Drafts, 5", "Fix: 2", null]);
    expect(screen.getAllByTestId("plugin-item-badge")).toHaveLength(1);
    expect(screen.getAllByTestId("plugin-item-count")).toHaveLength(3);

    // One request for the whole panel, naming only the plugin: the server
    // reads what the plugin declared, never a collection the browser sends.
    expect(protectedApi.get).toHaveBeenCalledTimes(1);
    expect(vi.mocked(protectedApi.get).mock.calls[0][0]).toBe(
      "/admin-meta/plugin-panel-numbers?plugin=%40acme%2Flibrary"
    );
  });

  it("draws each item's own number, whatever page it links to", async () => {
    // Three items link to one page, in three parts of the panel; the third's
    // number could not be read. A branch keeps its number through the copy
    // the panel makes of it.
    answer([
      [0, 7],
      [1, 2],
      [3, 9],
    ]);
    branding = {
      plugins: [
        library(
          [
            {
              label: "Reports",
              to: "/admin/r",
              group: "library",
              count: { collection: "reports" },
            },
            {
              label: "Reports to fix",
              to: "/admin/r",
              group: "checks",
              badge: { attention: "acme/fix" },
            },
            {
              label: "Reports again",
              to: "/admin/r",
              count: { collection: "unreadable" },
            },
            {
              label: "Archive",
              to: "/admin/a",
              group: "library",
              count: { collection: "archive" },
              children: [{ label: "Old", to: "/admin/old" }],
            },
          ],
          [
            { id: "library", label: "Library" },
            { id: "checks", label: "Checks" },
          ]
        ),
      ],
    } as AdminBranding;
    renderPanel();

    const library_ = screen.getByRole("group", { name: "Library" });
    const checks = screen.getByRole("group", { name: "Checks" });
    await within(library_).findByRole("link", { name: "Reports, 7" });
    expect(
      within(checks).getByRole("link", { name: "Reports to fix: 2" })
    ).toBeDefined();
    const again = screen.getByRole("link", { name: "Reports again" });
    expect(again.getAttribute("aria-label")).toBeNull();
    expect(
      within(library_).getByRole("button", { name: "Archive, 9" })
    ).toBeDefined();
  });

  it("draws no number for a count the server left out, and no error", async () => {
    // The first item's collection is one the reader may not read: the server
    // answers no number for it.
    answer([[1, 4]]);
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
    // No number, so no label of its own: the name is the label it holds.
    expect(namesOf(["/admin/h", "/admin/s"])).toEqual([null, "Shown, 4"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("draws no number at all when the request fails", async () => {
    vi.mocked(protectedApi.get).mockRejectedValue(new TypeError("offline"));
    branding = {
      plugins: [
        library([
          { label: "Patterns", to: "/admin/p", count: { collection: "p" } },
        ]),
      ],
    } as AdminBranding;
    renderPanel();

    await waitFor(() => expect(protectedApi.get).toHaveBeenCalledTimes(1));
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
    expect(protectedApi.get).not.toHaveBeenCalled();
  });
});
