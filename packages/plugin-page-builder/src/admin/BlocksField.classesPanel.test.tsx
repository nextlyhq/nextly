// @vitest-environment jsdom

/**
 * The Shared styles tab reaching an author, which is a different claim from the
 * panel working.
 *
 * `shared-styles-panel.test.tsx` in the builder asserts the surface and
 * `shared-style-library.test.ts` asserts the rules. Both passed for weeks while the
 * panel was exported, styled, covered — and rendered by nothing, so no author
 * could open it. That is the failure this file exists to catch, and it has
 * already happened once on this chain for the fonts panel.
 *
 * The builder shell is replaced with recorders rather than rendered, as the
 * sibling files do: what is under test is which props this component passes,
 * and that `renderPanel` answers for this key at all.
 *
 * @module admin/BlocksField.classesPanel.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { useForm, type FieldValues } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SHARED_STYLE_REMOVE_ROUTE_PATH,
  sharedStyleUsagePath,
} from "../library-contract";

const DOCUMENT = { formatVersion: 1, kind: "page", nodes: [] };

/** The document the editor opens with, when a test needs one with nodes in it. */
let openWith: unknown;

/** Props the inspector recorder captured on the most recent render. */
const seen: { inspector: Record<string, unknown> | undefined } = {
  inspector: undefined,
};

/** What `usePluginClientConfig` answers with for the test in hand. */
let clientConfig: Record<string, unknown> | undefined;
/** What the stored site-style read reports, so `pending` can be driven. */
let storedRead: { data: unknown; isPending: boolean; error: unknown };
/** What a save answers, and what it was handed. */
let saveResult: { success: boolean } | Error;
/** When set, every save blocks on this until the test releases it. */
let holdSaves: Promise<void> | null;
/**
 * The bodies the Single was handed, each saved over whatever the style holds
 * and saying so with `_overwrite: true`, which the expectations state.
 */
const saved: Array<Record<string, unknown>> = [];
/** The shared-style routes: what was read and written. */
const routeReads: string[] = [];
const routeWrites: { path: string; body: unknown }[] = [];

vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>();
  const nothing = (): null => null;
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.JSX.Element => <>{children}</>;
  return {
    ...real,
    /*
      The shell here CALLS `renderPanel`, which the sibling tests' shell does
      not. What is under test is the branch itself: a panel exported, styled and
      covered by its own tests is still invisible to every author while nothing
      renders it, and that is the failure this file exists to catch rather than
      anything about how the panel behaves.
    */
    BuilderShell: ({
      renderPanel,
      availablePanels,
      inspector,
    }: {
      renderPanel?: (
        panel: string,
        view: { current: string | null; choose: (view: string) => void }
      ) => React.ReactNode;
      availablePanels?: readonly string[];
      inspector?: React.ReactNode;
    }): React.JSX.Element => (
      <div>
        <div data-testid="rail">{(availablePanels ?? []).join(",")}</div>
        <div data-testid="panel">
          {renderPanel?.("design", { current: "classes", choose: () => {} })}
        </div>
        {/* Rendered, not merely constructed: the inspector recorder only runs
            when the element is actually drawn, and the class-creation callback
            reaches the queue through it. */}
        <div data-testid="inspector">{inspector}</div>
      </div>
    ),
    BlockKeyboardActions: passthrough,
    BlockToolbar: nothing,
    BreakpointManager: nothing,
    BreakpointSwitcher: nothing,
    /*
     * Recorded rather than stubbed out: the class-CREATION callback reaches the
     * author through the inspector, and it shares the write queue with the
     * manager's rename. Some properties of that queue are only reachable
     * through creation, because they need a site with no stored classes — a
     * state in which the manager has no rows to drive.
     */
    InspectorPanel: (props: Record<string, unknown>): React.JSX.Element => {
      seen.inspector = props;
      return <div data-recorder="inspector" />;
    },
    InsertPanel: nothing,
    LayersPanel: nothing,
    TokensStudio: nothing,
    BlockContextMenu: passthrough,
  };
});

/*
 * A designer. The variables studio surrounds every Design tab, so it is drawn
 * here too, and it asks whether the variables may be changed.
 */
vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) => permission === "update-site-style",
}));

