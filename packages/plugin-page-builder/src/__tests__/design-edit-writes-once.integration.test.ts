/**
 * How many times one Design edit writes the Site Style to a real database.
 *
 * A variable is read by the whole site, and Design changes go live at once,
 * so a value typed slowly or dragged across the colour picker is drawn on the
 * canvas as it changes but stored once, when the edit ends: a write per key
 * or per pointer move would publish every half-typed value on the way.
 *
 * The real Design panel, studio, history and save run in a browser-like
 * document; the one thing replaced is the transport. The Single's update the
 * save sends is handed to the Direct API on the test database, and the read
 * the editor draws from is read back from it, so what is counted is what the
 * database was asked to store, and what is checked is what it holds.
 *
 * Run per dialect the machine can reach: the stored tokens are `jsonb` on
 * Postgres, `json` on MySQL and `text` on SQLite.
 *
 * One process holds both sides. The Direct API and the database adapters
 * refuse to run where a `window` exists, so the browser's globals are
 * installed with `window` answered per async context: absent for the
 * server's work, run inside {@link onServer}, and present for everything
 * else, the editor's modules (loaded after the globals) and React among them.
 *
 * @module __tests__/design-edit-writes-once.integration.test
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { AsyncLocalStorage } from "node:async_hooks";

import { createElement, useEffect, useState } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { builtinEnvironments } from "vitest/runtime";

import { pageBuilder } from "../plugin";
import { SITE_STYLE_SLUG } from "../site-style-storage";

/** Where the editor's writes and reads are routed: the test database. */
const database = vi.hoisted(() => ({
  update: undefined as
    | undefined
    | ((data: Record<string, unknown>) => Promise<unknown>),
  read: undefined as undefined | (() => Promise<unknown>),
  /** The stored document as the editor last read it. */
  data: { tokens: null } as unknown,
  /** Every update the Single was asked to make, in order. */
  writes: [] as Record<string, unknown>[],
}));

vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: () => true,
}));

vi.mock("../admin/site-style-read", async () => {
  const React = await import("react");
  return {
    useStoredSiteStyle: () => {
      const [, redraw] = React.useState(0);
      const refetch = async (): Promise<{ isError: boolean }> => {
        database.data = (await database.read?.()) ?? database.data;
        redraw(count => count + 1);
        return { isError: false };
      };
      return {
        data: database.data,
        isPending: false,
        error: null,
        current: true,
        refetch,
        readFresh: async () => (await database.read?.()) ?? database.data,
      };
    },
  };
});

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginClientConfig: () => undefined,
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSingleDocument: () => ({
    mutateAsync: async (data: Record<string, unknown>) => {
      database.writes.push(data);
      const answer = (await database.update?.(data)) as
        | { success?: boolean }
        | undefined;
      if (answer?.success === false) throw new Error("Validation failed.");
      return { id: "1" };
    },
    isPending: false,
  }),
  validationIssues: () => [],
  useBeforeDocumentAction: () => undefined,
  useTrackedWrite: () => () => undefined,
}));

/** The editor's modules and the testing library, loaded over a document. */
async function loadEditor() {
  return {
    dom: await import("@testing-library/react"),
    ...(await import("../admin/editor/design-panel")),
    ...(await import("../admin/editor/site-style-history")),
    ...(await import("../admin/editor/site-style-studios")),
    ...(await import("../admin/site-style-client")),
  };
}
let ui: Awaited<ReturnType<typeof loadEditor>>;

/** Set while the server's own work runs, which must see no `window`. */
const serverSide = new AsyncLocalStorage<true>();
/** Runs the server's work where `window` is absent. */
function onServer<T>(work: () => Promise<T>): Promise<T> {
  return serverSide.run(true, work);
}
/** The browser globals, taken down once the suite is done. */
let browser: { teardown: (global: object) => unknown } | undefined;
/** The browser's `window`, while its globals are installed. */
let browserWindow: unknown;

/**
 * The site's code supplies a colour, a text value, a size, a shadow and a
 * font; nothing is stored yet.
 */
const SUPPLIED = {
  tokens: [
    { name: "color.brand", kind: "color", values: { light: "#1d2b6b" } },
    { name: "custom.ratio", kind: "custom", values: { light: "4 / 3" } },
    { name: "space.gutter", kind: "dimension", values: { light: "16px" } },
    {
      name: "shadow.raised",
      kind: "shadow",
      values: { light: "0px 2px 4px 0px #000000" },
    },
    { name: "font.heading", kind: "fontFamily", values: { light: "serif" } },
  ],
};

/** The variables the canvas below draws, each read back by its name. */
const DRAWN = SUPPLIED.tokens.map(token => token.name);

/** The site's code, under whatever is stored, as the editor reads the site. */
const CONFIG = { tokens: SUPPLIED };

