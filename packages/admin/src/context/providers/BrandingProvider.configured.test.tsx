// @vitest-environment jsdom
/**
 * Branding `nextly.config` sets arrives in the page's first HTML, as JSON in
 * `#nextly-admin-branding`. It is read before any request answers, so the
 * configured logo is there from the first paint, and it wins over branding
 * set in General settings (the `/admin-meta` answer).
 *
 * The page's icon is never swapped after load: with nothing set, the page
 * keeps its own; a configured favicon is already linked in the first HTML and
 * is left alone; only a favicon set in General settings is applied here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

const get = vi.fn();
const protectedGet = vi.fn();
vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: { get: (...args: unknown[]) => get(...args) },
}));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: (...args: unknown[]) => protectedGet(...args) },
}));
vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => ({
    data: { isSetup: true, isAuthenticated: true },
    isPending: false,
  }),
  authSessionKey: ["auth", "session"],
}));

import {
  BrandingProvider,
  useBranding,
} from "@admin/context/providers/BrandingProvider";
import { resetDeviceMemoryForTests } from "@admin/lib/device-memory/device-memory";

/** Writes what the admin route writes into the page's first HTML. */
function carryConfigured(json: string): void {
  const element = document.createElement("script");
  element.type = "application/json";
  element.id = "nextly-admin-branding";
  element.textContent = json;
  document.body.append(element);
}

function Logo() {
  const branding = useBranding();
  return <span data-testid="logo">{branding.logoUrl ?? "none"}</span>;
}

function renderProvider() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BrandingProvider>
        <Logo />
      </BrandingProvider>
    </QueryClientProvider>
  );
}

/** An answer that never arrives, so a test reads what the first paint has. */
const never = () => new Promise<AdminBranding>(() => {});

const adminIcons = () =>
  document.head.querySelectorAll("link[data-nextly-admin-icon]");

afterEach(() => {
  cleanup();
  // The provider remembers the branding it drew on this device; a test that
  // starts with a remembered favicon draws it before its own answer lands.
  window.localStorage.clear();
  resetDeviceMemoryForTests();
  document.getElementById("nextly-admin-branding")?.remove();
  document.head
    .querySelectorAll("link[rel='icon']")
    .forEach(node => node.remove());
  get.mockReset();
  protectedGet.mockReset();
});

describe("configured branding from the page", () => {
  it("draws the configured logo before any request answers", () => {
    carryConfigured(JSON.stringify({ logoUrl: "/brand/logo.svg" }));
    get.mockImplementation(never);
    protectedGet.mockImplementation(never);
    renderProvider();
    expect(screen.getByTestId("logo").textContent).toBe("/brand/logo.svg");
  });

  it("wins over a logo set in General settings", async () => {
    carryConfigured(JSON.stringify({ logoUrl: "/brand/logo.svg" }));
    get.mockResolvedValue({ logoUrl: "/settings/logo.png" });
    protectedGet.mockResolvedValue({ plugins: [] });
    renderProvider();
    await act(async () => {});
    expect(screen.getByTestId("logo").textContent).toBe("/brand/logo.svg");
  });

  it("takes the settings logo where the page carries none", async () => {
    get.mockResolvedValue({ logoUrl: "/settings/logo.png" });
    protectedGet.mockResolvedValue({ plugins: [] });
    renderProvider();
    await screen.findByText("/settings/logo.png");
  });
});

describe("the page's icon", () => {
  it("is left alone where nothing sets a favicon", async () => {
    const host = document.createElement("link");
    host.rel = "icon";
    host.href = "/favicon.ico";
    document.head.append(host);
    get.mockResolvedValue({});
    protectedGet.mockResolvedValue({ plugins: [] });
    renderProvider();
    await act(async () => {});
    expect(adminIcons()).toHaveLength(0);
    expect(host.rel).toBe("icon");
  });

  it("is left alone where the configuration sets the favicon", async () => {
    carryConfigured(JSON.stringify({ favicon: "/brand/icon.svg" }));
    get.mockResolvedValue({ favicon: "/brand/icon.svg" });
    protectedGet.mockResolvedValue({ plugins: [] });
    renderProvider();
    await act(async () => {});
    expect(adminIcons()).toHaveLength(0);
  });

  it("shows a favicon set only in General settings", async () => {
    get.mockResolvedValue({ favicon: "/settings/icon.png" });
    protectedGet.mockResolvedValue({ plugins: [] });
    renderProvider();
    await waitFor(() => expect(adminIcons()).toHaveLength(1));
    expect(adminIcons()[0]?.getAttribute("href")).toBe("/settings/icon.png");
  });
});
