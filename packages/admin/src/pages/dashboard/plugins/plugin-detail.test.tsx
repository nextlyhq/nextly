import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PluginMetadata } from "@admin/types/branding";

import PluginDetailPage from "./[slug]";

const plugins: PluginMetadata[] = [
  {
    name: "@acme/forms",
    version: "1.2.0",
    description: "Build forms visually.",
    author: "Acme Inc.",
    homepage: "https://acme.dev",
    repository: "https://github.com/acme/forms",
    license: "MIT",
    category: "forms",
    tags: ["forms", "email"],
    enabled: true,
    dependsOn: { "@acme/core": "^1.0.0" },
    placement: "plugins",
    collections: ["forms", "form-submissions"],
    singles: ["form-settings"],
    menu: [{ label: "All Forms", to: "/admin/collections/forms" }],
    permissions: [
      {
        action: "export",
        resource: "submissions",
        label: "Export Submissions",
        danger: true,
      },
    ],
    routes: [{ method: "GET", path: "/submissions/export" }],
  },
  {
    name: "@acme/disabled",
    version: "0.9.0",
    enabled: false,
    placement: "plugins",
    collections: ["retained"],
    whenEnabled: {
      permissions: [
        { action: "purge", resource: "archive", label: "Purge Archive" },
      ],
      routes: [{ method: "DELETE", path: "/archive" }],
    },
  },
];

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins }),
  // Settled with an answer, so a slug missing from `plugins` really is absent.
  useBrandingStatus: () => ({ isPending: false, isUnavailable: false }),
}));

/**
 * The page is two columns with a sticky metadata rail. What these pin is where
 * each half lives: the metadata sits in the rail, and what the plugin
 * contributes — its permissions and API routes included — stays in the main
 * column, visible without an interaction rather than behind one.
 */
describe("PluginDetailPage layout", () => {
  function rail() {
    return screen.getByRole("complementary", { name: "About @acme/forms" });
  }

  it("puts the metadata in a rail and the contributions outside it", () => {
    render(<PluginDetailPage params={{ slug: "acme-forms" }} />);

    const aside = rail();
    // In the rail: the About metadata.
    expect(within(aside).getByText("Installed version")).toBeInTheDocument();
    expect(within(aside).getByText("Depends on")).toBeInTheDocument();

    // NOT in the rail: what the plugin contributes. The separating assertion —
    // without it, moving the whole page inside the aside would pass.
    expect(within(aside).queryByText("Permissions")).toBeNull();
    expect(within(aside).queryByText("API routes")).toBeNull();
    expect(screen.getByText("Permissions")).toBeInTheDocument();
    expect(screen.getByText("API routes")).toBeInTheDocument();
  });

  /**
   * A grid item stretches to its row by default, which leaves `position:
   * sticky` with nothing to stick to. `self-start` is the part that actually
   * makes the rail stick, and it is invisible in a rendered-text assertion.
   *
   * Container-scoped, not viewport-scoped: the sidebars take a variable share
   * of the window, so a `lg:` prefix here would engage the two-column layout
   * at window widths where the page has no room for it.
   */
  it("gives the rail the classes that let it stick", () => {
    render(<PluginDetailPage params={{ slug: "acme-forms" }} />);

    const className = rail().className;
    expect(className).toContain("@3xl/content:sticky");
    expect(className).toContain("@3xl/content:self-start");
  });
});