/** A variable's light value as the canvas draws it. */
function drawnValue(
  tokens: { tokens: readonly { name: string; values: { light: string } }[] },
  name: string
): string {
  return (
    tokens.tokens.find(token => token.name === name)?.values.light ?? "none"
  );
}

/** What the canvas draws each variable's value as, read as it reads. */
function Canvas(): React.JSX.Element {
  const { siteStyle } = ui.useSiteStyle(CONFIG);
  const tokens = siteStyle.tokens ?? { tokens: [] };
  return createElement(
    "div",
    null,
    ...DRAWN.map(name =>
      createElement(
        "output",
        { key: name, "data-testid": `canvas-${name}` },
        drawnValue(tokens, name)
      )
    )
  );
}

/**
 * The studio as the editor's panels mount it: the variables it edits are the
 * ones the canvas draws, read through the same preview, so a value drawn
 * before it is stored reaches the studio as the editor's does.
 */
function Studio({ tabs }: { tabs: React.ReactNode }): React.JSX.Element {
  const { siteStyle } = ui.useSiteStyle(CONFIG);
  return createElement(ui.TokensStudio, {
    merged: siteStyle.tokens ?? { tokens: [] },
    supplied: SUPPLIED,
    pending: false,
    children: tabs,
  });
}

/** The Design panel inside the editor's style history, as the editor mounts it. */
function Editor({ tab = "colours" }: { tab?: string }): React.JSX.Element {
  const style = ui.useSiteStyleHistory();
  const { connect } = style;
  useEffect(() => {
    connect(() => () => undefined);
    return () => connect(null);
  }, [connect]);
  const [current, choose] = useState<string | null>(tab);
  return createElement(
    ui.SiteStyleHistoryContext.Provider,
    { value: style.history },
    createElement(
      ui.SiteStylePreviewContext.Provider,
      { value: style.preview },
      createElement(Canvas),
      createElement(
        ui.StyleRevisionContext.Provider,
        { value: style.replay },
        createElement(ui.DesignPanel, {
          view: { current, choose },
          frame: (tabs: React.ReactNode) => createElement(Studio, { tabs }),
          tabs: {
            colours: () => createElement(ui.VariablesTab, { tab: "colours" }),
            type: () => createElement(ui.VariablesTab, { tab: "type" }),
            spacing: () => createElement(ui.VariablesTab, { tab: "spacing" }),
            styles: () => createElement("p", null, "Styles content"),
          },
        })
      )
    )
  );
}

/** A variable's value as the canvas draws it now. */
const drawnNow = (name: string): string | null =>
  ui.dom.screen.getByTestId(`canvas-${name}`).textContent;
const canvas = (): string | null => drawnNow("color.brand");
const canvasRatio = (): string | null => drawnNow("custom.ratio");

/**
 * Longer than a held write waits for the author's pause, so a value handed
 * to the save before the edit ends would be written before the next key.
 */
const slow = (): number => ui.SITE_STYLE_PAUSE_MS + 300;

/** Real time passing, as an author pauses between keys. */
async function pause(ms: number): Promise<void> {
  await ui.dom.act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
}

/** Open a variable's editor by its row's name. */
async function openRow(name: RegExp): Promise<HTMLElement> {
  const { act, fireEvent, screen } = ui.dom;
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  return screen.findByRole("dialog");
}

/** Open Brand's editor. */
function openBrand(): Promise<HTMLElement> {
  // The row, not the "Brand" group's heading, which reads "Brand, <count>".
  return openRow(/^Brand, (?!\d+$)/);
}

/** A stored or written token set's light value for `name`. */
function lightOf(tokens: unknown, name: string): unknown {
  const set = tokens as {
    tokens?: { name: string; values: { light: string } }[];
  } | null;
  return set?.tokens?.find(token => token.name === name)?.values.light;
}

/** A variable's light value in each write the Single was asked to make. */
function written(name = "color.brand"): unknown[] {
  return database.writes.map(write => lightOf(write.tokens, name));
}

/** Brand's light value in each write the Single was asked to make. */
function brandsWritten(): unknown[] {
  return written();
}

/** A variable's light value as the database holds it. */
function storedValue(document: Record<string, unknown>, name: string): unknown {
  return lightOf(document.tokens, name);
}

/** Brand's light value as the database holds it. */
function brandStored(document: Record<string, unknown>): unknown {
  return storedValue(document, "color.brand");
}

beforeAll(async () => {
  browser = await builtinEnvironments.jsdom.setup(globalThis, { jsdom: {} });
  browserWindow = (globalThis as { window?: unknown }).window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    get: () => (serverSide.getStore() === true ? undefined : browserWindow),
  });
  ui = await loadEditor();
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

