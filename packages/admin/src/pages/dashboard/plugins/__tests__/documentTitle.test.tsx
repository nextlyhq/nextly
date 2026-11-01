/**
 * A plugin's detail page names the plugin in the browser tab, installed or not.
 *
 * Opened from the directory, a plugin the project has not installed is absent
 * from branding and is named by its catalogue entry instead. The tab must use
 * that same name, the one the page shows, rather than falling back to the
 * screen's name alone.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useAppName: () => "Golden Shop",
  // A settled answer for a project with no plugins installed.
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

vi.mock("@admin/lib/plugins/registry/static-source", () => ({
  staticRegistrySource: {
    list: () =>
      Promise.resolve([
        {
          id: "acme-forms",
          name: "Acme Forms",
          description: "Forms for Acme.",
        },
      ]),
    featured: () => Promise.resolve([]),
  },
}));

// The not-installed panel draws the catalogue entry; only its presence matters.
vi.mock("../components/NotInstalledPlugin", () => ({
  NotInstalledPlugin: ({ plugin }: { plugin: { name: string } }) => (
    <p>not installed: {plugin.name}</p>
  ),
}));

import { createTestQueryClient } from "@admin/__tests__/utils";
import { DocumentTitleProvider } from "@admin/context/providers/DocumentTitleProvider";
import { resolveRoute } from "@admin/lib/routing";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";

import PluginDetailPage from "../[slug]";

const SLUG = pluginSlug("acme-forms");
const PATH = `/admin/plugins/${SLUG}`;

beforeEach(() => {
  document.title = "Host title";
});

describe("an uninstalled plugin's tab title", () => {
  it("names the plugin by its catalogue entry once the catalogue arrives", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <DocumentTitleProvider route={resolveRoute(PATH, "")} pathname={PATH}>
          <PluginDetailPage params={{ slug: SLUG }} />
        </DocumentTitleProvider>
      </QueryClientProvider>
    );

    // The page has drawn the entry, so the name the tab should carry is on
    // screen before the title is read.
    await screen.findByText("not installed: Acme Forms");
    await waitFor(() =>
      expect(document.title).toBe("Acme Forms · Plugins · Golden Shop")
    );
  });
});
