// @vitest-environment jsdom
/**
 * The admin's Fonts page: the builder's one Fonts screen on a page of its own,
 * named by the page's heading, reading the site's fonts through the editor's
 * own site-style read (the stored tier over the site's code), and read-only
 * for a role that may not change the site's design.
 */
import type { FontFaceDef } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const can = vi.hoisted(() => ({ update: true }));
const read = vi.hoisted(() => ({
  pending: false,
  error: null as Error | null,
  defaults: undefined as unknown,
  /** More of the merged site style, for a test that needs its classes. */
  more: {} as Record<string, unknown>,
}));

const STORED: FontFaceDef = {
  family: "Stored Sans",
  src: [{ url: "/api/media/a/raw", format: "woff2" }],
  weight: "400",
  style: "normal",
  source: { kind: "upload" },
};
const FROM_CODE: FontFaceDef = {
  family: "Code Serif",
  src: [{ url: "/fonts/code-serif.woff2", format: "woff2" }],
};

vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) =>
    permission === "update-site-style" ? can.update : false,
}));

vi.mock("../site-style-client", () => ({
  // The editor's own read, handed the site's code tier: what it merges is
  // what the page lists.
  useSiteStyle: (defaults: { fonts?: FontFaceDef[] } | undefined) => {
    read.defaults = defaults;
    return {
      siteStyle: {
        fonts: [...(defaults?.fonts ?? []), STORED],
        ...read.more,
      },
      stored: { fonts: [STORED] },
      unreadableFonts: [],
      pending: read.pending,
      error: read.error,
      current: true,
    };
  },
  useHeldSiteStyle: () => ({ extend: () => {}, release: async () => {} }),
  useSaveSiteStyle: () => ({
    save: vi.fn(() => Promise.resolve({ saved: true, issues: {} })),
    reread: vi.fn(),
  }),
  useFontCatalogueClient: () => ({
    load: async () => ({ families: [], previewBase: "", fetchedAt: "" }),
    add: async () => undefined,
  }),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  // The author the catalogue keeps the choice to show previews for.
  useCurrentUserId: () => "u1",
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePluginClientConfig: () => ({ siteStyle: { fonts: [FROM_CODE] } }),
  navigateTo: () => undefined,
}));

// The variable routes, as fakes that find no use: the page's studio reads
// them, and these tests ask nothing of the counts.
vi.mock("../variables-client", () => {
  const access = {
    usage: async () => ({ whole: true, variables: new Map() }),
    uses: async () => ({
      items: [],
      total: 0,
      hidden: 0,
      hasNext: false,
      complete: true,
    }),
  };
  return { useVariablesClient: () => access };
});

const { FontsPage } = await import("./FontsPage");

afterEach(() => {
  cleanup();
  can.update = true;
  read.pending = false;
  read.error = null;
  read.more = {};
});

describe("the Fonts page", () => {
  it("is headed Fonts, under Page Builder, and that heading names the screen", () => {
    render(<FontsPage />);
    expect(
      screen.getByRole("heading", { name: "Fonts", level: 1 })
    ).toBeTruthy();
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(trail.textContent).toBe("DashboardPage BuilderFonts");
    // One region, the screen, named by the page's own heading: no second
    // title and no way back, which a page of its own has no use for.
    const region = screen.getByRole("region", { name: "Fonts" });
    expect(within(region).queryByRole("heading", { level: 2 })).toBeNull();
    expect(
      within(region).queryByRole("button", { name: "Back to Design" })
    ).toBeNull();
  });

  it("lists the stored fonts and the site's code fonts, as the builder reads them", () => {
    render(<FontsPage />);
    const region = screen.getByRole("region", { name: "Fonts" });
    expect(
      within(region).getByRole("button", { name: /^Stored Sans,/ })
    ).toBeTruthy();
    expect(
      within(region).getByRole("button", { name: /^Code Serif,/ })
    ).toBeTruthy();
    // The site's code tier is what the read was handed to merge under.
    expect(read.defaults).toMatchObject({ fonts: [FROM_CODE] });
  });

  it("refuses a font a heading takes from the text style it follows", () => {
    // Heading 1 follows Display, whose font is Stored Sans: removing it would
    // change every heading 1.
    read.more = {
      tokens: { tokens: [], siteText: { h1: { textStyle: "ts-display" } } },
      classes: [
        {
          id: "ts-display",
          slug: "display",
          orderIndex: 0,
          role: "text",
          styles: { base: { base: { fontFamily: '"Stored Sans", serif' } } },
        },
      ],
    };
    render(<FontsPage />);
    fireEvent.click(screen.getByRole("button", { name: /^Stored Sans,/ }));
    const open = screen.getByRole("dialog", { name: "Stored Sans" });
    fireEvent.click(within(open).getByRole("button", { name: "Remove" }));
    expect(
      within(open).getByRole("group", { name: "Stored Sans can’t be removed" })
    ).toBeTruthy();
  });

  it("offers both ways to add a font to a role that may change the design", () => {
    render(<FontsPage />);
    const region = screen.getByRole("region", { name: "Fonts" });
    expect(
      within(region).getByRole("button", { name: "Add a font" })
    ).toBeTruthy();
  });

  it("is read-only for a role that may not", () => {
    can.update = false;
    render(<FontsPage />);
    const region = screen.getByRole("region", { name: "Fonts" });
    expect(
      within(region).queryByRole("button", { name: "Add a font" })
    ).toBeNull();
    expect(
      within(region).getByText(
        "You can view the site’s fonts but not change them."
      )
    ).toBeTruthy();
  });

  it("says it is reading while the site's fonts are on their way", () => {
    read.pending = true;
    render(<FontsPage />);
    expect(screen.getByRole("status").textContent).toBe(
      "Reading this site’s fonts…"
    );
  });
});
