import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthFormCard } from "../AuthFormCard";
import { AuthStatusCard } from "../AuthStatusCard";

/**
 * The two cards every signed-out screen is drawn in. What is held here is what
 * the seven screens stopped saying for themselves: the branded logo, the mount
 * fade, and the fact that a status card with nothing to do renders no action
 * area at all.
 */

const { useBranding } = vi.hoisted(() => ({ useBranding: vi.fn() }));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // A configured `logoUrl` is what makes the logo an <img> carrying the alt
  // text; with none, ThemeAwareLogo draws the built-in inline mark instead and
  // there is no alt to assert on.
  useBranding.mockReturnValue({
    logoText: "Acme Docs",
    logoUrl: "https://cdn.example/logo.svg",
  });
});

describe("AuthFormCard", () => {
  it("renders its heading, its explanation and the form", () => {
    render(
      <AuthFormCard title="Welcome Back" description="Sign in to continue">
        <button type="submit">Sign in</button>
      </AuthFormCard>
    );

    expect(screen.getByText("Welcome Back")).toBeInTheDocument();
    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  // Each screen used to own this state, so one that forgot the effect would
  // have rendered at opacity-0 forever.
  it("fades in once mounted", async () => {
    const { container } = render(
      <AuthFormCard title="t" description="d">
        <span />
      </AuthFormCard>
    );

    await waitFor(() => {
      expect(container.querySelector(".opacity-100")).not.toBeNull();
    });
    expect(container.querySelector(".opacity-0")).toBeNull();
  });

  it("labels the logo with the configured product name", () => {
    render(
      <AuthFormCard title="t" description="d">
        <span />
      </AuthFormCard>
    );

    expect(screen.getByAltText("Acme Docs")).toBeInTheDocument();
  });

  it("falls back to Nextly when branding names nothing", () => {
    useBranding.mockReturnValue({ logoUrl: "https://cdn.example/logo.svg" });

    render(
      <AuthFormCard title="t" description="d">
        <span />
      </AuthFormCard>
    );

    expect(screen.getByAltText("Nextly")).toBeInTheDocument();
  });
});

describe("AuthStatusCard", () => {
  it("renders its heading, its explanation and what comes next", () => {
    render(
      <AuthStatusCard title="Email Verified" description="You can sign in now.">
        <a href="/login">Go to Sign In</a>
      </AuthStatusCard>
    );

    expect(screen.getByText("Email Verified")).toBeInTheDocument();
    expect(screen.getByText("You can sign in now.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to Sign In" })
    ).toBeInTheDocument();
  });

  it("carries no logo — it is not the form card wearing a flag", () => {
    render(<AuthStatusCard title="Invalid Link" description="No token." />);

    expect(screen.queryByRole("img")).toBeNull();
  });
});
