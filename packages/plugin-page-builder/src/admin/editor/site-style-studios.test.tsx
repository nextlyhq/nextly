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

vi.mock("../site-style-client", () => ({
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
}));

import {
  CanvasFrame,
  CanvasFrameProvider,
  type CanvasFrameSource,
  type VariablesPreview,
} from "@nextlyhq/builder/shell";

import { previewedCanvas, useCanvasPreviewMode } from "./canvas-preview-mode";
import { DesignPanel } from "./design-panel";
import { FontsPanelWithUpload } from "./site-style-fonts";
import { TokensStudio, VariablesTab } from "./site-style-studios";

afterEach(cleanup);

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
function Studio({
  start,
  preview,
}: {
  start: string;
  preview?: VariablesPreview;
}): React.JSX.Element {
  const [current, choose] = React.useState<string | null>(start);
  return (
    <DesignPanel
      view={{ current, choose }}
      frame={tabs => (
        <TokensStudio
          merged={{
            tokens: [
              {
                name: "color.brand",
                kind: "color",
                values: { light: "#1d2b6b", dark: "#8fa7ff" },
              },
            ],
          }}
          supplied={undefined}
          pending={false}
          {...(preview === undefined ? {} : { preview })}
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

  it("draws its preview switch and menu into the Design panel's header", async () => {
    can.update = true;
    renderStudio();
    const header = screen.getByRole("heading", { name: "Design" })
      .parentElement as HTMLElement;
    expect(
      await within(header).findByRole("group", { name: "Preview" })
    ).toBeTruthy();
    expect(
      within(header).getByRole("button", { name: "Import or export" })
    ).toBeTruthy();
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
  it("is the same on every tab: the preview switch and the import and export menu", async () => {
    can.update = true;
    for (const tab of ["variables", "classes", "fonts"]) {
      renderStudio(tab);
      expect(
        await within(header()).findByRole("group", { name: "Preview" })
      ).toBeTruthy();
      expect(
        within(header()).getByRole("button", { name: "Import or export" })
      ).toBeTruthy();
      cleanup();
    }
  });

  it("keeps the preview chosen while the author moves between tabs", async () => {
    can.update = true;
    renderStudio("variables");
    const dark = () => within(header()).getByRole("button", { name: "Dark" });
    fireEvent.click(
      await within(header()).findByRole("button", { name: "Dark" })
    );
    openTab("Styles");
    expect(await screen.findByText("Styles content")).toBeTruthy();
    expect(dark()).toHaveProperty("ariaPressed", "true");
    openTab("Colours");
    // The Variables tab draws the mode the header chose.
    const swatch = (
      await screen.findByRole("button", { name: /^Brand/ })
    ).querySelector(".nx-vars__swatch--main") as HTMLElement;
    expect(swatch.style.getPropertyValue("--nx-swatch")).toBe("#8fa7ff");
    expect(dark()).toHaveProperty("ariaPressed", "true");
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
 * The Design panel and the canvas as the editor wires them: one preview mode,
 * held above both, picked by the panel's switch and drawn by the frame, with
 * the frame's theme and its tags from the editor's own `previewedCanvas`.
 */
function PreviewedEditor({ variant }: { variant?: string }): React.JSX.Element {
  const mode = useCanvasPreviewMode();
  const previewed = previewedCanvas(mode, variant);
  return (
    <CanvasFrameProvider>
      <Studio start="variables" preview={mode} />
      <CanvasFrame
        width={1280}
        title="Home"
        source={UNLOADED_PAGE}
        theme={previewed.theme}
        overlay={previewed.tags}
      />
    </CanvasFrameProvider>
  );
}

/** The row of tags over the canvas, drawn only while one shows. */
function tagRow(): HTMLElement {
  const row = document.querySelector<HTMLElement>(".nx-canvas-tags");
  if (row === null) throw new Error("no tags over the canvas");
  return row;
}

function canvasElement(): HTMLIFrameElement {
  const frame = document.querySelector("iframe");
  if (frame === null) throw new Error("no canvas frame drawn");
  return frame;
}

describe("the canvas previewed in the mode the Design panel picks", () => {
  it("draws the canvas in Dark once Dark is picked, and says so over it", async () => {
    can.update = true;
    render(<PreviewedEditor />);
    const dark = await within(header()).findByRole("button", { name: "Dark" });
    // Nothing picked: the canvas draws the page's own mode and no tag shows.
    expect(canvasElement().style.colorScheme).toBe("");
    expect(screen.queryByRole("button", { name: "Use device" })).toBeNull();

    fireEvent.click(dark);

    expect(canvasElement().style.colorScheme).toBe("dark");
    expect(within(tagRow()).getByRole("status").textContent).toBe(
      "Dark preview"
    );
    expect(dark).toHaveProperty("ariaPressed", "true");
  });

  it("goes back to the page's own mode from the tag's Use device, on the canvas and the switch", async () => {
    can.update = true;
    render(<PreviewedEditor />);
    fireEvent.click(
      await within(header()).findByRole("button", { name: "Dark" })
    );
    expect(canvasElement().style.colorScheme).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "Use device" }));

    expect(canvasElement().style.colorScheme).toBe("");
    expect(screen.queryByRole("button", { name: "Use device" })).toBeNull();
    // The switch shows what the canvas draws again: this device's light.
    expect(
      within(header()).getByRole("button", { name: "Light" })
    ).toHaveProperty("ariaPressed", "true");
  });

  it("puts the picked mode beside a previewed variant, in one row", async () => {
    can.update = true;
    render(<PreviewedEditor variant="Featured" />);
    fireEvent.click(
      await within(header()).findByRole("button", { name: "Light" })
    );
    expect(canvasElement().style.colorScheme).toBe("light");
    const rows = document.querySelectorAll(".nx-canvas-tags");
    expect(rows).toHaveLength(1);
    expect(
      within(tagRow())
        .getAllByRole("status")
        .map(status => status.textContent)
    ).toEqual(["Previewing Featured", "Light preview"]);
  });
});

describe("the Fonts tab", () => {
  function renderFonts(): void {
    render(
      <FontsPanelWithUpload
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
