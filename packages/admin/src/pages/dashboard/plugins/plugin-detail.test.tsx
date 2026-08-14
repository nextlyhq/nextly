import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    routes: [
      {
        method: "GET",
        path: "/submissions/export",
        fullPath: "/plugins/@acme/forms/submissions/export",
      },
    ],
  },
  {
    name: "@acme/disabled",
    version: "0.9.0",
    enabled: false,
    placement: "plugins",
    collections: ["retained"],
    permissions: [
      {
        action: "purge",
        resource: "archive",
        label: "Purge Archive",
        danger: true,
      },
    ],
    whenEnabled: {
      routes: [
        {
          method: "DELETE",
          path: "/archive",
          fullPath: "/plugins/@acme/disabled/archive",
        },
      ],
    },
  },
];

// The permissions card reads the SEEDED ROWS from the authenticated endpoint,
// so a test rendering the page supplies that answer rather than the network.
// `pageSize` is what makes the loop observable: with it below the row count
// the endpoint answers in several pages, exactly as the real one does past its
// cap, and a card reading only page one omits whatever sorts late.
const permissionRows = vi.hoisted(() => ({
  current: [] as unknown[],
  pageSize: 200,
}));
vi.mock("@admin/services/realPermissionsApi", () => ({
  fetchPermissionsFromApi: (options?: { page?: number }) => {
    const size = permissionRows.pageSize;
    const page = options?.page ?? 1;
    const start = (page - 1) * size;
    return Promise.resolve({
      data: permissionRows.current.slice(start, start + size),
      meta: {
        total: permissionRows.current.length,
        page,
        limit: size,
        totalPages: Math.max(
          1,
          Math.ceil(permissionRows.current.length / size)
        ),
      },
    });
  },
}));

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
/**
 * Supplies the QueryClient the permissions card needs. That card reads rows
 * from the API rather than the branding payload, so rendering the page is a
 * query even when nothing on screen is loading.
 */
/**
 * Rows as the seeder writes them. `owner` is the DECLARING PLUGIN NAME, which
 * is what attributes a permission to a plugin — the resource string cannot,
 * because a plugin names its own resources.
 */
const seededRows = [
  {
    id: "p1",
    name: "Export Submissions",
    slug: "submissions.export",
    action: "export",
    resource: "submissions",
    description: null,
    owner: "@acme/forms",
    danger: true,
  },
  {
    id: "p2",
    name: "Purge Archive",
    slug: "archive.purge",
    action: "purge",
    resource: "archive",
    description: null,
    owner: "@acme/disabled",
    danger: true,
  },
];

beforeEach(() => {
  permissionRows.current = seededRows;
  permissionRows.pageSize = 200;
});

/**
 * The endpoint sorts globally by resource, so one plugin's rows are scattered
 * across pages rather than grouped. A card reading only the first page filters
 * a partial set and reports "none" for a plugin whose rows all sort late —
 * which is indistinguishable from a plugin that genuinely owns none.
 *
 * `pageSize: 1` puts the target row on page two, so this fails against any
 * implementation that does not follow `totalPages`.
 */
describe("PluginDetailPage permissions across pages", () => {
  it("finds a plugin's rows when they fall beyond the first page", async () => {
    permissionRows.pageSize = 1;
    // seededRows[1] is the @acme/disabled row, so page one holds only the
    // @acme/forms one and the target is reachable only by paging.
    renderPage("acme-disabled");

    expect(await screen.findByText("Purge Archive")).toBeInTheDocument();
  });
});

function renderPage(slug: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PluginDetailPage params={{ slug }} />
    </QueryClientProvider>
  );
}

describe("PluginDetailPage layout", () => {
  function rail() {
    return screen.getByRole("complementary", { name: "About @acme/forms" });
  }

  it("puts the metadata in a rail and the contributions outside it", () => {
    renderPage("acme-forms");

    const aside = rail();
    // In the rail: the About metadata.
    expect(within(aside).getByText("Installed version")).toBeInTheDocument();
    expect(within(aside).getByText("Depends on")).toBeInTheDocument();

    // NOT in the rail: what the plugin contributes. The separating assertion —
    // without it, moving the whole page inside the aside would pass.
    expect(within(aside).queryByText("API routes")).toBeNull();
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
    renderPage("acme-forms");

    const className = rail().className;
    expect(className).toContain("@3xl/content:sticky");
    expect(className).toContain("@3xl/content:self-start");
  });
});

