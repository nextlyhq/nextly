// @vitest-environment jsdom

/**
 * The classes manager reaching an author, which is a different claim from the
 * panel working.
 *
 * `class-manager-panel.test.tsx` in the builder asserts the surface and
 * `class-library.test.ts` asserts the rules. Both passed for weeks while the
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
} from "@testing-library/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const saved: Array<Record<string, unknown>> = [];

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
      renderPanel?: (panel: string) => React.ReactNode;
      availablePanels?: readonly string[];
      inspector?: React.ReactNode;
    }): React.JSX.Element => (
      <div>
        <div data-testid="rail">{(availablePanels ?? []).join(",")}</div>
        <div data-testid="panel">{renderPanel?.("classes")}</div>
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

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  loadInlineRichTextEditor: () => new Promise<never>(() => {}),
  usePluginClientConfig: () => clientConfig,
  useDocumentCheckpoint: () => ({ schedule: () => {} }),
  useEntryFieldsPanel: () => null,
  useReportUnsavedWork: () => {},
  useSuppressAdminChrome: () => {},
  useDocumentStatus: () => null,
  /*
   * Reached only on the refusal path, where `site-style-client` asks it to turn
   * a rejection into per-field messages. Answering none exercises the branch
   * that must still refuse when the transport could not describe why.
   */
  validationIssues: () => [],
  useSingleDocument: () => storedRead,
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

const { BlocksField } = await import("./BlocksField");

/**
 * `tick` exists only to force a re-render from the test.
 *
 * Some properties of the write queue are about what happens when the editor
 * RENDERS during an in-flight save, and nothing a test can click reaches that
 * without also changing the state under test.
 */
function Host({ tick = 0 }: { tick?: number }): React.JSX.Element {
  const { control } = useForm({ defaultValues: { body: openWith } });
  return (
    <>
      <span data-testid="tick">{tick}</span>
      <BlocksField name="body" control={control} />
    </>
  );
}

function openEditor(): ReturnType<typeof render> {
  const view = render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Edit blocks" }));
  return view;
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
});

afterEach(cleanup);

