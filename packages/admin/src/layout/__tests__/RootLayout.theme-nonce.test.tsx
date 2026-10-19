/**
 * A site with a nonce-based Content Security Policy hands its nonce to
 * `RootLayout`, which must reach the inline script that paints the saved theme
 * before the first paint, even when the host has wrapped the layout in a
 * `ThemeProvider` of its own, whose settings then hold.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../context/providers/ThemeProvider";
import { RootLayout } from "../RootLayout";

// Before hydration the router has no route, which is when the layout renders
// the placeholder that carries the script.
vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({ route: null, isHydrated: false }),
}));

function serverHtml(layout: React.ReactElement) {
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      {layout}
    </QueryClientProvider>
  );
}

describe("the root layout's nonce", () => {
  it("reaches the pre-paint script", () => {
    expect(serverHtml(<RootLayout nonce="layout-nonce" />)).toMatch(
      /<script[^>]*nonce="layout-nonce"/
    );
  });

  it("reaches it under a host's own ThemeProvider too", () => {
    expect(
      serverHtml(
        <ThemeProvider>
          <RootLayout nonce="layout-nonce" />
        </ThemeProvider>
      )
    ).toMatch(/<script[^>]*nonce="layout-nonce"/);
  });
});
