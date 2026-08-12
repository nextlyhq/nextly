/**
 * The directory joins two sources: a curated catalogue, and what the server
 * reports as installed. These cover that join, and the route that reaches it —
 * `/admin/plugins/browse` is also a legal `/admin/plugins/[slug]`, so which
 * page answers is a property worth pinning rather than assuming.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import { resolveRoute } from "@admin/lib/routing";
import type { AdminBranding } from "@admin/types/branding";

let mockBranding: AdminBranding = { plugins: [] } as unknown as AdminBranding;

vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: { get: () => Promise.resolve(mockBranding) },
}));

import PluginBrowsePage from "./browse";

function renderBrowse() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PluginBrowsePage />
    </QueryClientProvider>
  );
}

afterEach(() => {
  mockBranding = { plugins: [] } as unknown as AdminBranding;
  vi.restoreAllMocks();
});

describe("plugin browse route", () => {
  /**
   * `/admin/plugins/[slug]` matches this path too. Two independent things keep
   * the directory reachable — the exact-match pass in `resolveRoute`, and the
   * browse route being registered before the detail route, since the dynamic
   * matcher takes the first pattern that matches. Either alone is sufficient,
   * so this fails only when both are gone, which is the state that would
   * actually render a plugin detail page for a plugin named "browse".
   */
  it("resolves the browse path to the browse page, not the detail page", () => {
    const resolved = resolveRoute(ROUTES.PLUGIN_BROWSE, "");

    expect(resolved.Component).toBe(PluginBrowsePage);
    expect(resolved.params).toEqual({});
  });

  it("still resolves a real plugin slug to the detail page", () => {
    // Positive control on the matcher: the dynamic route is reachable, so the
    // assertion above is about precedence rather than about a detail route
    // that stopped matching anything.
    const resolved = resolveRoute("/admin/plugins/nextlyhq-plugin-seo", "");

    expect(resolved.Component).not.toBe(PluginBrowsePage);
    expect(resolved.params).toEqual({ slug: "nextlyhq-plugin-seo" });
  });
});

describe("PluginBrowsePage", () => {
  it("marks a catalogue entry installed when admin-meta reports it", async () => {
    mockBranding = {
      plugins: [{ name: "@nextlyhq/plugin-page-builder" }],
    } as unknown as AdminBranding;

    renderBrowse();

    expect(await screen.findAllByText("Page Builder")).not.toHaveLength(0);
    expect(
      screen.getAllByTestId("installed-@nextlyhq/plugin-page-builder").length
    ).toBeGreaterThan(0);
  });

  /**
   * Required alongside the case above: on its own, the positive test passes on
   * a page that marks everything installed, and this one passes on a page that
   * renders nothing. Only the pair separates them, which is why each asserts
   * the entry IS rendered before asserting what it is not.
   */
  it("does not mark it installed when admin-meta does not report it", async () => {
    mockBranding = { plugins: [] } as unknown as AdminBranding;

    renderBrowse();

    expect(await screen.findAllByText("Page Builder")).not.toHaveLength(0);
    expect(
      screen.queryByTestId("installed-@nextlyhq/plugin-page-builder")
    ).toBeNull();
  });

  it("prefers an installed plugin's own description over the catalogue's", async () => {
    mockBranding = {
      plugins: [
        {
          name: "@nextlyhq/plugin-seo",
          description: "What the installed plugin says about itself",
        },
      ],
    } as unknown as AdminBranding;

    renderBrowse();

    expect(
      await screen.findByText("What the installed plugin says about itself")
    ).toBeInTheDocument();
  });
});