describe("the classes manager reaching an author", () => {
  it("offers the classes rail slot at all", () => {
    // The slot was reserved and dark: `LEFT_PANELS` named it and nothing
    // rendered into it, so the shell drew it disabled as "coming soon".
    storedRead = { data: { classes: [] }, isPending: false, error: null };
    openEditor();
    expect(screen.getByTestId("rail").textContent).toContain("classes");
  });

  it("renders the manager into that slot rather than nothing", () => {
    storedRead = {
      data: {
        classes: [{ id: "id-card", slug: "card", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    const panel = screen.getByTestId("panel");
    expect(panel.textContent).toContain("Classes");
    // The site's OWN class reached it. An empty panel would satisfy the
    // heading assertion alone, which is the shape this file exists to refuse.
    expect(panel.textContent).toContain("card");
  });

  it("draws a read still in flight as loading, not as a site with no classes", () => {
    storedRead = { data: undefined, isPending: true, error: null };
    openEditor();
    expect(screen.getByTestId("panel").textContent).toContain(
      "Loading classes"
    );
  });

  it("says usage was not read, rather than reporting an empty index", () => {
    /*
     * The usage index is a collection and this surface has no read for one.
     * Passing an empty map would print "Not in index" against every class,
     * which is a statement about the site made from never having asked — and
     * it is the direction that reads as permission to delete.
     */
    storedRead = {
      data: {
        classes: [{ id: "id-card", slug: "card", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    const panel = screen.getByTestId("panel");
    expect(panel.textContent).toContain("Usage not read");
    expect(panel.textContent).not.toContain("Not in index");
  });

  it("offers no Delete while nothing can carry out one", () => {
    // Deleting must strip the class from every document holding it, and no
    // such write exists. A control that cannot keep its promise is withheld
    // rather than shown disabled.
    storedRead = {
      data: {
        classes: [{ id: "id-card", slug: "card", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    /*
     * The control first. An absent button is equally what a panel that never
     * rendered looks like, so without something that must be FOUND this
     * assertion is satisfied by the very defect the file exists to catch —
     * measured: it passed with `renderPanel` answering nothing for this key.
     */
    expect(screen.getByLabelText("Name of card")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete card" })).toBeNull();
  });

  it("writes the classes section when a name is committed", async () => {
    storedRead = {
      data: {
        classes: [{ id: "id-card", slug: "card", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    const field = screen.getByLabelText("Name of card");
    fireEvent.change(field, { target: { value: "panel" } });
    fireEvent.blur(field);
    await vi.waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(JSON.stringify(saved)).toContain("panel");
  });

  it("shows a refused rename rather than clearing as though it landed", async () => {
    // The field clears as soon as the author finishes typing, so a refusal
    // that reported nothing would leave the row reading as renamed until some
    // later read contradicted it.
    storedRead = {
      data: {
        classes: [{ id: "id-card", slug: "card", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    saveResult = new Error("The site style is locked.");
    openEditor();
    const field = screen.getByLabelText("Name of card");
    await act(async () => {
      fireEvent.change(field, { target: { value: "panel" } });
      fireEvent.blur(field);
    });
    // The write WAS attempted — otherwise a refusal never shown and a refusal
    // never requested look identical, and the assertion below would pass on a
    // panel that simply does not rename.
    expect(saved.length).toBeGreaterThan(0);
    // The HOST's own reason, carried through verbatim rather than replaced by
    // a generic one. A surface that substitutes its own wording tells the
    // author less than the server already said.
    expect(await screen.findByText("The site style is locked.")).toBeTruthy();
  });

  it("composes a queued rename AFTER the one before it settles", async () => {
    /*
     * The window that matters: both edits are made while the FIRST save is
     * still on the network. Serialising transmission alone is not enough —
     * the second payload is already built by then, so it carries the first
     * class's old slug and writing it undoes that rename while reporting
     * success.
     *
     * The save is held open deliberately. With a mock that resolves at once,
     * the second edit composes after the first has advanced the base, and the
     * test passes against code that does not serialise composition at all.
     */
    let release: (() => void) | undefined;
    holdSaves = new Promise<void>(resolve => {
      release = resolve;
    });
    storedRead = {
      data: {
        classes: [
          { id: "id-card", slug: "card", orderIndex: 0, styles: {} },
          { id: "id-hero", slug: "hero", orderIndex: 1, styles: {} },
        ],
      },
      isPending: false,
      error: null,
    };
    openEditor();

    // BOTH edits committed before anything is released.
    const first = screen.getByLabelText("Name of card");
    fireEvent.change(first, { target: { value: "panel" } });
    fireEvent.blur(first);
    const second = screen.getByLabelText("Name of hero");
    fireEvent.change(second, { target: { value: "banner" } });
    fireEvent.blur(second);

    await act(async () => {
      release?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(saved.length).toBe(2));

    const last = JSON.stringify(saved[saved.length - 1]);
    expect(last).toContain("banner");
    expect(last).toContain("panel");
    expect(last).not.toContain('"card"');
  });

  it("builds a second rename on the FIRST, not on the stale render", async () => {
    /*
     * Every write here replaces the whole class list, and the rendered library
     * does not refresh until the save comes back through the cache. Two
     * renames inside that window both composed from the same snapshot, so the
     * second wrote a list in which the first rename never happened — and it
     * reported success while undoing it.
     */
    storedRead = {
      data: {
        classes: [
          { id: "id-card", slug: "card", orderIndex: 0, styles: {} },
          { id: "id-hero", slug: "hero", orderIndex: 1, styles: {} },
        ],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    await act(async () => {
      const first = screen.getByLabelText("Name of card");
      fireEvent.change(first, { target: { value: "panel" } });
      fireEvent.blur(first);
    });
    await act(async () => {
      const second = screen.getByLabelText("Name of hero");
      fireEvent.change(second, { target: { value: "banner" } });
      fireEvent.blur(second);
    });

    expect(saved.length).toBe(2);
    // The SECOND payload is the one that decides, because it is written last.
    // It must carry both renames; carrying only its own is the defect.
    const last = JSON.stringify(saved[saved.length - 1]);
    expect(last).toContain("banner");
    expect(last).toContain("panel");
    expect(last).not.toContain('"card"');
  });

  it("uses the HOST's limits to decide what the page applies", () => {
    /*
     * A site that raised or lowered `limits` renders under those, and a walk
     * here under the engine's defaults selects different nodes — reporting a
     * class as absent from a page that renders it. A ceiling of one node means
     * only the first is read, so the second node's class is not marked.
     */
    clientConfig = { limits: { maxNodes: 1 } };
    // Two nodes, each carrying a class, so a ceiling of one truncates the walk.
    openWith = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "n1", type: "core/text", props: {}, classes: ["id-card"] },
        { id: "n2", type: "core/text", props: {}, classes: ["id-hero"] },
      ],
    };
    storedRead = {
      data: {
        classes: [
          { id: "id-card", slug: "card", orderIndex: 0, styles: {} },
          { id: "id-hero", slug: "hero", orderIndex: 1, styles: {} },
        ],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    // Reading fewer nodes than the document holds is reported, rather than the
    // shortfall being presented as "these classes are not on this page".
    expect(screen.getByTestId("panel").textContent).toContain(
      "more blocks than can be read at once"
    );
  });

  it("carries a ZERO limit rather than substituting the default", () => {
    // A host that sets `maxNodes: 0` gets a renderer that draws nothing.
    // Narrowing that away in the admin would mark classes as present on a page
    // rendering none of them.
    clientConfig = { limits: { maxNodes: 0 } };
    openWith = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/text", props: {}, classes: ["id-card"] }],
    };
    storedRead = {
      data: {
        classes: [{ id: "id-card", slug: "card", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    openEditor();
    const panel = screen.getByTestId("panel");
    // The row is there (the control), and it is NOT marked as on this page.
    expect(screen.getByLabelText("Name of card")).toBeTruthy();
    expect(panel.textContent).not.toContain("on this page");
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
     * write base keys on. Driving two creations through a held-open save does
     * not reach it: the composition callbacks run as microtasks and React has
     * not flushed the effect that resets the base by then, so that test passed
     * with the churn restored and was removed rather than kept as a green.
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

  it("remembers the name a class is heading for while its write is open", async () => {
    /*
     * The panel cannot remember this: the rail unmounts it on every switch, so
     * a field holding its own pending name loses it on exactly the switch that
     * makes the window long enough to matter. The HOST owns the write queue and
     * therefore the answer.
     *
     * Driven end to end: rename `card` to `panel` with the save held open, then
     * type `card` again. That is a REVERT, and it must reach the host rather
     * than being read as a no-op against the still-rendered `card`.
     */
    let release: (() => void) | undefined;
    holdSaves = new Promise<void>(resolve => {
      release = resolve;
    });
    storedRead = {
      data: {
        classes: [{ id: "id-card", slug: "card", orderIndex: 0, styles: {} }],
      },
      isPending: false,
      error: null,
    };
    openEditor();

    const first = screen.getByLabelText("Name of card");
    fireEvent.change(first, { target: { value: "panel" } });
    fireEvent.blur(first);
    await vi.waitFor(() => expect(saved.length).toBe(1));

    // React fires no change when the value equals the one already there, and
    // the field reverted to `card` when the draft cleared.
    fireEvent.change(screen.getByLabelText("Name of card"), {
      target: { value: "car" },
    });
    fireEvent.change(screen.getByLabelText("Name of card"), {
      target: { value: "card" },
    });
    fireEvent.blur(screen.getByLabelText("Name of card"));

    await act(async () => {
      release?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(saved.length).toBe(2));

    // The revert was written LAST, so it is the one that stands.
    const last = JSON.stringify(saved[saved.length - 1]);
    expect(last).toContain('"card"');
    expect(last).not.toContain("panel");
  });

  it("says a failed read failed, rather than loading forever", () => {
    // A read that FAILED will not finish. A panel still saying "loading"
    // describes a state the site is not in, and the author waits for something
    // that is never coming.
    storedRead = { data: undefined, isPending: false, error: new Error("403") };
    openEditor();
    const panel = screen.getByTestId("panel");
    expect(panel.textContent).toContain("could not be read");
    expect(panel.textContent).not.toContain("Loading classes");
  });
});
