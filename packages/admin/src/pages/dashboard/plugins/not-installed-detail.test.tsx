/**
 * A plugin's page has one URL whether or not the project has it. These cover
 * the uninstalled half: the directory links every card here, and most cards
 * are for plugins nobody has installed yet, so that is the ordinary path
 * rather than an error.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

let mockBranding: AdminBranding = { plugins: [] } as unknown as AdminBranding;

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
}));

import PluginDetailPage from "./[slug]";

function renderDetail(slug: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PluginDetailPage params={{ slug }} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  mockBranding = { plugins: [] } as unknown as AdminBranding;
  vi.restoreAllMocks();
});

describe("plugin detail, not installed", () => {
  /**
   * The separating case. Before this view existed the page searched only
   * `branding.plugins`, so every catalogue entry the directory linked to
   * rendered "Plugin not found" — a dead end on the primary discovery path.
   */
  it("shows the catalogue entry instead of a not-found page", async () => {
    renderDetail("nextlyhq-plugin-seo");

    expect(
      await screen.findByRole("heading", { name: "SEO" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Plugin not found")).toBeNull();
  });

  it("offers the install command and the config line", async () => {
    renderDetail("nextlyhq-plugin-seo");

    expect(
      await screen.findByText("pnpm add @nextlyhq/plugin-seo")
    ).toBeInTheDocument();
    expect(screen.getByText(/plugins: \[seoPlugin\(/)).toBeInTheDocument();
  });

  /**
   * The invariant the whole surface rests on: verified content only ever
   * appears in the verified section. Nothing here has been observed running,
   * so the sections that report what a plugin contributes must be absent.
   */
  it("reports no contributions, because none have been observed", async () => {
    renderDetail("nextlyhq-plugin-seo");

    await screen.findByRole("heading", { name: "SEO" });
    expect(screen.queryByText("Permissions")).toBeNull();
    expect(screen.queryByText("API routes")).toBeNull();
  });

  it("still says not found for a slug no plugin and no entry matches", async () => {
    renderDetail("no-such-plugin");

    expect(await screen.findByText("Plugin not found")).toBeInTheDocument();
  });

  /**
   * Installed metadata is observed; the catalogue is a claim. When both
   * describe the same package the observed one decides which view renders,
   * otherwise installing a plugin would leave it looking uninstalled.
   */
  it("prefers the installed plugin over the catalogue entry", async () => {
    mockBranding = {
      plugins: [{ name: "@nextlyhq/plugin-seo", version: "1.0.0" }],
    } as unknown as AdminBranding;

    renderDetail("nextlyhq-plugin-seo");

    expect(await screen.findByText("v1.0.0")).toBeInTheDocument();
    expect(screen.queryByText("pnpm add @nextlyhq/plugin-seo")).toBeNull();
  });
});
