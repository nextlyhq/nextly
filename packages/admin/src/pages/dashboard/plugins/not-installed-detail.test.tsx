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

/**
 * The install line, as a pattern shared by the assertions that require it and
 * the ones that require its absence.
 *
 * A literal `"pnpm add @nextlyhq/plugin-seo"` would match nothing now that the
 * command is pinned, so every `queryByText(...).toBeNull()` below would pass
 * on a page that rendered the install block in full. Matching the version
 * loosely keeps the absence assertions answering the question they ask, while
 * `install-command.test.ts` pins the exact strings.
 */
const INSTALL_COMMAND = /^pnpm add @nextlyhq\/plugin-seo@\d/;

let mockBranding: AdminBranding = { plugins: [] } as unknown as AdminBranding;
let mockBrandingStatus = { isPending: false, isError: false };

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
  useBrandingStatus: () => mockBrandingStatus,
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
  mockBrandingStatus = { isPending: false, isError: false };
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

  /**
   * All three lines, because the recipe only works as a set: installing the
   * package does not introduce the binding, so an array entry shown without
   * its import names an identifier that does not exist in the file.
   */
  it("offers the install command, the import, and the array entry", async () => {
    renderDetail("nextlyhq-plugin-seo");

    expect(await screen.findByText(INSTALL_COMMAND)).toBeInTheDocument();
    expect(
      screen.getByText('import { seoPlugin } from "@nextlyhq/plugin-seo";')
    ).toBeInTheDocument();
    expect(screen.getByText(/plugins: \[seoPlugin\(/)).toBeInTheDocument();
  });

  /**
   * A plugin the project HAS, on a page opened cold. Until admin-meta answers
   * the installed list is empty for a reason that says nothing about the
   * project, and reading that as "not installed" tells the reader to install
   * something they already have.
   */
  it("does not offer to install while the installed list is still loading", async () => {
    mockBrandingStatus = { isPending: true, isError: false };

    renderDetail("nextlyhq-plugin-seo");

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(INSTALL_COMMAND)).toBeNull();
    expect(screen.queryByText("Plugin not found")).toBeNull();
  });

  /** Same reasoning, permanent: a failed request is not evidence of absence. */
  it("does not offer to install when the installed list could not be loaded", async () => {
    mockBrandingStatus = { isPending: false, isError: true };

    renderDetail("nextlyhq-plugin-seo");

    expect(
      await screen.findByText("Could not load your installed plugins")
    ).toBeInTheDocument();
    expect(screen.queryByText(INSTALL_COMMAND)).toBeNull();
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
    expect(screen.queryByText(INSTALL_COMMAND)).toBeNull();
  });
});
