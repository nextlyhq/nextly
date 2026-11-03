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

import { DesignPanel } from "./design-panel";
import {
  FontsPanelWithUpload,
  TokensStudio,
  VariablesTab,
} from "./site-style-studios";

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
function Studio({ start }: { start: string }): React.JSX.Element {
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
        >
          {tabs}
        </TokensStudio>
      )}
      tabs={{
        variables: () => <VariablesTab />,
        classes: () => <p>Shared styles content</p>,
        fonts: () => <p>Fonts content</p>,
      }}
    />
  );
}

function renderStudio(start = "variables"): void {
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
    openTab("Fonts");
    expect(await screen.findByText("Fonts content")).toBeTruthy();
    expect(dark()).toHaveProperty("ariaPressed", "true");
    openTab("Variables");
    // The Variables tab draws the mode the header chose.
    const swatch = (
      await screen.findByRole("button", { name: /^Brand/ })
    ).querySelector(".nx-vars__swatch--main") as HTMLElement;
    expect(swatch.style.getPropertyValue("--nx-swatch")).toBe("#8fa7ff");
    expect(dark()).toHaveProperty("ariaPressed", "true");
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
