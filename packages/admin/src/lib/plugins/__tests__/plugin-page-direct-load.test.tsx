/**
 * A plugin page's own address, loaded directly, never reads as missing.
 *
 * Plugin pages are registered on the client once admin-meta answers, so a
 * bookmark or a refresh resolves the address before any plugin page exists.
 * Until the registry is known it answers with a loading hold rather than the
 * not-found page; once known, the address is either the page or a genuine not
 * found; and a failed first metadata request shows an error with a retry
 * rather than a hold that never ends.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PluginPageRegistrar } from "@admin/components/shared/plugin-page-registrar";
import { usePluginPageRegistration } from "@admin/hooks/usePluginPageRegistration";
import { ADMIN_WORKSPACE_KEY } from "@admin/hooks/useSchemaUpdateInvalidation";
import { resolveRoute } from "@admin/lib/routing";
import type { PluginMetadata } from "@admin/types/branding";

import {
  arePluginPagesKnown,
  clearPluginPages,
  setPluginPagesKnown,
} from "../plugin-route-registry";

const brandingStatus = vi.hoisted(() => ({
  isPending: false,
  isUnavailable: false,
  isBrandingUnavailable: false,
}));

vi.mock("@admin/context/providers/BrandingProvider", async importActual => ({
  ...(await importActual<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBrandingStatus: () => brandingStatus,
}));
vi.mock("@admin/lib/plugins/component-registry", () => ({
  autoRegisterPluginComponents: vi.fn(),
}));

const ADDRESS = "/admin/plugins/acme/reports";

const acme: PluginMetadata = {
  name: "acme",
  collections: [],
  pages: [{ path: "reports", component: "@acme/x/admin#Reports" }],
};

/** What the route resolved for `pathname` draws, inside a query client. */
function draw(pathname: string, client = new QueryClient()): void {
  const { Component } = resolveRoute(pathname, "");
  render(
    <QueryClientProvider client={client}>
      {(<Component params={{}} searchParams={{}} />) as ReactElement}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  Object.assign(brandingStatus, {
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  });
});

afterEach(() => {
  clearPluginPages();
  setPluginPagesKnown(false);
});

describe("a plugin page's address before its registry is known", () => {
  it("holds a loading state, not the not-found page, as a private visit", () => {
    brandingStatus.isPending = true;
    expect(resolveRoute(ADDRESS, "").routeType).toBe("private");

    draw(ADDRESS);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByText("Page Not Found")).toBeNull();
  });

  it("holds a plugin page named like a core one, such as settings", () => {
    const settings = "/admin/plugins/acme/settings";

    expect(resolveRoute(settings, "").params).toEqual({});
    draw(settings);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");

    // Once known with no such plugin page, the core screen answers it.
    setPluginPagesKnown(true);
    expect(resolveRoute(settings, "").params).toEqual({ slug: "acme" });
  });

  it("answers a core address that matches nothing as not found at once", () => {
    brandingStatus.isPending = true;

    draw("/admin/no-such-screen");

    expect(screen.getByText("Page Not Found")).toBeInTheDocument();
  });

  it("shows an error with a retry when the first metadata request failed", () => {
    brandingStatus.isUnavailable = true;
    const client = new QueryClient();
    const refetch = vi.spyOn(client, "refetchQueries").mockResolvedValue();

    draw(ADDRESS, client);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Page Not Found")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledWith({ queryKey: ADMIN_WORKSPACE_KEY });
  });
});

describe("once the registry is known", () => {
  it("is known once admin-meta answered, even with no plugin list", () => {
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const { rerender } = renderHook(
      ({ answered }: { answered: boolean }) =>
        usePluginPageRegistration(undefined, answered),
      { initialProps: { answered: false } }
    );
    expect(arePluginPagesKnown()).toBe(false);

    // An installation with no plugins answers without a list at all.
    rerender({ answered: true });

    expect(arePluginPagesKnown()).toBe(true);
    expect(
      dispatch.mock.calls.some(([event]) => event.type === "locationchange")
    ).toBe(true);
  });

  it("is unknown again when the answer is cleared, as on signing out", () => {
    const { rerender } = renderHook(
      ({ answered }: { answered: boolean }) =>
        usePluginPageRegistration(answered ? [acme] : undefined, answered),
      { initialProps: { answered: true } }
    );
    expect(arePluginPagesKnown()).toBe(true);

    rerender({ answered: false });

    expect(arePluginPagesKnown()).toBe(false);
  });

  it("takes the answer from admin-meta's status, not from a plugin list", () => {
    brandingStatus.isPending = true;
    const { rerender } = render(<PluginPageRegistrar />);
    expect(arePluginPagesKnown()).toBe(false);

    // Settled with no plugin list, as an installation without plugins answers.
    brandingStatus.isPending = false;
    rerender(<PluginPageRegistrar />);
    expect(arePluginPagesKnown()).toBe(true);

    // A first answer that never came is not an answer.
    brandingStatus.isUnavailable = true;
    rerender(<PluginPageRegistrar />);
    expect(arePluginPagesKnown()).toBe(false);
  });

  it("draws the registered page's address as that page, not a hold", () => {
    renderHook(() => usePluginPageRegistration([acme], true));

    expect(resolveRoute(ADDRESS, "").pluginComponentPath).toBe(
      "@acme/x/admin#Reports"
    );
  });

  it("answers an address no plugin registered as not found", () => {
    renderHook(() => usePluginPageRegistration([], true));

    draw(ADDRESS);

    expect(screen.getByText("Page Not Found")).toBeInTheDocument();
  });

  it("answers a page withdrawn by a later answer as not found", () => {
    const { rerender } = renderHook(
      ({ plugins }: { plugins: PluginMetadata[] }) =>
        usePluginPageRegistration(plugins, true),
      { initialProps: { plugins: [acme] } }
    );
    act(() => rerender({ plugins: [] }));

    draw(ADDRESS);

    expect(screen.getByText("Page Not Found")).toBeInTheDocument();
  });
});
