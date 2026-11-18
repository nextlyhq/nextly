// @vitest-environment jsdom
/**
 * The Fonts screen inside the Variables studio, as the builder's Design
 * panel and the admin's Fonts page both mount it: the screen reads the
 * studio's variables and their usage, so a font says how many places its
 * variables reach, and writes through the studio, so a font that finishes
 * adding can be made the site's Body or Headings font.
 *
 * The routes are fakes here; `variables-client.test` holds the client.
 */
import type { FontFaceDef, SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const saves = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) => permission === "update-site-style",
}));

vi.mock("../site-style-client", () => ({
  useSaveSiteStyle: () => ({
    save: (...args: unknown[]) => {
      saves.calls.push(args);
      return Promise.resolve({ saved: true, issues: {} });
    },
    reread: () => undefined,
  }),
  useHeldSiteStyle: () => ({ extend: () => {}, release: async () => {} }),
  useFontCatalogueClient: () => ({
    load: async () => ({ families: [], previewBase: "", fetchedAt: "" }),
    add: async () => undefined,
  }),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginClientConfig: () => undefined,
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// The variable routes, as fakes: every variable asked about is on 3 pages.
vi.mock("../variables-client", async () => {
  const { useMemo } = await import("react");
  return {
    useVariablesClient: () =>
      useMemo(
        () => ({
          usage: async (ids: readonly string[]) => ({
            whole: true,
            counting: false,
            mayCount: false,
            variables: new Map(
              ids.map(id => [
                id,
                {
                  documents: 3,
                  byKind: { pages: 3, components: 0, patterns: 0, layouts: 0 },
                  sharedStyles: [],
                  blockDefaults: [],
                  complete: true,
                },
              ])
            ),
          }),
          uses: async () => ({
            items: [],
            total: 0,
            hidden: 0,
            hasNext: false,
            complete: true,
          }),
        }),
        []
      ),
  };
});

const { SiteFontsScreen } = await import("./site-style-fonts");
const { TokensStudio } = await import("./site-style-studios");

afterEach(() => {
  cleanup();
  saves.calls = [];
});

const LORA: FontFaceDef = {
  family: "Lora",
  src: [{ url: "/api/media/b/raw", format: "woff2" }],
  weight: "400",
  source: { kind: "upload" },
};

const TOKENS: SiteTokenSet = {
  tokens: [
    {
      name: "font.display",
      label: "Display",
      kind: "fontFamily",
      values: { light: '"Lora", Georgia, serif' },
    },
  ],
};

function screenIn(studio: boolean): void {
  const fonts = (
    <SiteFontsScreen
      faces={[LORA]}
      tokens={TOKENS}
      absence="pending"
      onOpenTokens={() => undefined}
      storedFaces={[LORA]}
      storedPending={false}
      unreadableFonts={[]}
    />
  );
  render(
    studio ? (
      <TokensStudio merged={TOKENS} supplied={undefined} pending={false}>
        {fonts}
      </TokensStudio>
    ) : (
      fonts
    )
  );
}

async function loraDetails(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: /^Lora,/ }));
  return screen.findByRole("dialog", { name: "Lora" });
}

describe("the Fonts screen in the Variables studio", () => {
  it("says how many places a font's variables reach, from the studio's usage", async () => {
    screenIn(true);
    const details = await loraDetails();
    expect(
      await within(details).findByRole("button", { name: "Used in 3 places" })
    ).toBeTruthy();
  });

  it("says no places outside a studio, which has no usage to read", async () => {
    screenIn(false);
    const details = await loraDetails();
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      within(details).queryByRole("list", { name: "Where it’s used" })
    ).toBeNull();
  });
});
