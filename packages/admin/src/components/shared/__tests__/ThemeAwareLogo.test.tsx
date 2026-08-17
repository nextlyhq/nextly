/**
 * The brand mark: where its ink comes from, and who may sit on a tile.
 *
 * The tile is opt-in and applies to the BUILT-IN mark only. A configured logo
 * belongs to the project that uploaded it — it may carry its own container, and
 * a filled tile behind a wordmark drawn for a transparent background can hide
 * it — so the boxed request is deliberately ignored once `logoUrl` is set.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeAwareLogo } from "../ThemeAwareLogo";

const branding = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding.current,
}));
vi.mock("@admin/context/providers/ThemeProvider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

describe("ThemeAwareLogo", () => {
  it("takes the built-in mark's ink from a token, not a literal colour", () => {
    branding.current = {};
    const { container } = render(<ThemeAwareLogo alt="Nextly" />);

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // Population before verdict: the paths are what would carry a literal.
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(0);

    expect(svg?.getAttribute("fill")).toBe("currentColor");
    for (const path of paths) {
      expect(path.getAttribute("fill")).toBeNull();
    }
    expect(container.innerHTML).not.toMatch(
      /fill="(white|black|#[0-9a-f]{3,8})"/i
    );
  });

  it("puts the built-in mark on a tile when asked", () => {
    branding.current = {};
    const { container } = render(<ThemeAwareLogo alt="Nextly" boxed />);

    const tile = screen.getByRole("img", { name: "Nextly" });
    expect(tile.tagName).toBe("SPAN");
    expect(tile.className).toContain("bg-primary");
    expect(tile.className).toContain("text-primary-foreground");
    // The mark is inside the tile and no longer announces itself separately,
    // so assistive technology reads one image rather than two.
    expect(container.querySelectorAll("[role='img']")).toHaveLength(1);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true"
    );
  });

  it("leaves the built-in mark bare when not asked", () => {
    branding.current = {};
    render(<ThemeAwareLogo alt="Nextly" />);

    const mark = screen.getByRole("img", { name: "Nextly" });
    expect(mark.tagName).toBe("svg");
    expect(mark.className.toString()).not.toContain("bg-primary");
  });

  it("never boxes a configured logo, even when boxed is requested", () => {
    // The separating property. Without it, an implementation that wrapped
    // everything would satisfy the tile test above and quietly put a brand
    // colour behind somebody else's logo.
    branding.current = { logoUrl: "https://example.test/logo.svg" };
    const { container } = render(<ThemeAwareLogo alt="Acme" boxed />);

    const img = screen.getByAltText("Acme");
    expect(img.tagName).toBe("IMG");
    expect(container.querySelector("span")).toBeNull();
    expect(container.innerHTML).not.toContain("bg-primary");
  });
});
