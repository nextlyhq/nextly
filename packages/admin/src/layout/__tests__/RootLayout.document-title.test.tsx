/**
 * The browser tab's name, as the whole admin produces it.
 *
 * The router, the route table and the branding provider are the real ones, so
 * a title asserted here is the one a visitor's tab would show: the screen named
 * from what the route table declares, the site named from the deployment's
 * branding answer. Only the network, the session and the heavy chrome around a
 * screen are stubbed, and every page renders as nothing, because what a page
 * draws has no part in the tab's name.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

const publicGet = vi.fn();
const protectedGet = vi.fn();
const listGet = vi.fn();

vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: { get: (...args: unknown[]) => publicGet(...args) },
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: (...args: unknown[]) => protectedGet(...args) },
}));

// The sidebar's collection and Single lists go out through the plain fetcher.
vi.mock("@admin/lib/api/fetcher", async () => {
  const actual = await vi.importActual<typeof import("@admin/lib/api/fetcher")>(
    "@admin/lib/api/fetcher"
  );
  return { ...actual, fetcher: (path: string) => listGet(path) };
});

vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => ({
    data: { isAuthenticated: true },
    isPending: false,
  }),
  authSessionKey: ["auth", "session"],
}));

// Every page is a screen that draws nothing: the pages' own code is not what
// names the tab, and loading it would fetch for data no assertion reads.
vi.mock("@admin/pages/lazy-route", () => ({
  lazyRoute: () => () => null,
}));

vi.mock("../DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@admin/context/providers/GeneralSettingsSync", () => ({
  GeneralSettingsSync: () => null,
}));
vi.mock("@admin/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@admin/components/features/schema-builder/RestartOverlay", () => ({
  RestartOverlay: () => null,
}));
vi.mock("@admin/components/guards/PublicRoute", () => ({
  PublicRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@admin/components/guards/PrivateRoute", () => ({
  PrivateRoute: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@admin/components/guards/PermissionGuard", () => ({
  PermissionGuard: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import {
  NAV_COLLECTIONS_PARAMS,
  NAV_SINGLES_PARAMS,
  collectionKeys,
  singleKeys,
} from "@admin/hooks/queries";

import { RootLayout } from "../RootLayout";

const POSTS = {
  name: "posts",
  label: "Post",
  labels: { singular: "Post", plural: "Posts" },
};
const ABOUT = { slug: "about", label: "About Us" };

/** Every request for one collection or Single, by any route or endpoint. */
function itemRequests() {
  return protectedGet.mock.calls
    .map(([path]) => String(path))
    .filter(path => /^\/(collections|singles)\//.test(path));
}

/** Answers the branding halves and a collection read the way the server does. */
function answerWith(branding: AdminBranding) {
  publicGet.mockImplementation((path: string) =>
    path === "/admin-meta" ? Promise.resolve(branding) : Promise.reject()
  );
  protectedGet.mockImplementation((path: string) => {
    if (path === "/admin-meta/workspace")
      return Promise.resolve({ plugins: [] });
    // A collection's own read, answered so that a title taken from it would
    // still come out right: what separates the two sources is whether this
    // request is made at all.
    if (path === "/collections/posts") return Promise.resolve(POSTS);
    return Promise.reject(new Error(`unexpected request ${path}`));
  });
  listGet.mockImplementation((path: string) => {
    const meta = { total: 1, page: 1, limit: 100, totalPages: 1 };
    if (path.startsWith("/collections")) {
      return Promise.resolve({ items: [POSTS], meta });
    }
    if (path.startsWith("/singles")) {
      return Promise.resolve({ items: [ABOUT], meta });
    }
    return Promise.reject(new Error(`unexpected request ${path}`));
  });
}

function renderAt(pathname: string, client = createClient()) {
  window.history.replaceState({}, "", pathname);
  return render(
    <QueryClientProvider client={client}>
      <RootLayout />
    </QueryClientProvider>
  );
}

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Moves the way an in-app link does: a history push, no page load. */
function navigate(pathname: string) {
  act(() => {
    window.history.pushState({}, "", pathname);
  });
}

beforeEach(() => {
  document.title = "Host title";
});

afterEach(() => {
  publicGet.mockReset();
  protectedGet.mockReset();
  listGet.mockReset();
});

describe("the admin's tab title", () => {
  it("names the dashboard, then the configured site", async () => {
    answerWith({ logoText: "Golden Shop" });
    renderAt("/admin");

    await waitFor(() => expect(document.title).toBe("Dashboard · Golden Shop"));
  });

  it("names a settings screen after its entry in the settings panel", async () => {
    answerWith({ logoText: "Golden Shop" });
    renderAt("/admin/settings/webhooks");

    await waitFor(() => expect(document.title).toBe("Webhooks · Golden Shop"));
  });

  it("names a collection's entries after the collection, as the sidebar does", async () => {
    answerWith({ logoText: "Golden Shop" });
    renderAt("/admin/collections/posts");

    await waitFor(() => expect(document.title).toBe("Posts · Golden Shop"));
  });

  it("names a signed-out screen too", async () => {
    answerWith({ logoText: "Golden Shop" });
    renderAt("/admin/login");

    await waitFor(() => expect(document.title).toBe("Sign In · Golden Shop"));
  });

  it("follows in-app navigation from one screen to the next", async () => {
    answerWith({ logoText: "Golden Shop" });
    renderAt("/admin");
    await waitFor(() => expect(document.title).toBe("Dashboard · Golden Shop"));

    navigate("/admin/settings/webhooks");
    await waitFor(() => expect(document.title).toBe("Webhooks · Golden Shop"));

    navigate("/admin/media");
    await waitFor(() =>
      expect(document.title).toBe("Media Library · Golden Shop")
    );
  });

  it("falls back to the product's own name when the site has none", async () => {
    answerWith({});
    renderAt("/admin");

    // The configured name is what the response would change, so the title is
    // read once the response has been asked for and answered: before it, the
    // fallback is also what shows, and a check that passed then would say
    // nothing about the response.
    await waitFor(() => expect(publicGet).toHaveBeenCalledWith("/admin-meta"));
    await waitFor(() => expect(document.title).toBe("Dashboard · Nextly"));
  });

  it("carries a configured name that differs from the fallback", async () => {
    answerWith({ logoText: "  Acme Docs  " });
    renderAt("/admin");

    await waitFor(() => expect(document.title).toBe("Dashboard · Acme Docs"));
  });

  it("names an entry's screen from the sidebar's collection list, with no request of its own", async () => {
    answerWith({ logoText: "Golden Shop" });
    renderAt("/admin/collections/posts/e1");

    await waitFor(() => expect(document.title).toBe("Posts · Golden Shop"));
    expect(itemRequests()).toEqual([]);
  });

  it("names a Single from the sidebar's Single list, with no request of its own", async () => {
    answerWith({ logoText: "Golden Shop" });
    renderAt("/admin/singles/about");

    await waitFor(() => expect(document.title).toBe("About Us · Golden Shop"));
    expect(itemRequests()).toEqual([]);
  });

  it("reads the very cache entries the sidebar's lists fill", async () => {
    answerWith({ logoText: "Golden Shop" });
    // The lists as the sidebar left them, fresh, so nothing has reason to ask
    // the server about collections or Singles again.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const meta = { total: 1, page: 1, limit: 100, totalPages: 1 };
    client.setQueryData(collectionKeys.list(NAV_COLLECTIONS_PARAMS), {
      items: [POSTS],
      meta,
    });
    client.setQueryData(singleKeys.list(NAV_SINGLES_PARAMS), {
      items: [ABOUT],
      meta,
    });

    renderAt("/admin/collections/posts/e1/versions", client);
    await waitFor(() => expect(document.title).toBe("Posts · Golden Shop"));

    navigate("/admin/singles/about");
    await waitFor(() => expect(document.title).toBe("About Us · Golden Shop"));

    expect(listGet).not.toHaveBeenCalled();
    expect(itemRequests()).toEqual([]);
  });

  it("names a collection or Single beyond the sidebar's lists from what its screen already loaded", async () => {
    answerWith({ logoText: "Golden Shop" });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const meta = { total: 101, page: 1, limit: 100, totalPages: 2 };
    // The sidebar's first page, which these three are not on.
    client.setQueryData(collectionKeys.list(NAV_COLLECTIONS_PARAMS), {
      items: [POSTS],
      meta,
    });
    client.setQueryData(singleKeys.list(NAV_SINGLES_PARAMS), {
      items: [ABOUT],
      meta,
    });
    // What each screen loads for itself: the editor its collection's schema,
    // the entry list its collection, the Single's page its schema.
    client.setQueryData(collectionKeys.schema("archive"), {
      name: "archive",
      label: "Archive",
      labels: { singular: "Archive", plural: "Archives" },
    });
    client.setQueryData(collectionKeys.detail("ledger"), {
      name: "ledger",
      label: "Ledger",
      labels: { singular: "Ledger", plural: "Ledgers" },
    });
    client.setQueryData(singleKeys.schema("legal"), {
      slug: "legal",
      label: "Legal Notice",
    });

    renderAt("/admin/collections/archive/e1", client);
    await waitFor(() => expect(document.title).toBe("Archives · Golden Shop"));

    navigate("/admin/collections/ledger");
    await waitFor(() => expect(document.title).toBe("Ledgers · Golden Shop"));

    navigate("/admin/singles/legal");
    await waitFor(() =>
      expect(document.title).toBe("Legal Notice · Golden Shop")
    );

    // A collection nothing has loaded yet: the title waits for the screen's own
    // answer rather than asking for one, so it names the site alone and no
    // request for the collection goes out on the title's account.
    navigate("/admin/collections/unloaded/e9");
    await waitFor(() => expect(document.title).toBe("Golden Shop"));

    expect(listGet).not.toHaveBeenCalled();
    expect(itemRequests()).toEqual([]);
  });
});
