// @vitest-environment jsdom
/**
 * The Variables studio's wiring: the permission that decides whether the
 * site's variables can be changed, and the Design panel header its controls
 * are drawn into.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const can = vi.hoisted(() => ({ update: true }));

vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) =>
    permission === "update-site-style" ? can.update : false,
}));

vi.mock("../site-style-client", async () => ({
  // Outside an editor: no history, and nothing drawn over the read.
  SiteStyleHistoryContext: (await import("react")).createContext(null),
  SiteStylePreviewContext: (await import("react")).createContext(new Map()),
  useSaveSiteStyle: () => ({
    save: vi.fn(() => Promise.resolve({ saved: true, issues: [] })),
  }),
  useHeldSiteStyle: () => ({ extend: () => {}, release: async () => {} }),
  useFontCatalogueClient: () => ({
    load: async () => ({ families: [], previewBase: "", fetchedAt: "" }),
    add: async () => undefined,
  }),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePluginClientConfig: () => undefined,
  // The author the catalogue keeps the choice to show previews for.
  useCurrentUserId: () => "u1",
}));

import type { SiteTokenSet, TokenMode } from "@nextlyhq/blocks-engine";
import {
  CanvasFrame,
  CanvasFrameProvider,
  type CanvasFrameSource,
} from "@nextlyhq/builder/shell";
import { TooltipProvider } from "@nextlyhq/ui";

import {
  CanvasModeSwitch,
  previewedCanvas,
  useCanvasPreviewMode,
} from "./canvas-preview-mode";
import { DesignPanel } from "./design-panel";
import { SiteFontsScreen } from "./site-style-fonts";
import { TokensStudio, VariablesTab } from "./site-style-studios";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

beforeAll(() => {
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

/**
 * The Design panel as the editor draws it: the studio around every tab, and
 * the Variables tab reading from it. The tab is the panel's own state here,
 * as the shell keeps it.
 */
/** The site's variables in these tests: a colour and a gap with dark values. */
const SITE: SiteTokenSet = {
  tokens: [
    {
      name: "color.brand",
      kind: "color",
      values: { light: "#1d2b6b", dark: "#8fa7ff" },
    },
    // Its row shows the previewed mode's value; a colour's swatch shows both
    // of its values whatever the preview.
    {
      name: "space.gap",
      kind: "dimension",
      values: { light: "8px", dark: "12px" },
    },
  ],
};

function Studio({
  start,
  mode,
  tokens = SITE,
}: {
  start: string;
  mode?: TokenMode;
  tokens?: SiteTokenSet;
}): React.JSX.Element {
  const [current, choose] = React.useState<string | null>(start);
  return (
    <DesignPanel
      view={{ current, choose }}
      frame={tabs => (
        <TokensStudio
          merged={tokens}
          supplied={undefined}
          pending={false}
          {...(mode === undefined ? {} : { mode })}
        >
          {tabs}
        </TokensStudio>
      )}
      tabs={{
        colours: () => <VariablesTab tab="colours" />,
        type: () => <VariablesTab tab="type" />,
        spacing: () => <VariablesTab tab="spacing" />,
        styles: () => <p>Styles content</p>,
      }}
    />
  );
}

function renderStudio(start = "colours"): void {
  render(<Studio start={start} />);
}

/** The panel's header: its title row, which holds the header controls. */
function header(): HTMLElement {
  return screen.getByRole("heading", { name: "Design" })
    .parentElement as HTMLElement;
}

/** Choose a tab as a pointer does. */
function openTab(name: string): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

