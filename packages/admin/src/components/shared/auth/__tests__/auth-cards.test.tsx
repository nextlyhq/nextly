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

const { useBranding, useAppName } = vi.hoisted(() => ({
  useBranding: vi.fn(),
  useAppName: vi.fn(),
}));
// `useAppName` is mocked separately from `useBranding` on purpose: the card
// ASKS for the product name rather than deriving it, and the fallback it would
// otherwise re-derive is covered where it lives, in BrandingProvider.test.tsx.
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
  useAppName: () => useAppName(),
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
  useAppName.mockReturnValue("Acme Docs");
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

  // The card must ASK for the name rather than reading branding itself: three
  // screens interpolate the same name into their own copy, and a second
  // derivation here could disagree with the sentence directly beneath it.
  it("labels the logo with the name the app is called", () => {
    useAppName.mockReturnValue("Acme Docs");

    render(
      <AuthFormCard title="t" description="d">
        <span />
      </AuthFormCard>
    );

    expect(screen.getByAltText("Acme Docs")).toBeInTheDocument();
  });

  it("follows that name when it changes, rather than re-deriving one", () => {
    useAppName.mockReturnValue("Other Product");

    render(
      <AuthFormCard title="t" description="d">
        <span />
      </AuthFormCard>
    );

    expect(screen.getByAltText("Other Product")).toBeInTheDocument();
    expect(screen.queryByAltText("Acme Docs")).toBeNull();
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

  // Eight of the nine call sites used to pass this wrapper themselves. The card
  // owns it now, so a caller passes the link and nothing around it.
  it("puts what comes next in its own action area", () => {
    render(
      <AuthStatusCard title="t" description="d">
        <a href="/login">Back to Sign In</a>
      </AuthStatusCard>
    );

    const link = screen.getByRole("link", { name: "Back to Sign In" });
    expect(link.parentElement).toHaveClass("mt-2", "text-left");
  });

  it("renders no action area when there is nothing to do next", () => {
    const { container } = render(
      <AuthStatusCard title="Invalid Link" description="No token." />
    );

    expect(container.querySelector(".mt-2")).toBeNull();
  });

  it("carries no logo — it is not the form card wearing a flag", () => {
    render(<AuthStatusCard title="Invalid Link" description="No token." />);

    expect(screen.queryByRole("img")).toBeNull();
  });
});
