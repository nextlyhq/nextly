// @vitest-environment jsdom
/**
 * The Variables studio's wiring: the permission that decides whether the
 * site's variables can be changed, and the Design panel header its controls
 * are drawn into.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const can = vi.hoisted(() => ({ update: true }));
type SpacingAnswer =
  | { saved: true; refreshed: true }
  | { saved: true; refreshed: false; issue: string }
  | { saved: false; issue: string };

const spacing = vi.hoisted(() => ({
  saved: [] as string[],
  answer: { saved: true, refreshed: true } as SpacingAnswer,
  /** Answers one save; by default at once with `answer`. */
  reply: null as null | ((mode: string) => Promise<SpacingAnswer>),
}));

vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) =>
    permission === "update-site-style" ? can.update : false,
}));

vi.mock("../site-style-client", () => ({
  useSaveSiteStyle: () => ({
    save: vi.fn(() => Promise.resolve({ saved: true, issues: [] })),
  }),
  useSaveSpacingMode: () => ({
    save: (mode: string) => {
      spacing.saved.push(mode);
      return spacing.reply === null
        ? Promise.resolve(spacing.answer)
        : spacing.reply(mode);
    },
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
function Studio({
  start,
  spacingMode = "classic",
}: {
  start: string;
  spacingMode?: "classic" | "gaps";
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
          spacingMode={spacingMode}
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

describe("the space between blocks", () => {
  const classic = () =>
    screen.getByRole("radio", { name: /From each block’s margins/ });
  const gaps = () =>
    screen.getByRole("radio", { name: /From the container’s gap/ });

  it("shows the site's model above the spacing variables", () => {
    can.update = true;
    renderStudio();
    const group = screen.getByRole("radiogroup", {
      name: "Space between blocks",
    });
    expect(group).toBeTruthy();
    expect((classic() as HTMLInputElement).checked).toBe(true);
    expect((gaps() as HTMLInputElement).checked).toBe(false);
  });

  beforeEach(() => {
    spacing.saved.length = 0;
    spacing.answer = { saved: true, refreshed: true };
    spacing.reply = null;
  });

  it("saves a choice and shows it at once", async () => {
    can.update = true;
    renderStudio();
    fireEvent.click(gaps());
    expect((gaps() as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(spacing.saved).toEqual(["gaps"]));
  });

  it("lets the latest of two quick choices win, sent in the order they were made", async () => {
    can.update = true;
    const pending: ((answer: SpacingAnswer) => void)[] = [];
    spacing.reply = () =>
      new Promise<SpacingAnswer>(resolve => pending.push(resolve));
    renderStudio();
    fireEvent.click(gaps());
    await waitFor(() => expect(spacing.saved).toEqual(["gaps"]));
    fireEvent.click(classic());
    // The second waits for the first, so the server cannot store them out of
    // order; the screen shows the latest choice meanwhile.
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(spacing.saved).toEqual(["gaps"]);
    expect((classic() as HTMLInputElement).checked).toBe(true);
    // The first answers, refused: it is superseded, so it neither rolls the
    // choice back nor speaks.
    pending[0]?.({ saved: false, issue: "An older refusal." });
    await waitFor(() => expect(spacing.saved).toEqual(["gaps", "classic"]));
    expect(screen.queryByText("An older refusal.")).toBeNull();
    expect((classic() as HTMLInputElement).checked).toBe(true);
    pending[1]?.({ saved: true, refreshed: true });
    await waitFor(() =>
      expect((classic() as HTMLInputElement).checked).toBe(true)
    );
  });

  it("never sends a choice replaced before its turn", async () => {
    can.update = true;
    const pending: ((answer: SpacingAnswer) => void)[] = [];
    spacing.reply = () =>
      new Promise<SpacingAnswer>(resolve => pending.push(resolve));
    renderStudio();
    fireEvent.click(gaps());
    await waitFor(() => expect(spacing.saved).toEqual(["gaps"]));
    fireEvent.click(classic());
    fireEvent.click(gaps());
    pending[0]?.({ saved: true, refreshed: true });
    await waitFor(() => expect(spacing.saved).toEqual(["gaps", "gaps"]));
    pending[1]?.({ saved: true, refreshed: true });
    expect((gaps() as HTMLInputElement).checked).toBe(true);
  });

  it("keeps a stored choice shown and says so when the editor could not read it back", async () => {
    can.update = true;
    spacing.answer = {
      saved: true,
      refreshed: false,
      issue: "Saved, but not read back.",
    };
    renderStudio();
    fireEvent.click(gaps());
    expect(await screen.findByText("Saved, but not read back.")).toBeTruthy();
    expect((gaps() as HTMLInputElement).checked).toBe(true);
  });

  it("puts the stored model back and says why when the save is refused", async () => {
    can.update = true;
    spacing.answer = { saved: false, issue: "Not allowed here." };
    renderStudio();
    fireEvent.click(gaps());
    expect(await screen.findByText("Not allowed here.")).toBeTruthy();
    expect((classic() as HTMLInputElement).checked).toBe(true);
  });

  it("offers no other model to a role that may not change the site style", () => {
    can.update = false;
    renderStudio();
    expect((gaps() as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(gaps());
    expect(spacing.saved).toEqual([]);
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