describe("PluginDetailPage", () => {
  it("renders the identity header with version, status, category, and author", () => {
    renderPage("acme-forms");
    expect(
      screen.getByRole("heading", { name: "@acme/forms" })
    ).toBeInTheDocument();
    expect(screen.getByText("v1.2.0")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Forms")).toBeInTheDocument();
    expect(screen.getByText("by Acme Inc.")).toBeInTheDocument();
  });

  it("links homepage, repository — external links open in a new tab", () => {
    renderPage("acme-forms");
    const homepage = screen.getByRole("link", { name: /Homepage/ });
    expect(homepage).toHaveAttribute("href", "https://acme.dev");
    expect(homepage).toHaveAttribute("target", "_blank");
    expect(homepage).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: /Repository/ })).toHaveAttribute(
      "href",
      "https://github.com/acme/forms"
    );
  });

  it("lists what the plugin adds, computed from its registrations", async () => {
    renderPage("acme-forms");
    expect(screen.getByText("What this plugin adds")).toBeInTheDocument();
    // Collections group with both slugs; the collection links to its list page.
    expect(screen.getByRole("link", { name: "forms" })).toHaveAttribute(
      "href",
      "/admin/collections/forms"
    );
    expect(screen.getByText("form-submissions")).toBeInTheDocument();
    expect(screen.getByText("form-settings")).toBeInTheDocument();
    // Permissions are AWAITED: they come from the authenticated rows endpoint
    // rather than the branding payload, so they arrive after the first paint.
    expect(await screen.findByText("Export Submissions")).toBeInTheDocument();
    expect(screen.getByText("danger")).toBeInTheDocument();
    // Route summary includes the namespaced final URL.
    expect(
      screen.getByText("GET /admin/api/plugins/@acme/forms/submissions/export")
    ).toBeInTheDocument();
  });

  it("shows the About rows including license and dependencies", () => {
    renderPage("acme-forms");
    expect(screen.getByText("License")).toBeInTheDocument();
    expect(screen.getByText("MIT")).toBeInTheDocument();
    expect(screen.getByText("@acme/core ^1.0.0")).toBeInTheDocument();
  });

  it("marks a disabled plugin and names the surfaces that stop", () => {
    renderPage("acme-disabled");
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(
      screen.getByText(
        /API routes, admin\s+pages, menu items and settings panel are not registered/i
      )
    ).toBeInTheDocument();
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
 * A disabled plugin serves no routes, so what it WOULD serve is a different
 * claim from what it serves. These pin that the two are shown as different
 * things rather than merged into one list.
 */
describe("PluginDetailPage dormant disclosure", () => {
  it("shows a disabled plugin's routes under their own heading", () => {
    renderPage("acme-disabled");

    expect(screen.getByText("Would serve when enabled")).toBeInTheDocument();
    // Enabling in config is necessary and NOT sufficient: config HMR does not
    // re-run service registration or route mounting, so an operator who stops
    // at the flag reaches a route that still 404s.
    expect(
      screen.getByText(/restart the app to serve these/i)
    ).toBeInTheDocument();
    // The RAW package name, which is the namespace the dispatcher registers —
    // not the admin slug, which is only how this UI addresses the plugin.
    expect(
      screen.getByText("DELETE /admin/api/plugins/@acme/disabled/archive")
    ).toBeInTheDocument();
  });

  /**
   * The separating assertion. A merged list would render the same string and
   * pass a presence-only check.
   */
  it("keeps them out of what the plugin currently adds", () => {
    renderPage("acme-disabled");

    const contributions = screen
      .getByText("What this plugin adds")
      .closest("section");
    expect(contributions).not.toBeNull();
    expect(within(contributions!).queryByText("API routes")).toBeNull();
  });

  it("shows no dormant section for an enabled plugin", () => {
    renderPage("acme-forms");

    // The enabled fixture declares a route, so this asserts the section is
    // withheld rather than that there was nothing to show.
    expect(screen.getByText("API routes")).toBeInTheDocument();
    expect(screen.queryByText("Would serve when enabled")).toBeNull();
  });

  /**
   * The active section names the same namespace. A scoped package is served at
   * its raw name, so a slug-derived path here would be wrong for every plugin
   * whose name has a scope — which is all three first-party ones.
   */
  it("names the dispatcher's namespace for an enabled plugin's routes", () => {
    renderPage("acme-forms");

    expect(
      screen.getByText("GET /admin/api/plugins/@acme/forms/submissions/export")
    ).toBeInTheDocument();
  });
});

/**
 * A disabled plugin keeps its schema and its grants; only its routes stop
 * being mounted. These pin that split.
 *
 * The permissions half is read from the authenticated rows endpoint rather
 * than the public payload, so it is AWAITED here while the routes half is
 * synchronous. Both are still asserted on one plugin, which is what makes
 * the split observable.
 */
describe("PluginDetailPage disabled plugin permissions", () => {
  it("lists a disabled plugin's permissions as things it has", async () => {
    renderPage("acme-disabled");

    // Awaited for the same reason: the rows arrive from the API, not from the
    // branding payload the rest of this section reads.
    expect(await screen.findByText("Purge Archive")).toBeInTheDocument();
    const contributions = screen
      .getByText("What this plugin adds")
      .closest("section");
    expect(
      within(contributions!).getByText("Purge Archive")
    ).toBeInTheDocument();
  });

  /**
   * The separating assertion. If the enabled flag simply stopped mattering,
   * routes would show here too — they must not, because they are not mounted.
   */
  it("still withholds a disabled plugin's routes from that section", () => {
    renderPage("acme-disabled");

    const contributions = screen
      .getByText("What this plugin adds")
      .closest("section");
    expect(within(contributions!).queryByText("API routes")).toBeNull();
    // They are disclosed as pending instead, not dropped.
    expect(screen.getByText("Would serve when enabled")).toBeInTheDocument();
  });

  it("says the permissions stay granted while the plugin is off", () => {
    renderPage("acme-disabled");

    expect(screen.getByText(/permissions stay granted/i)).toBeInTheDocument();
  });

  /**
   * A permission is a global slug that any component may test through the
   * SDK's `useCan`, and a disabled plugin keeps its field editors mounted, so
   * a grant is not inert just because the plugin is off. The retained-editor
   * sentence is the positive half: it makes the narrower claim observable, so
   * this cannot pass by the whole paragraph having gone missing.
   */
  it("does not claim everything the permissions protect is unloaded", () => {
    renderPage("acme-disabled");

    expect(
      screen.getByText(/field editors it contributes stay available/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/what they protect is not loaded/i)).toBeNull();
  });
});