describe("the Variables studio", () => {
  it("is read-only for a role that may not update the site style", () => {
    can.update = false;
    renderStudio();
    expect(
      screen.getByText("You can view the site’s variables but not change them.")
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add colour" })).toBeNull();
  });

  it("can be changed by a role that may", () => {
    can.update = true;
    renderStudio();
    expect(screen.queryByText(/can view the site/)).toBeNull();
    expect(screen.getByRole("button", { name: "Add colour" })).toBeTruthy();
  });

  it("draws its More design actions menu into the Design panel's header, and no light/dark switch or Preview label", async () => {
    can.update = true;
    renderStudio();
    expect(
      await within(header()).findByRole("button", {
        name: "More design actions",
      })
    ).toBeTruthy();
    expectNoModeSwitchIn(header());
  });
});

describe("the space between blocks", () => {
  it("is no longer a choice: blocks are always spaced by their container's gap", () => {
    can.update = true;
    renderStudio();
    // The Variables tab is drawn, so a choice above its spacing variables
    // would be on screen if one were offered.
    expect(screen.getByRole("tab", { name: "Colours" })).toBeTruthy();
    expect(
      screen.queryByRole("radiogroup", { name: "Space between blocks" })
    ).toBeNull();
  });
});

describe("the Design panel's header", () => {
  it("is the same on every tab: the More design actions menu, and no light/dark switch", async () => {
    can.update = true;
    for (const tab of ["colours", "type", "spacing", "styles"]) {
      renderStudio(tab);
      expect(
        await within(header()).findByRole("button", {
          name: "More design actions",
        })
      ).toBeTruthy();
      expectNoModeSwitchIn(header());
      cleanup();
    }
  });

  it("has no box above the tabs: an export or import says so in a toast", async () => {
    can.update = true;
    renderStudio();
    await within(header()).findByRole("button", {
      name: "More design actions",
    });
    expect(document.querySelector(".nx-pb-design__reports")).toBeNull();
  });

  it("shows the editor's mode on every tab", async () => {
    can.update = true;
    render(<Studio start="styles" mode="dark" />);
    expect(await screen.findByText("Styles content")).toBeTruthy();
    openTab("Spacing");
    // The Variables tab draws the mode the editor previews.
    expect(
      await screen.findByRole("button", { name: /^Gap, 12px/ })
    ).toBeTruthy();
  });
});

/**
 * A page source the frame never takes as ready, so no page loads and what is
 * read below is the frame ELEMENT and the overlay drawn beside it.
 */
const UNLOADED_PAGE: CanvasFrameSource = {
  srcDoc: "<!doctype html><html><body></body></html>",
  ready: () => false,
  mountPoint: doc => doc.body,
};

/**
 * No light/dark switch and no "Preview" label inside `place`: the preview
 * is the top bar's.
 */
function expectNoModeSwitchIn(place: HTMLElement): void {
  expect(within(place).queryByRole("group", { name: "Preview" })).toBeNull();
  expect(within(place).queryByRole("button", { name: "Light" })).toBeNull();
  expect(within(place).queryByRole("button", { name: "Dark" })).toBeNull();
  expect(
    within(place).queryByRole("button", { name: "Preview in dark mode" })
  ).toBeNull();
  expect(place.textContent).not.toMatch(/Preview/);
}

/**
 * The top bar's switch, the Design panel and the canvas as the editor wires
 * them: one preview mode, held above all three, picked by the switch and
 * drawn by the frame, with the frame's theme and its tags from the editor's
 * own `previewedCanvas`.
 */
function PreviewedEditor({
  variant,
  tokens = SITE,
}: {
  variant?: string;
  tokens?: SiteTokenSet;
}): React.JSX.Element {
  const mode = useCanvasPreviewMode(tokens);
  const previewed = previewedCanvas(mode, variant);
  return (
    <TooltipProvider>
      <CanvasFrameProvider>
        <div data-testid="top-bar">
          <CanvasModeSwitch preview={mode} />
        </div>
        <Studio start="spacing" mode={mode.mode} tokens={tokens} />
        <CanvasFrame
          width={1280}
          title="Home"
          source={UNLOADED_PAGE}
          theme={previewed.theme}
          overlay={previewed.tags}
        />
      </CanvasFrameProvider>
    </TooltipProvider>
  );
}

/** The top bar's switch, or nothing while it is not offered. */
function darkSwitch(): HTMLElement | null {
  return within(screen.getByTestId("top-bar")).queryByRole("button", {
    name: "Preview in dark mode",
  });
}

function canvasElement(): HTMLIFrameElement {
  const frame = document.querySelector("iframe");
  if (frame === null) throw new Error("no canvas frame drawn");
  return frame;
}

/**
 * An element's accessible name, as a screen reader hears it: read through the
 * role query, which computes the name the same way for every button it finds.
 */
function nameOf(element: Element | null | undefined): string | undefined {
  let heard: string | undefined;
  screen.queryAllByRole("button", {
    name: (name, each) => {
      if (each === element) heard = name;
      return false;
    },
  });
  return heard;
}

/** The gap's row, which shows the value of the mode the panel shows. */
const gapRow = (): Promise<HTMLElement> =>
  screen.findByRole("button", { name: /^Gap, / });

describe("the canvas previewed in the mode the top bar's switch picks", () => {
  it("draws the canvas and the swatches light first, and both dark once the switch is pressed", async () => {
    can.update = true;
    render(<PreviewedEditor />);
    expect(nameOf(await gapRow())).toMatch(/^Gap, 8px/);
    expect(canvasElement().style.colorScheme).toBe("light");
    expect(darkSwitch()?.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(darkSwitch() as HTMLElement);

    expect(canvasElement().style.colorScheme).toBe("dark");
    expect(nameOf(await gapRow())).toMatch(/^Gap, 12px/);
    expect(darkSwitch()?.getAttribute("aria-pressed")).toBe("true");
    // No tag over the canvas and no switch in the panel: the top bar says it.
    expect(document.querySelector(".nx-canvas-tags")).toBeNull();
    expectNoModeSwitchIn(header());

    fireEvent.click(darkSwitch() as HTMLElement);
    expect(canvasElement().style.colorScheme).toBe("light");
    expect(nameOf(await gapRow())).toMatch(/^Gap, 8px/);
  });

  it("hides the switch and returns the canvas and the swatches to light when the last dark value goes while previewing dark", async () => {
    can.update = true;
    const { rerender } = render(<PreviewedEditor />);
    fireEvent.click(
      (await screen.findByRole("button", {
        name: "Preview in dark mode",
      })) as HTMLElement
    );
    expect(canvasElement().style.colorScheme).toBe("dark");

    // Every variable light only, the built-in colours included.
    const lightOnly: SiteTokenSet = {
      tokens: [
        ...SITE.tokens.map(token => ({
          ...token,
          values: { light: token.values.light },
        })),
        ...[
          "color.primary",
          "color.text",
          "color.background",
          "color.surface",
          "color.border",
          "color.border-strong",
          "color.muted",
        ].map(name => ({
          name,
          kind: "color" as const,
          values: { light: "#777777" },
        })),
      ],
    };
    rerender(<PreviewedEditor tokens={lightOnly} />);

    expect(darkSwitch()).toBeNull();
    expect(canvasElement().style.colorScheme).toBe("light");
    expect(nameOf(await gapRow())).toMatch(/^Gap, 8px/);
  });

  it("keeps the variant's tag over the canvas alone, whichever mode is previewed", async () => {
    can.update = true;
    render(<PreviewedEditor variant="Featured" />);
    fireEvent.click(darkSwitch() as HTMLElement);
    expect(canvasElement().style.colorScheme).toBe("dark");
    const rows = document.querySelectorAll(".nx-canvas-tags");
    expect(rows).toHaveLength(1);
    expect(
      [...(rows[0]?.querySelectorAll('[role="status"]') ?? [])].map(
        status => status.textContent
      )
    ).toEqual(["Previewing Featured"]);
  });
});

describe("the Fonts tab", () => {
  function renderFonts(): void {
    render(
      <SiteFontsScreen
        faces={[]}
        tokens={{ tokens: [] }}
        storedFaces={[]}
        storedPending={false}
        unreadableFonts={[]}
      />
    );
  }

  it("is read-only for a role that may not update the site style", () => {
    can.update = false;
    renderFonts();
    expect(
      screen.getByText(
        "You can view the site\u2019s fonts but not change them."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a font" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add from Google Fonts" })
    ).toBeNull();
  });

  it("offers both ways to add a font to a role that may", () => {
    can.update = true;
    renderFonts();
    expect(screen.getByRole("button", { name: "Add a font" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Add from Google Fonts" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Upload a font file" })
    ).toBeTruthy();
  });
});
