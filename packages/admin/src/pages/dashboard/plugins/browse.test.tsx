/**
 * The directory joins two sources: a curated catalogue, and what the server
 * reports as installed. These cover that join, and the route that reaches it —
 * the directory sits outside `/admin/plugins/` so that no plugin name can
 * shadow it, and that separation is worth pinning rather than assuming.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import { resolveRoute } from "@admin/lib/routing";
import type { AdminBranding } from "@admin/types/branding";

let mockBranding: AdminBranding = { plugins: [] } as unknown as AdminBranding;

// The provider, not the transport. Installed status comes from the
// session-gated half of admin-meta, which the page reads through this hook
// rather than by fetching for itself — mocking the public client would supply
// a payload the page no longer asks for and leave every entry uninstalled.
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
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
  it("resolves the directory path to the browse page", () => {
    const resolved = resolveRoute(ROUTES.PLUGIN_BROWSE, "");

    expect(resolved.Component).toBe(PluginBrowsePage);
    expect(resolved.params).toEqual({});
  });

  it("still resolves a real plugin slug to the detail page", () => {
    // Positive control on the matcher: the dynamic route is reachable, so the
    // assertion above is about the directory's own path rather than about a
    // detail route that stopped matching anything.
    const resolved = resolveRoute("/admin/plugins/nextlyhq-plugin-seo", "");

    expect(resolved.Component).not.toBe(PluginBrowsePage);
    expect(resolved.params).toEqual({ slug: "nextlyhq-plugin-seo" });
  });

  /**
   * The separating case, and the reason the directory does not live at
   * `/admin/plugins/browse`.
   *
   * `PluginDefinition.name` is an arbitrary string, so a plugin can slugify to
   * any segment a static sibling might occupy — `browse` included. With the
   * two sharing a parent, one of them has to win, and the loser is a page the
   * UI still links to and nothing can reach. Under a different parent the
   * question does not arise, so this asserts the slug the old layout would
   * have swallowed still reaches its own page.
   */
  it("reaches the detail page for a plugin whose slug is the old directory segment", () => {
    const resolved = resolveRoute("/admin/plugins/browse", "");

    expect(resolved.Component).not.toBe(PluginBrowsePage);
    expect(resolved.params).toEqual({ slug: "browse" });
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

  /**
   * Search reads what the card renders, not what the catalogue stores. An
   * installed plugin's own description is what a reader sees, so typing a word
   * from it must keep the card rather than filter it away.
   */
  it("finds a card by the installed description it actually shows", async () => {
    mockBranding = {
      plugins: [
        {
          name: "@nextlyhq/plugin-seo",
          description: "Zebra crossing metadata",
        },
      ],
    } as unknown as AdminBranding;

    renderBrowse();
    await screen.findByText("Zebra crossing metadata");

    fireEvent.change(screen.getByPlaceholderText("Search the directory"), {
      target: { value: "zebra" },
    });

    // Waited for, not asserted immediately: `SearchBar` debounces by 300ms, so
    // a synchronous check runs before the query reaches this page and passes
    // whatever the search would have done.
    //
    // The disappearance is the control. Asserting only that SEO survives is
    // satisfied by a page that never filtered at all, which is the same green
    // a search reading the wrong field produces.
    // The timeout is sized to the debounce, not to taste. `waitFor` defaults
    // to 1000ms, which is only ~3x a delay the component takes deliberately,
    // and under a full parallel suite that margin is not enough — this passed
    // alone and failed in the whole run. The property being asserted is
    // unchanged; only the patience is.
    await waitFor(
      () =>
        expect(
          screen.queryByRole("heading", { name: "Page Builder" })
        ).toBeNull(),
      { timeout: 5000 }
    );
    expect(screen.getByRole("heading", { name: "SEO" })).toBeInTheDocument();
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