/** What the usage route answers: every page counted, nothing using any. */
function usageAnswer(path: string): unknown {
  const ids = new URL(`http://local${path}`).searchParams.getAll("id");
  return {
    whole: true,
    mayLock: false,
    styles: Object.fromEntries(
      ids.map(id => [
        id,
        {
          documents: 0,
          byKind: { pages: 0, components: 0, patterns: 0, layouts: 0 },
          complete: true,
        },
      ])
    ),
  };
}

/** Asking the stored style again, as the editor does after a save. */
const refetchStoredStyle = async () => ({ isError: false });
// The stored site style arrives through the editor's one read, the plugin's
// route; that read's request is asserted in `site-style-read.test`.
vi.mock("./site-style-read", () => ({
  useStoredSiteStyle: () => ({ ...storedRead, refetch: refetchStoredStyle }),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async () => ({
  // The canvas's media read, answering nothing: these cases draw no image.
  // One function for every call, as the admin's own hook keeps it.
  useMediaResolver: (
    read => () =>
      read
  )(() => Promise.resolve(null)),
  // The Fallback picker's library search, finding nothing: no case here
  // opens it. One function for every call, as the admin's own hook keeps it.
  useMediaSearcher: (
    search => () =>
      search
  )(() => Promise.resolve([])),
  // The shared-style routes, recorded: the usage read answers every page
  // counted and nothing used, and the where-used read an empty list.
  readPluginRoute: async ({ path }: { path: string }) => {
    routeReads.push(path);
    return path.startsWith("/shared-styles/usage")
      ? usageAnswer(path)
      : { items: [], meta: { total: 0, hasNext: false, hiddenCount: 0 } };
  },
  writePluginRoute: async ({ path, body }: { path: string; body: unknown }) => {
    routeWrites.push({ path, body });
    return {};
  },
  // The host's font table, which the real entry re-exports from core.
  WEB_FONT_FORMATS: (await import("nextly/config")).WEB_FONT_FORMATS,
  // The editor mount asks for the variant-use writer; no case here opens a
  // component, so it is never called.
  usePluginRouteMutation: () => ({
    write: async () => undefined,
    pending: false,
    error: null,
  }),
  // The media library, drawn as nothing: these cases never open it.
  MediaPickerDialog: () => null,
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => clientConfig,
  // No document around the field: the state every case here was written
  // against, and the one that offers every component.
  useDocumentIdentity: () => null,
  navigateTo: vi.fn(),
  // Nor a language the field could know: the component read asks for the
  // app default.
  useDocumentLocale: () => null,
  /*
   * The library read. Absent here rather than stubbed with patterns, because
   * these cases are about other surfaces and an offered pattern would change
   * what the palette contains. `pending: false` says the read ANSWERED with
   * nothing, which is the site with an empty library — the state every one of
   * these cases was written against.
   */
  usePluginRoute: () => ({
    data: undefined,
    pending: false,
    error: null,
    refetch: () => {},
  }),
  useDocumentCheckpoint: () => ({ schedule: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  // The form's storing gate, which site style writes are tracked with.
  useTrackedWrite: () => () => {},
  useBeforeDocumentAction: () => {},
  // The header's controls the bar places; drawn by the admin, not here.
  DocumentSaveIndicator: () => null,
  DocumentPrimaryAction: () => null,
  useDocumentActions: () => null,
  // No preview here: the top bar's Preview draws nothing.
  useDocumentPreview: () => null,
  // No one signed in: the editor keeps no preferences.
  useCurrentUserId: () => null,
  useDocumentStatus: () => null,
  // The editor registers its restore; nothing here offers one.
  useDocumentRestore: () => undefined,
  /*
   * Reached only on the refusal path, where `site-style-client` asks it to turn
   * a rejection into per-field messages. Answering none exercises the branch
   * that must still refuse when the transport could not describe why.
   */
  validationIssues: () => [],
  useUpdateSingleDocument: () => ({
    mutateAsync: async (value: Record<string, unknown>) => {
      saved.push(value);
      /*
       * Held open when the test asks. A mock that resolves immediately closes
       * the very window these tests exist to enter: the second edit then
       * composes after the first has already advanced the base, and passes
       * whether or not composition is serialised.
       */
      if (holdSaves !== null) await holdSaves;
      if (saveResult instanceof Error) throw saveResult;
      return saveResult;
    },
    isPending: false,
  }),
}));

const { PageBuilderView } = await import("./editor/PageBuilderView");

/**
 * The blocks field's declaration, as the admin hands it to the view. Typed at
 * the boundary because `FieldConfig` is the closed union of the built-in
 * shapes, and a contributed type such as `blocks` has no arm in it.
 */
const BODY_FIELD = { name: "body", type: "blocks" } as never;

/**
 * The builder's document view, open on the form's `body` field.
 *
 * `tick` exists only to force a re-render from the test.
 *
 * Some properties of the write queue are about what happens when the editor
 * RENDERS during an in-flight save, and nothing a test can click reaches that
 * without also changing the state under test.
 */
function Host({ tick = 0 }: { tick?: number }): React.JSX.Element {
  const { control } = useForm<FieldValues>({
    defaultValues: { body: openWith },
  });
  return (
    <>
      <span data-testid="tick">{tick}</span>
      <PageBuilderView
        control={control}
        field={BODY_FIELD}
        readOnly={false}
        exit={() => {}}
      />
    </>
  );
}

function openEditor(): ReturnType<typeof render> {
  return render(<Host />);
}

/** What the inspector was handed for the class surface. */
/** The inspector recorder's most recent props, for the class surface. */
function seenInspector(): {
  classLibrary?: readonly unknown[];
  onCreateClass?: (
    slug: string
  ) => Promise<{ ok: true; classId: string } | { ok: false; reason: string }>;
} {
  return (seen.inspector ?? {}) as never;
}

function classProps(): {
  classLibrary?: readonly { id: string; slug: string }[];
  classLibraryAbsence?: "pending" | "failed";
  onCreateClass?: (
    slug: string
  ) => Promise<{ ok: true; classId: string } | { ok: false; reason: string }>;
} {
  return (seen.inspector ?? {}) as never;
}

beforeEach(() => {
  seen.inspector = undefined;
  clientConfig = {};
  storedRead = { data: undefined, isPending: false, error: null };
  saveResult = { success: true };
  holdSaves = null;
  openWith = undefined;
  saved.length = 0;
  routeReads.length = 0;
  routeWrites.length = 0;
});

afterEach(cleanup);

/** A stored class list read back with these entries. */
function storedClasses(...classes: Record<string, unknown>[]): void {
  storedRead = { data: { classes }, isPending: false, error: null };
}

const CARD = { id: "id-card", slug: "card", orderIndex: 0, styles: {} };
const HERO = { id: "id-hero", slug: "hero", orderIndex: 1, styles: {} };

/** Let the reads the tab makes on mount answer. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** A style's details, opened from its row. */
async function details(slug: string): Promise<HTMLElement> {
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(`^${slug}, \\.nx-c-${slug}`),
    })
  );
  const dialog = await screen.findByRole("dialog", { name: slug });
  await settle();
  return dialog;
}

/** Commit a name in an open style's details. */
function commitName(dialog: HTMLElement, value: string): void {
  const field = within(dialog).getByLabelText("Name");
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: "Enter" });
}