afterAll(async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: browserWindow,
  });
  await browser?.teardown(globalThis);
});

describe.each(getConfiguredTestDialects())(
  "one Design edit, one Site Style write (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    /** Boots Nextly on the dialect and routes the editor's store to it. */
    async function boot(): Promise<() => Promise<Record<string, unknown>>> {
      const nextly = await onServer(() =>
        createTestNextly({ dialect, plugins: [pageBuilder()] })
      );
      current = nextly;
      const singles = nextly.getService("singleEntryService");
      const stored = async (): Promise<Record<string, unknown>> => {
        const answer = (await onServer(() =>
          singles.get(SITE_STYLE_SLUG, { overrideAccess: true })
        )) as { data?: Record<string, unknown> } & Record<string, unknown>;
        const document = answer.data ?? answer;
        // The tokens alone: a read with no version, so each write is made
        // over what is stored, as from a server that gives none.
        return { tokens: document.tokens ?? null };
      };
      database.update = data =>
        onServer(() =>
          singles.update(SITE_STYLE_SLUG, data, { overrideAccess: true })
        );
      database.read = stored;
      database.data = await stored();
      database.writes = [];
      return stored;
    }

    afterEach(async () => {
      ui.dom.cleanup();
      database.update = undefined;
      database.read = undefined;
      const ending = current;
      current = undefined;
      if (ending !== undefined) await onServer(() => ending.destroy());
    });

    it("draws a hex value typed slowly as it goes, and stores it once, when the field is left", async () => {
      const stored = await boot();
      const { act, fireEvent, render, waitFor, within } = ui.dom;
      render(createElement(Editor));
      const editor = await openBrand();
      const field = within(editor).getByRole("textbox", { name: "Light" });

      // One key at a time, each a longer wait than the pause a held write
      // waits for: an edit handed to the save as it went would be written
      // part-way through.
      const drawn: (string | null)[] = [];
      for (const typed of ["#f", "#ff", "#ff0", "#ff00", "#ff000", "#ff0000"]) {
        act(() => {
          fireEvent.change(field, { target: { value: typed } });
        });
        drawn.push(canvas());
        await pause(slow());
      }
      // Each colour drawn as it is typed; half of one (`#f`, `#ff`,
      // `#ff000`) keeps the last valid one drawn.
      expect(drawn).toEqual([
        "#1d2b6b",
        "#1d2b6b",
        "#ff0",
        "#ff00",
        "#ff00",
        "#ff0000",
      ]);
      expect(database.writes).toEqual([]);
      expect(brandStored(await stored())).toBeUndefined();

      act(() => {
        fireEvent.blur(field);
      });
      await waitFor(() => expect(database.writes).toHaveLength(1), {
        timeout: 5000,
      });
      // Long enough for any second write to have been made.
      await pause(1500);
      expect(brandsWritten()).toEqual(["#ff0000"]);
      expect(brandStored(await stored())).toBe("#ff0000");
      expect(canvas()).toBe("#ff0000");
    });

    it("draws the colour picker's colour as it moves, and stores it once, when it closes", async () => {
      const stored = await boot();
      const { act, fireEvent, render, waitFor, within } = ui.dom;
      render(createElement(Editor));
      const editor = await openBrand();
      const swatch = within(editor).getByRole("button", {
        name: "Pick the light colour",
      });
      act(() => {
        fireEvent.click(swatch);
      });
      // The surface's arrow keys move it as a drag does, one report a move;
      // the pointer rests between moves for longer than a held write waits.
      const surface = within(editor).getByRole("application", {
        name: /Saturation and brightness/,
      });
      const drawn: (string | null)[] = [];
      for (let move = 0; move < 5; move += 1) {
        act(() => {
          fireEvent.keyDown(surface, { key: "ArrowLeft" });
        });
        drawn.push(canvas());
        await pause(slow());
      }
      // Each move was drawn, and none was stored.
      expect(new Set(drawn).size).toBe(5);
      expect(drawn).not.toContain("#1d2b6b");
      expect(database.writes).toEqual([]);

      act(() => {
        fireEvent.click(swatch);
      });
      await waitFor(() => expect(database.writes).toHaveLength(1), {
        timeout: 5000,
      });
      await pause(1500);
      const last = drawn.at(-1);
      expect(brandsWritten()).toEqual([last]);
      expect(brandStored(await stored())).toBe(last);
    });

    it("draws a text value typed slowly as it goes, and stores it once, on Enter", async () => {
      const stored = await boot();
      const { act, fireEvent, render, waitFor, within } = ui.dom;
      render(createElement(Editor, { tab: "spacing" }));
      const editor = await openRow(/^Custom ratio/);
      const field = within(editor).getByRole("textbox", { name: "Light" });

      const drawn: (string | null)[] = [];
      for (const typed of ["16", "16 / 9"]) {
        act(() => {
          fireEvent.change(field, { target: { value: typed } });
        });
        drawn.push(canvasRatio());
        await pause(slow());
      }
      expect(drawn).toEqual(["16", "16 / 9"]);
      expect(database.writes).toEqual([]);

      act(() => {
        fireEvent.keyDown(field, { key: "Enter" });
      });
      await waitFor(() => expect(database.writes).toHaveLength(1), {
        timeout: 5000,
      });
      await pause(1500);
      expect(written("custom.ratio")).toEqual(["16 / 9"]);
      expect(storedValue(await stored(), "custom.ratio")).toBe("16 / 9");
      expect(canvasRatio()).toBe("16 / 9");
    });

    it("draws a size typed slowly as it goes, keeps the last valid one, and stores it once, when the field is left", async () => {
      const stored = await boot();
      const { act, fireEvent, render, waitFor, within } = ui.dom;
      render(createElement(Editor, { tab: "spacing" }));
      const editor = await openRow(/^Section padding \(sides\),/);
      const field = within(editor).getByLabelText("Light");

      const drawn: (string | null)[] = [];
      for (const typed of ["2", "2r", "2re", "2rem"]) {
        act(() => {
          fireEvent.change(field, { target: { value: typed } });
        });
        drawn.push(drawnNow("space.gutter"));
        await pause(slow());
      }
      // A unit on its way in keeps the last valid size drawn.
      expect(drawn).toEqual(["2px", "2px", "2px", "2rem"]);
      expect(database.writes).toEqual([]);

      act(() => {
        fireEvent.blur(field);
      });
      await waitFor(() => expect(database.writes).toHaveLength(1), {
        timeout: 5000,
      });
      await pause(1500);
      expect(written("space.gutter")).toEqual(["2rem"]);
      expect(storedValue(await stored(), "space.gutter")).toBe("2rem");
      expect(drawnNow("space.gutter")).toBe("2rem");
    });

    it("draws a shadow as a layer's size is typed slowly, and stores it once, on Enter", async () => {
      const stored = await boot();
      const { act, fireEvent, render, waitFor, within } = ui.dom;
      render(createElement(Editor, { tab: "spacing" }));
      const editor = await openRow(/^Raised,/);
      const blur = within(editor).getByLabelText("Blur");

      const drawn: (string | null)[] = [];
      for (const typed of ["8", "-8", "12"]) {
        act(() => {
          fireEvent.change(blur, { target: { value: typed } });
        });
        drawn.push(drawnNow("shadow.raised"));
        await pause(slow());
      }
      // A negative blur is no shadow: the last one that was stays drawn.
      expect(drawn).toEqual([
        "0px 2px 8px 0px #000000",
        "0px 2px 8px 0px #000000",
        "0px 2px 12px 0px #000000",
      ]);
      expect(database.writes).toEqual([]);

      act(() => {
        fireEvent.keyDown(blur, { key: "Enter" });
      });
      await waitFor(() => expect(database.writes).toHaveLength(1), {
        timeout: 5000,
      });
      await pause(1500);
      expect(written("shadow.raised")).toEqual(["0px 2px 12px 0px #000000"]);
      expect(storedValue(await stored(), "shadow.raised")).toBe(
        "0px 2px 12px 0px #000000"
      );
    });

    it("draws each font the keyboard moves to in the list, and stores the one picked once", async () => {
      const stored = await boot();
      const { act, fireEvent, render, screen, waitFor, within } = ui.dom;
      render(createElement(Editor, { tab: "type" }));
      const editor = await openRow(/^Heading,/);
      act(() => {
        fireEvent.click(
          within(editor).getByRole("button", { name: /^Font, / })
        );
      });
      const keys =
        screen.queryByRole("combobox", {
          name: "Search fonts",
          hidden: true,
        }) ?? screen.getByRole("listbox", { name: "Fonts", hidden: true });

      const drawn: (string | null)[] = [];
      for (let move = 0; move < 3; move += 1) {
        act(() => {
          fireEvent.keyDown(keys, { key: "ArrowDown" });
        });
        drawn.push(drawnNow("font.heading"));
        await pause(slow());
      }
      // Each family moved to is drawn, and none is stored.
      expect(new Set(drawn).size).toBe(3);
      expect(drawn).not.toContain("serif");
      expect(database.writes).toEqual([]);

      act(() => {
        fireEvent.keyDown(keys, { key: "Enter" });
      });
      await waitFor(() => expect(database.writes).toHaveLength(1), {
        timeout: 5000,
      });
      await pause(1500);
      const last = drawn.at(-1);
      expect(written("font.heading")).toEqual([last]);
      expect(storedValue(await stored(), "font.heading")).toBe(last);
    });
  }
);
