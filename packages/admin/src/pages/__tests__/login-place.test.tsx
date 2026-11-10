/**
 * The login page's place: plugins' blocks around the sign-in form, read from
 * the public half of the admin metadata, the only half a signed-out visitor
 * can be served.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerComponent } from "@admin/lib/plugins/component-registry";
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
// The sign-in form itself is not under test here, only where it stands.
vi.mock("@admin/components/features/auth-login", () => ({
  Login: () => <form aria-label="Sign in" />,
}));

import { BrandingProvider } from "@admin/context/providers/BrandingProvider";

import LoginPage from "../(auth)/login";

const BLOCK = "@acme/a/admin#LoginBlock";
registerComponent(BLOCK, ((props: { context?: unknown }) => (
  <pre data-testid="login-block">{JSON.stringify(props.context)}</pre>
)) as never);

afterEach(() => {
  get.mockReset();
  protectedGet.mockReset();
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BrandingProvider>
        <LoginPage />
      </BrandingProvider>
    </QueryClientProvider>
  );
}

describe("LoginPage's place", () => {
  it("with no contributions the page draws as before", async () => {
    get.mockResolvedValue({} as AdminBranding);
    protectedGet.mockRejectedValue(new Error("401"));

    renderPage();

    const form = await screen.findByRole("form", { name: "Sign in" });
    // The form sits straight in the layout's column, as it did before the
    // place: nothing wraps it and nothing stands beside it.
    expect(form.parentElement?.children).toHaveLength(1);
    expect(form.parentElement?.className).toContain("max-w-2xl");
  });

  it("draws the login place's blocks from the public meta", async () => {
    // Signed out, the session-gated half answers 401: everything this page
    // draws comes from the public half.
    get.mockResolvedValue({
      contributions: {
        login: {
          block: [
            { builtIn: "form" },
            {
              plugin: "@acme/a",
              id: "acme-a.login-block",
              kind: "block",
              component: BLOCK,
            },
          ],
        },
      },
    } as unknown as AdminBranding);
    protectedGet.mockRejectedValue(new Error("401"));

    renderPage();

    const block = await screen.findByTestId("login-block");
    const form = await screen.findByRole("form", { name: "Sign in" });
    // The block stands in the wrapper that keeps its own form's submit its own.
    expect(form.nextElementSibling).toBe(block.parentElement);
    expect(JSON.parse(block.textContent ?? "")).toEqual({});
  });
});
