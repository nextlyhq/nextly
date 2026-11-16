// @vitest-environment jsdom
/**
 * The site's public branding as this device last saw it: drawn before any
 * request answers, so the sign-in screen and the frame look like the site
 * from the first paint, and replaced whole by the server's answer, a logo
 * since removed in General settings included. What the answer gives is kept
 * for the next visit: the public keys only.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REMEMBERED_BRANDING_KEY,
  rememberBranding,
  resetDeviceMemoryForTests,
} from "@admin/lib/device-memory/device-memory";
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
    data: { isSetup: true, isAuthenticated: false },
    isPending: false,
  }),
  authSessionKey: ["auth", "session"],
}));

import {
  BrandingProvider,
  useBranding,
} from "@admin/context/providers/BrandingProvider";

function Logo() {
  const branding = useBranding();
  return (
    <span data-testid="logo">
      {branding.logoUrl ?? "none"} / {branding.logoText ?? "no name"}
    </span>
  );
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

beforeEach(() => {
  window.localStorage.clear();
  resetDeviceMemoryForTests();
});

afterEach(() => {
  cleanup();
  get.mockReset();
  protectedGet.mockReset();
});

describe("the remembered branding", () => {
  it("is drawn before any request answers", () => {
    rememberBranding({ logoUrl: "/settings/logo.png", logoText: "Acme" });
    get.mockImplementation(never);
    protectedGet.mockImplementation(never);
    renderProvider();
    expect(screen.getByTestId("logo").textContent).toBe(
      "/settings/logo.png / Acme"
    );
  });

  it("gives way whole to the server's answer, a removed logo included", async () => {
    rememberBranding({ logoUrl: "/settings/logo.png", logoText: "Acme" });
    get.mockResolvedValue({ logoText: "Acme Studio" });
    protectedGet.mockResolvedValue({ plugins: [] });
    renderProvider();
    await screen.findByText("none / Acme Studio");
  });

  it("keeps the answer's public branding for the next visit, and nothing else", async () => {
    get.mockResolvedValue({
      logoUrl: "/settings/logo.png",
      logoText: "Acme",
      plugins: [{ name: "a-plugin" }],
      showBuilder: true,
    });
    protectedGet.mockResolvedValue({ plugins: [] });
    renderProvider();
    await waitFor(() => {
      const kept = JSON.parse(
        window.localStorage.getItem(REMEMBERED_BRANDING_KEY) ?? "null"
      ) as { data: Record<string, unknown> } | null;
      expect(kept?.data).toEqual({
        logoUrl: "/settings/logo.png",
        logoText: "Acme",
      });
    });
  });
});