describe("PluginDetailPage", () => {
  it("renders the identity header with version, status, category, and author", () => {
    render(<PluginDetailPage params={{ slug: "acme-forms" }} />);
    expect(
      screen.getByRole("heading", { name: "@acme/forms" })
    ).toBeInTheDocument();
    expect(screen.getByText("v1.2.0")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Forms")).toBeInTheDocument();
    expect(screen.getByText("by Acme Inc.")).toBeInTheDocument();
  });

  it("links homepage, repository — external links open in a new tab", () => {
    render(<PluginDetailPage params={{ slug: "acme-forms" }} />);
    const homepage = screen.getByRole("link", { name: /Homepage/ });
    expect(homepage).toHaveAttribute("href", "https://acme.dev");
    expect(homepage).toHaveAttribute("target", "_blank");
    expect(homepage).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: /Repository/ })).toHaveAttribute(
      "href",
      "https://github.com/acme/forms"
    );
  });

  it("lists what the plugin adds, computed from its registrations", () => {
    render(<PluginDetailPage params={{ slug: "acme-forms" }} />);
    expect(screen.getByText("What this plugin adds")).toBeInTheDocument();
    // Collections group with both slugs; the collection links to its list page.
    expect(screen.getByRole("link", { name: "forms" })).toHaveAttribute(
      "href",
      "/admin/collections/forms"
    );
    expect(screen.getByText("form-submissions")).toBeInTheDocument();
    expect(screen.getByText("form-settings")).toBeInTheDocument();
    // Permission shows its label and danger marker.
    expect(screen.getByText("Export Submissions")).toBeInTheDocument();
    expect(screen.getByText("danger")).toBeInTheDocument();
    // Route summary includes the namespaced final URL.
    expect(
      screen.getByText("GET /api/plugins/acme-forms/submissions/export")
    ).toBeInTheDocument();
  });

  it("shows the About rows including license and dependencies", () => {
    render(<PluginDetailPage params={{ slug: "acme-forms" }} />);
    expect(screen.getByText("License")).toBeInTheDocument();
    expect(screen.getByText("MIT")).toBeInTheDocument();
    expect(screen.getByText("@acme/core ^1.0.0")).toBeInTheDocument();
  });

  it("marks a disabled plugin and explains that its behavior does not load", () => {
    render(<PluginDetailPage params={{ slug: "acme-disabled" }} />);
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText(/its behavior does not load/i)).toBeInTheDocument();
  });

  /**
   * Not found now means neither installed NOR in the plugin directory, so this
   * path reads the catalogue and needs a query client. A slug that IS in the
   * catalogue renders the uninstalled view instead, covered in
   * `not-installed-detail.test.tsx`.
   */
  it("renders a not-found state for a slug nothing knows", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <PluginDetailPage params={{ slug: "nope" }} />
      </QueryClientProvider>
    );
    expect(await screen.findByText("Plugin not found")).toBeInTheDocument();
  });
});

/**
 * A disabled plugin grants nothing and mounts nothing, so what it WOULD add is
 * a different claim from what it adds. These pin that the two are shown as
 * different things rather than merged into one list.
 */
describe("PluginDetailPage dormant disclosure", () => {
  it("shows a disabled plugin's declarations under their own heading", () => {
    render(<PluginDetailPage params={{ slug: "acme-disabled" }} />);

    expect(screen.getByText("Would add when enabled")).toBeInTheDocument();
    expect(screen.getByText("Purge Archive")).toBeInTheDocument();
    expect(
      screen.getByText("DELETE /api/plugins/acme-disabled/archive")
    ).toBeInTheDocument();
  });

  /**
   * The separating assertion. The active section must NOT claim them — a
   * merged list would render the same strings and pass the test above.
   */
  it("keeps them out of what the plugin currently adds", () => {
    render(<PluginDetailPage params={{ slug: "acme-disabled" }} />);

    const contributions = screen
      .getByText("What this plugin adds")
      .closest("section");
    expect(contributions).not.toBeNull();
    expect(within(contributions!).queryByText("Purge Archive")).toBeNull();
    expect(within(contributions!).queryByText("Permissions")).toBeNull();
  });

  it("shows no dormant section for an enabled plugin", () => {
    render(<PluginDetailPage params={{ slug: "acme-forms" }} />);

    // The enabled fixture declares permissions and routes, so this asserts the
    // section is withheld rather than that there was nothing to show.
    expect(screen.getByText("Permissions")).toBeInTheDocument();
    expect(screen.queryByText("Would add when enabled")).toBeNull();
  });
});
