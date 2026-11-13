// @vitest-environment jsdom

/**
 * What every screen of the SEO section shares: the trail from SEO to the
 * screen, the old addresses sending a bookmark on to the screen that
 * replaced them without leaving themselves in the history.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  navigateTo: vi.fn(),
}));

import { navigateTo } from "@nextlyhq/plugin-sdk/admin";

import { receivedMovedTo, SeoReceivedMoved, SeoTrail } from "../section";

const SECTION = "/admin/plugins/nextlyhq-plugin-seo";

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("the section's trail", () => {
  it("starts at SEO, leading back to the Overview, and ends on the screen", () => {
    render(
      <SeoTrail
        steps={[
          { label: "Pages", href: `${SECTION}/pages` },
          { label: "Import" },
        ]}
      />
    );
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(trail.textContent).toBe("SEOPagesImport");
    expect(screen.getByRole("link", { name: "SEO" }).getAttribute("href")).toBe(
      `${SECTION}/overview`
    );
    expect(
      screen.getByRole("link", { name: "Pages" }).getAttribute("href")
    ).toBe(`${SECTION}/pages`);
  });
});

describe("the old address of the check of what search engines received", () => {
  it("send a check of one page on to Inspect for that page", () => {
    window.history.replaceState(
      null,
      "",
      `${SECTION}/received?address=${encodeURIComponent("https://acme.example/a")}`
    );
    render(<SeoReceivedMoved />);
    expect(navigateTo).toHaveBeenCalledWith(
      `${SECTION}/pages/inspect?address=https%3A%2F%2Facme.example%2Fa`,
      { replace: true }
    );
  });

  it("send the check with no page named on to Pages", () => {
    expect(receivedMovedTo("")).toBe(`${SECTION}/pages`);
    expect(receivedMovedTo("?address=")).toBe(`${SECTION}/pages`);
  });
});
