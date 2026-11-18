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

/** The site's code supplies Brand; nothing is stored yet. */
const MERGED = {
  tokens: [
    { name: "color.brand", kind: "color", values: { light: "#1d2b6b" } },
  ],
};

/** What the canvas draws Brand's light value as, read as the canvas reads. */
function Canvas(): React.JSX.Element {
  const { siteStyle } = ui.useSiteStyle();
  const brand = siteStyle.tokens?.tokens.find(
    token => token.name === "color.brand"
  );
  return createElement(
    "output",
    { "data-testid": "canvas" },
    brand?.values.light ?? "none"
  );
}

/** The Design panel inside the editor's style history, as the editor mounts it. */
function Editor(): React.JSX.Element {
  const style = ui.useSiteStyleHistory();
  const { connect } = style;
  useEffect(() => {
    connect(() => () => undefined);
    return () => connect(null);
  }, [connect]);
  const [current, choose] = useState<string | null>("colours");
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
          frame: (tabs: React.ReactNode) =>
            createElement(ui.TokensStudio, {
              merged: MERGED,
              supplied: undefined,
              pending: false,
              children: tabs,
            }),
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

const canvas = (): string | null =>
  ui.dom.screen.getByTestId("canvas").textContent;

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

/** Open Brand's editor. */
async function openBrand(): Promise<HTMLElement> {
  const { act, fireEvent, screen } = ui.dom;
  act(() => {
    // The row, not the "Brand" group's heading, which reads "Brand, <count>".
    fireEvent.click(screen.getByRole("button", { name: /^Brand, (?!\d+$)/ }));
  });
  return screen.findByRole("dialog");
}

/** Brand's light value in each write the Single was asked to make. */
function brandsWritten(): unknown[] {
  return database.writes.map(write => {
    const tokens = write.tokens as
      | { tokens?: { name: string; values: { light: string } }[] }
      | undefined;
    return tokens?.tokens?.find(token => token.name === "color.brand")?.values
      .light;
  });
}

/** Brand's light value as the database holds it. */
function brandStored(document: Record<string, unknown>): unknown {
  const tokens = document.tokens as {
    tokens?: { name: string; values: { light: string } }[];
  } | null;
  return tokens?.tokens?.find(token => token.name === "color.brand")?.values
    .light;
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
        "none",
        "none",
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
  }
);