describe("the Shared styles tab reaching an author", () => {
  it("offers the Design panel, whose Shared styles tab this is, at all", () => {
    // The slot was reserved and dark: the shell named it and nothing rendered
    // into it, so authors never reached it.
    storedClasses();
    openEditor();
    expect(screen.getByTestId("rail").textContent).toContain("design");
  });

  it("renders the tab into that slot rather than nothing", () => {
    storedClasses(CARD);
    openEditor();
    const panel = screen.getByTestId("panel");
    expect(panel.textContent).toContain("Shared styles");
    // The site's OWN style reached it. An empty panel would satisfy the
    // heading assertion alone, which is the shape this file exists to refuse.
    expect(panel.textContent).toContain(".nx-c-card");
  });

  it("draws a read still in flight as loading, not as a site with no styles", () => {
    storedRead = { data: undefined, isPending: true, error: null };
    openEditor();
    expect(screen.getByTestId("panel").textContent).toContain(
      "Reading this site’s shared styles"
    );
  });

  it("says a failed read failed, rather than loading forever", () => {
    storedRead = { data: undefined, isPending: false, error: new Error("403") };
    openEditor();
    const panel = screen.getByTestId("panel");
    expect(panel.textContent).toContain("could not be read");
    expect(panel.textContent).not.toContain("Reading this site");
  });

  it("reads how widely the rows on screen are used through the usage route", async () => {
    storedClasses(CARD, HERO);
    openEditor();
    await settle();
    // One read: the styles on screen first, then the looks blocks can wear,
    // which the code supplies; a block's own look has no count to read.
    const read = routeReads.find(path =>
      path.startsWith(sharedStyleUsagePath(["id-card", "id-hero"]))
    );
    const ids = new URLSearchParams(read?.split("?")[1] ?? "").getAll("id");
    expect(ids.slice(0, 2)).toEqual(["id-card", "id-hero"]);
    expect(ids.slice(2)).toEqual(
      expect.arrayContaining([
        "look:core/button:outline",
        "look:core/image:circle",
      ])
    );
    expect(ids.some(id => id === "look:core/button:primary")).toBe(false);
  });

  it("removes an unused style through the remove route, never by writing the class list", async () => {
    storedClasses(CARD);
    openEditor();
    await settle();
    const dialog = await details("card");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Remove card" })
      );
    });
    expect(routeWrites).toEqual([
      { path: SHARED_STYLE_REMOVE_ROUTE_PATH, body: { ids: ["id-card"] } },
    ]);
    expect(saved).toEqual([]);
  });

  it("writes the name and the class name derived from it when a name is committed", async () => {
    storedClasses(CARD);
    openEditor();
    commitName(await details("card"), "Promo card");
    await vi.waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(saved.at(-1)).toEqual({
      _overwrite: true,
      classes: [{ ...CARD, label: "Promo card", slug: "promo-card" }],
    });
  });

  it("keeps a locked style's lock when another style is renamed", async () => {
    storedClasses({ ...CARD, locked: true }, HERO);
    openEditor();
    commitName(await details("hero"), "Banner");
    await vi.waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(JSON.stringify(saved.at(-1))).toContain('"locked":true');
  });

  it("shows a refused rename rather than as though it landed", async () => {
    storedClasses(CARD);
    saveResult = new Error("The site style is locked.");
    openEditor();
    const dialog = await details("card");
    await act(async () => {
      commitName(dialog, "panel");
    });
    // The write WAS attempted — otherwise a refusal never shown and a refusal
    // never requested look identical.
    expect(saved.length).toBeGreaterThan(0);
    // The HOST's own reason, carried through verbatim.
    expect(await screen.findByText("The site style is locked.")).toBeTruthy();
  });

  it("composes a queued rename AFTER the one before it settles", async () => {
    /*
     * Both edits are made while the FIRST save is still on the network. The
     * second payload must be composed after the first settles, or it carries
     * the first style's old name and writing it undoes that rename.
     */
    let release: (() => void) | undefined;
    holdSaves = new Promise<void>(resolve => {
      release = resolve;
    });
    storedClasses(CARD, HERO);
    openEditor();

    const card = await details("card");
    commitName(card, "panel");
    fireEvent.keyDown(card, { key: "Escape" });
    commitName(await details("hero"), "banner");

    await act(async () => {
      release?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(saved.length).toBe(2));

    const last = JSON.stringify(saved.at(-1));
    expect(last).toContain('"banner"');
    expect(last).toContain('"panel"');
    expect(last).not.toContain('"card"');
  });

  it("uses the HOST's limits to count the blocks on this page", async () => {
    /*
     * A site that raised or lowered `limits` renders under those, and a count
     * under the engine's defaults would read different blocks. A ceiling of
     * one block reads only the first, and says the count is a floor.
     */
    clientConfig = { limits: { maxNodes: 1 } };
    openWith = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "n1", type: "core/text", props: {}, classes: ["id-card"] },
        { id: "n2", type: "core/text", props: {}, classes: ["id-hero"] },
      ],
    };
    storedClasses(CARD, HERO);
    openEditor();
    await settle();
    expect(
      screen
        .getByRole("button", { name: /^card, \.nx-c-card/ })
        .getAttribute("aria-label")
    ).toContain("At least 1 block on this page");
    expect(
      screen
        .getByRole("button", { name: /^hero, \.nx-c-hero/ })
        .getAttribute("aria-label")
    ).not.toContain("on this page");
  });

  it("carries a ZERO limit rather than substituting the default", async () => {
    // A host that sets `maxNodes: 0` gets a renderer that draws nothing, so no
    // block on this page carries the style.
    clientConfig = { limits: { maxNodes: 0 } };
    openWith = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/text", props: {}, classes: ["id-card"] }],
    };
    storedClasses(CARD);
    openEditor();
    await settle();
    const row = screen.getByRole("button", { name: /^card, \.nx-c-card/ });
    expect(row.getAttribute("aria-label")).not.toContain("block on this page");
  });

  /*
   * The DECODE of `null` back to an infinite bound is not asserted here, and
   * that is deliberate rather than an oversight: separating it from the engine
   * default needs a document larger than `MAX_NODES` (5000), which no test in
   * this file can build cheaply. What is asserted instead is the half that
   * actually breaks — the ENCODE, in `plugin.clientConfig.test`, because an
   * unencoded `Infinity` fails the client-config round trip and takes boot
   * down.
   */

  it("hands out the SAME empty library across renders", () => {
    /*
     * `?? []` built a new array every render. `useClassWrites` reads a changed
     * identity as "the host has re-read" and resets the write base to it, so a
     * site whose stored style declares no classes looked like it was re-reading
     * continuously — and a render during an in-flight save could restore the
     * stale list before the next queued write composed its payload.
     *
     * Asserted as the IDENTITY the surface is handed, which is the property the
     * write base keys on.
     */
    storedRead = { data: {}, isPending: false, error: null };
    const view = openEditor();
    const first = seenInspector().classLibrary;
    view.rerender(<Host tick={1} />);
    const second = seenInspector().classLibrary;

    // The control: a read that answered must yield a library at all, or `toBe`
    // below would be comparing undefined with undefined and pass on nothing.
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it("writes a revert typed while the rename before it is still open", async () => {
    /*
     * The tab cannot remember this: the rail unmounts it on every switch. The
     * HOST owns the write queue and so the name each style is heading for.
     * Rename `card` to `panel` with the save held open, then type `card`
     * again: a REVERT, which must reach the host rather than being read as no
     * change against the still-stored `card`.
     */
    let release: (() => void) | undefined;
    holdSaves = new Promise<void>(resolve => {
      release = resolve;
    });
    storedClasses(CARD);
    openEditor();

    const dialog = await details("card");
    commitName(dialog, "panel");
    await vi.waitFor(() => expect(saved.length).toBe(1));
    commitName(dialog, "card");

    await act(async () => {
      release?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(saved.length).toBe(2));

    // The revert was written LAST, so it is the one that stands.
    const last = JSON.stringify(saved.at(-1));
    expect(last).toContain('"slug":"card"');
    expect(last).not.toContain('"panel"');
  });

  it("keeps the name a style is heading for when an EARLIER rename settles under a later one", async () => {
    /*
     * Two renames of one style can be open together, and the first to settle
     * must not release the name the SECOND is heading for: the next edit is
     * judged against it, so typing the original back would read as no change
     * and be dropped while the second went on to store a different name.
     */
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    holdSaves = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    storedClasses(CARD);
    openEditor();

    const dialog = await details("card");
    commitName(dialog, "panel");
    await vi.waitFor(() => expect(saved.length).toBe(1));
    commitName(dialog, "hero");

    holdSaves = new Promise<void>(resolve => {
      releaseSecond = resolve;
    });
    await act(async () => {
      releaseFirst?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The revert, with the SECOND still open.
    commitName(dialog, "card");

    await act(async () => {
      releaseSecond?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(saved.length).toBeGreaterThanOrEqual(3));
    expect(JSON.stringify(saved.at(-1))).toContain('"slug":"card"');
  });

  it("lets a style whose id is __proto__ retry a rename its save refused", async () => {
    /*
     * The rename identity is keyed by class id, and a class id is stored data.
     * On a plain record `__proto__` read back an inherited object, so the
     * refused attempt never released its pending name, and the retry, judged
     * against that name, was dropped as no change at all.
     */
    storedClasses({ ...CARD, id: "__proto__" });
    saveResult = new Error("The site style is locked.");
    openEditor();

    const dialog = await details("card");
    await act(async () => {
      commitName(dialog, "panel");
    });
    expect(await screen.findByText("The site style is locked.")).toBeTruthy();
    const refused = saved.length;
    expect(refused).toBeGreaterThan(0);

    saveResult = { success: true };
    const field = within(dialog).getByLabelText("Name");
    await act(async () => {
      fireEvent.change(field, { target: { value: "panels" } });
      fireEvent.change(field, { target: { value: "panel" } });
      fireEvent.keyDown(field, { key: "Enter" });
    });

    // Written again, rather than swallowed as a no-op against a stuck name.
    await vi.waitFor(() => expect(saved.length).toBeGreaterThan(refused));
    expect(JSON.stringify(saved.at(-1))).toContain('"panel"');
  });
});
