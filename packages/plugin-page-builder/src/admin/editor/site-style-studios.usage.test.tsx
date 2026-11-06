// @vitest-environment jsdom
/**
 * The Variables studio's usage wiring: the variable routes reach the
 * Variables tab, so each row says how widely it is used, and a shared style
 * using a variable opens in the Shared styles tab with its details open.
 *
 * The routes are replaced with fakes here; `variables-client.test` holds the
 * client to the routes.
 */
import {
  BASE_BREAKPOINT,
  type NamedClass,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) => permission === "update-site-style",
}));

vi.mock("../site-style-client", () => ({
  useSaveSiteStyle: () => ({
    save: vi.fn(() => Promise.resolve({ saved: true, issues: [] })),
  }),
  useSaveSpacingMode: () => ({
    save: () => Promise.resolve({ saved: true, refreshed: true }),
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
}));

const NONE = { pages: 0, components: 0, patterns: 0, layouts: 0 };

// The variable routes, as fakes: Brand is used on one page and by Card.
vi.mock("../variables-client", async () => {
  const { useMemo } = await import("react");
  return {
    useVariablesClient: (
      openSharedStyle?: (classId: string) => void,
      openLook?: (look: { id: string; blockType: string }) => void
    ) =>
      // One access per way to Shared styles, as the real client keeps one.
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
                  documents: 1,
                  byKind: { ...NONE, pages: 1 },
                  sharedStyles: ["c-card"],
                  blockDefaults: [],
                  complete: true,
                },
              ])
            ),
          }),
          uses: async () => ({
            items: [
              {
                id: "c-card",
                title: "Card",
                collection: "site-style",
                kind: "shared-style" as const,
              },
              // A block look: a shared style bound to the Button.
              {
                id: "look-primary",
                title: "Primary",
                collection: "site-style",
                kind: "shared-style" as const,
                blockType: "core/button",
              },
            ],
            total: 2,
            hidden: 0,
            hasNext: false,
            complete: true,
          }),
          ...(openSharedStyle === undefined ? {} : { openSharedStyle }),
          ...(openLook === undefined ? {} : { openLook }),
        }),
        [openSharedStyle, openLook]
      ),
  };
});

// The shared-style routes, as fakes that find no use.
vi.mock("../shared-styles-client", () => {
  const access = {
    usage: async () => ({
      whole: true,
      counting: false,
      mayLock: false,
      styles: new Map(),
    }),
    uses: async () => ({
      items: [],
      total: 0,
      hidden: 0,
      hasNext: false,
      complete: true,
    }),
    lock: async () => undefined,
    remove: async () => undefined,
  };
  return { useSharedStylesClient: () => access };
});

import { DesignPanel } from "./design-panel";
import {
  SharedStylesStudio,
  TokensStudio,
  VariablesTab,
  type ClassSurface,
} from "./site-style-studios";

afterEach(cleanup);

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => undefined;
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

const TOKENS: SiteTokenSet = {
  tokens: [
    {
      name: "color.brand",
      kind: "color",
      values: { light: "#1d2b6b", dark: "#8fa7ff" },
    },
  ],
};

const CARD: NamedClass = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: { base: { [BASE_BREAKPOINT]: { color: { $token: "color.brand" } } } },
};

const PRIMARY: NamedClass = {
  id: "look-primary",
  slug: "primary",
  label: "Primary",
  orderIndex: 1,
  blockType: "core/button",
  styles: { base: { [BASE_BREAKPOINT]: { color: { $token: "color.brand" } } } },
};

const SURFACE: ClassSurface = {
  library: [CARD],
  absence: "pending",
  add: async () => undefined,
  writeStyles: async () => undefined,
  pendingNames: {},
  currentRenameAttempt: () => 0,
  rename: async () => ({ ok: true }),
};

/**
 * The Design panel as the editor draws it: the studio around every tab, the
 * Variables tab reading from it, and the Shared styles tab with the site's
 * styles. The tab is the panel's own state, as the shell keeps it.
 */
function Studio({
  look,
}: {
  /** The editor's way to edit a look in the inspector. */
  look?: (look: { id: string; blockType: string }) => void;
} = {}): React.JSX.Element {
  const [current, choose] = React.useState<string | null>("variables");
  return (
    <DesignPanel
      view={{ current, choose }}
      frame={tabs => (
        <TokensStudio
          merged={TOKENS}
          supplied={undefined}
          pending={false}
          classes={[CARD, PRIMARY]}
          opens={{
            sharedStyles: () => choose("classes"),
            ...(look === undefined ? {} : { look }),
          }}
        >
          {tabs}
        </TokensStudio>
      )}
      tabs={{
        variables: () => <VariablesTab />,
        classes: () => (
          <SharedStylesStudio
            classes={SURFACE}
            pageBlocks={{ counts: new Map(), complete: true }}
            styleContext={{ breakpoints: { viewport: [], container: [] } }}
            suppliedClassIds={undefined}
            tokens={TOKENS}
          />
        ),
        fonts: () => <p>Fonts content</p>,
      }}
    />
  );
}

/** Choose a tab as a pointer does. */
function openTab(name: string): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

describe("the Variables studio's usage", () => {
  it("reaches the Variables tab, so each row says how widely it is used", async () => {
    render(<Studio />);
    expect(
      await screen.findByRole("button", { name: /^Brand.*Used in 2 places$/ })
    ).toBeTruthy();
  });

  it("opens a shared style using a variable in Shared styles, its details open", async () => {
    render(<Studio />);
    fireEvent.click(
      await screen.findByRole("button", { name: /^Brand.*Used in 2 places$/ })
    );
    const editor = await screen.findByRole("dialog", { name: "Edit Brand" });
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    // What Card sets with Brand, from the site's styles the studio handed on.
    const card = await within(editor).findByRole("button", { name: "Card" });
    expect(card.closest("li")?.textContent).toBe(
      "Card · shared style · sets text colour"
    );
    fireEvent.click(card);

    await waitFor(() =>
      expect(
        screen
          .getByRole("tab", { name: "Shared styles" })
          .getAttribute("aria-selected")
      ).toBe("true")
    );
    expect(await screen.findByRole("dialog", { name: "Card" })).toBeTruthy();
  });

  it("opens Shared styles on its list when chosen again later", async () => {
    render(<Studio />);
    fireEvent.click(
      await screen.findByRole("button", { name: /^Brand.*Used in 2 places$/ })
    );
    const editor = await screen.findByRole("dialog", { name: "Edit Brand" });
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    fireEvent.click(
      await within(editor).findByRole("button", { name: "Card" })
    );
    await screen.findByRole("dialog", { name: "Card" });

    openTab("Variables");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Card" })).toBeNull()
    );
    openTab("Shared styles");
    // The style was taken once; the tab chosen again opens on its rows.
    await screen.findByRole("button", { name: /Card/ });
    expect(screen.queryByRole("dialog", { name: "Card" })).toBeNull();
  });

  it("opens a block look using a variable in the editor's look editor", async () => {
    const look = vi.fn();
    render(<Studio look={look} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /^Brand.*Used in 2 places$/ })
    );
    const editor = await screen.findByRole("dialog", { name: "Edit Brand" });
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    fireEvent.click(
      await within(editor).findByRole("button", { name: "Primary" })
    );
    expect(look).toHaveBeenCalledWith({
      id: "look-primary",
      blockType: "core/button",
    });
    // The Variables tab stays: a look does not open in Shared styles.
    expect(
      screen
        .getByRole("tab", { name: "Variables" })
        .getAttribute("aria-selected")
    ).toBe("true");
  });
});
