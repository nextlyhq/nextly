import { render, screen } from "@testing-library/react";
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
  },
];

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins }),
}));

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

  it("renders a not-found state for an unknown slug", () => {
    render(<PluginDetailPage params={{ slug: "nope" }} />);
    expect(screen.getByText("Plugin not found")).toBeInTheDocument();
  });
});
